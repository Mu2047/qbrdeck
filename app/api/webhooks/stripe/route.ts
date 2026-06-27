import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { PAYMENT_GRACE_PERIOD_DAYS } from '@/lib/subscription-access'
import type Stripe from 'stripe'

function getPlanFromPriceId(priceId?: string): 'FREE' | 'SOLO' | 'GROWTH' | 'AGENCY' {
  if (!priceId) return 'FREE'
  if (priceId === process.env.STRIPE_PRICE_SOLO)   return 'SOLO'
  if (priceId === process.env.STRIPE_PRICE_GROWTH) return 'GROWTH'
  if (priceId === process.env.STRIPE_PRICE_AGENCY) return 'AGENCY'
  return 'FREE'
}

// Resolves which workspace a Stripe event belongs to. Tries the DB join
// first; falls back to the Stripe customer's own metadata if the local
// row is missing or its stripeCustomerId has drifted.
async function resolveWorkspaceId(customerId: string): Promise<string | null> {
  const existing = await prisma.subscription.findUnique({
    where: { stripeCustomerId: customerId },
    select: { workspaceId: true },
  })
  if (existing) return existing.workspaceId

  const customer = await stripe.customers.retrieve(customerId)
  if (customer.deleted) return null

  return (customer as Stripe.Customer).metadata?.workspaceId ?? null
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig  = req.headers.get('stripe-signature')

  if (!sig) {
    console.error('[webhook] Missing stripe-signature header')
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: any) {
    console.error('[webhook] Signature verification failed:', err.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const { id: stripeEventId, type: eventType } = event

  const existingEvent = await prisma.stripeEvent.findUnique({ where: { stripeEventId } })

  if (existingEvent) {
    if (existingEvent.status === 'PROCESSED') return NextResponse.json({ received: true, idempotent: true })
    if (existingEvent.status === 'PROCESSING') return NextResponse.json({ received: true, processing: true })
  }

  await prisma.stripeEvent.upsert({
    where:  { stripeEventId },
    update: { status: 'PROCESSING', retryCount: { increment: existingEvent ? 1 : 0 }, updatedAt: new Date() },
    create: { stripeEventId, eventType, status: 'PROCESSING', receivedAt: new Date() },
  })

  try {
    await handleEvent(event)
    await prisma.stripeEvent.update({
      where: { stripeEventId },
      data:  { status: 'PROCESSED', processedAt: new Date(), errorMessage: null },
    })
    return NextResponse.json({ received: true })
  } catch (err: any) {
    const safeMessage = typeof err.message === 'string' ? err.message.slice(0, 500) : 'Unknown error'
    console.error(`[webhook] Handler failed for ${eventType} (${stripeEventId}):`, safeMessage)
    await prisma.stripeEvent.update({ where: { stripeEventId }, data: { status: 'FAILED', errorMessage: safeMessage } })
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
      break
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
      break
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
      break
    case 'invoice.paid':
      await handleInvoicePaid(event.data.object as Stripe.Invoice)
      break
    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice)
      break
    default:
      console.log(`[webhook] Unhandled event type: ${event.type}`)
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const customerId     = session.customer as string
  const subscriptionId = session.subscription as string

  if (!subscriptionId) {
    console.warn('[webhook] checkout.session.completed: no subscriptionId')
    return
  }

  const sub     = await stripe.subscriptions.retrieve(subscriptionId)
  const priceId = sub.items.data[0]?.price.id
  const plan    = getPlanFromPriceId(priceId)

  const subscriptionData = {
    stripeCustomerId:         customerId,
    stripeSubscriptionId:     subscriptionId,
    stripePriceId:            priceId,
    plan,
    status:                   sub.status,
    stripeStatus:             sub.status,
    stripeCurrentPeriodStart: new Date(sub.current_period_start * 1000),
    stripeCurrentPeriodEnd:   new Date(sub.current_period_end   * 1000),
    currentPeriodEnd:         new Date(sub.current_period_end   * 1000),
    periodStart:              new Date(sub.current_period_start * 1000),
    cancelAtPeriodEnd:        sub.cancel_at_period_end,
    qbrCount:    0,
    exportCount: 0,
    pastDueAt:   null,
    graceEndsAt: null,
  }

  const workspaceId = session.metadata?.workspaceId ?? await resolveWorkspaceId(customerId)

  if (!workspaceId) {
    throw new Error(`checkout.session.completed: unable to resolve workspace for customer ${customerId}`)
  }

  await prisma.subscription.upsert({
    where:  { workspaceId },
    update: subscriptionData,
    create: { workspaceId, ...subscriptionData, exportedQbrIds: '[]' },
  })
}

async function handleSubscriptionUpdated(sub: Stripe.Subscription): Promise<void> {
  const customerId  = sub.customer as string
  const priceId     = sub.items.data[0]?.price.id
  const plan        = getPlanFromPriceId(priceId)
  const isRecovered = sub.status === 'active' || sub.status === 'trialing'

  const workspaceId = await resolveWorkspaceId(customerId)
  if (!workspaceId) {
    throw new Error(`customer.subscription.updated: unable to resolve workspace for customer ${customerId}`)
  }

  await prisma.subscription.update({
    where: { workspaceId },
    data: {
      plan,
      status:                   sub.status,
      stripeStatus:             sub.status,
      stripePriceId:            priceId,
      stripeSubscriptionId:     sub.id,
      stripeCustomerId:         customerId,
      stripeCurrentPeriodStart: new Date(sub.current_period_start * 1000),
      stripeCurrentPeriodEnd:   new Date(sub.current_period_end   * 1000),
      currentPeriodEnd:         new Date(sub.current_period_end   * 1000),
      cancelAtPeriodEnd:        sub.cancel_at_period_end,
      ...(isRecovered ? { pastDueAt: null, graceEndsAt: null } : {}),
    },
  })
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const customerId = sub.customer as string

  const workspaceId = await resolveWorkspaceId(customerId)
  if (!workspaceId) {
    throw new Error(`customer.subscription.deleted: unable to resolve workspace for customer ${customerId}`)
  }

  await prisma.subscription.update({
    where: { workspaceId },
    data: {
      plan:                 'FREE',
      status:               'canceled',
      stripeStatus:         'canceled',
      stripeSubscriptionId: null,
      stripePriceId:        null,
      cancelAtPeriodEnd:    false,
      pastDueAt:            null,
      graceEndsAt:          null,
    },
  })
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const customerId     = invoice.customer as string
  const subscriptionId = invoice.subscription as string

  if (!subscriptionId) return

  const sub = await stripe.subscriptions.retrieve(subscriptionId)

  const workspaceId = await resolveWorkspaceId(customerId)
  if (!workspaceId) {
    throw new Error(`invoice.paid: unable to resolve workspace for customer ${customerId}`)
  }

  const existing = await prisma.subscription.findUnique({
    where:  { workspaceId },
    select: { periodStart: true, stripeCurrentPeriodStart: true },
  })

  const newPeriodStart = new Date(sub.current_period_start * 1000)
  const oldPeriodStart = existing?.stripeCurrentPeriodStart ?? existing?.periodStart
  const periodChanged  = !oldPeriodStart || newPeriodStart.getTime() !== oldPeriodStart.getTime()

  await prisma.subscription.update({
    where: { workspaceId },
    data: {
      stripeCustomerId:         customerId,
      status:                   sub.status,
      stripeStatus:             sub.status,
      stripeCurrentPeriodStart: newPeriodStart,
      stripeCurrentPeriodEnd:   new Date(sub.current_period_end * 1000),
      currentPeriodEnd:         new Date(sub.current_period_end * 1000),
      cancelAtPeriodEnd:        sub.cancel_at_period_end,
      pastDueAt:   null,
      graceEndsAt: null,
      ...(periodChanged ? {
        qbrCount:       0,
        exportCount:    0,
        exportedQbrIds: '[]',
        periodStart:    newPeriodStart,
      } : {}),
    },
  })
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId     = invoice.customer as string
  const subscriptionId = invoice.subscription as string

  if (!subscriptionId) return

  const sub = await stripe.subscriptions.retrieve(subscriptionId)

  const workspaceId = await resolveWorkspaceId(customerId)
  if (!workspaceId) {
    throw new Error(`invoice.payment_failed: unable to resolve workspace for customer ${customerId}`)
  }

  const existing = await prisma.subscription.findUnique({
    where:  { workspaceId },
    select: { pastDueAt: true },
  })

  const now = new Date()
  const graceUpdate = existing?.pastDueAt
    ? {}
    : { pastDueAt: now, graceEndsAt: new Date(now.getTime() + PAYMENT_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000) }

  await prisma.subscription.update({
    where: { workspaceId },
    data: { status: sub.status, stripeStatus: sub.status, ...graceUpdate },
  })

  await sendPaymentFailedEmail(workspaceId).catch(err => {
    console.error('[webhook] Payment failed email error:', err?.message)
  })
}

async function sendPaymentFailedEmail(workspaceId: string): Promise<void> {
  const workspace = await prisma.workspace.findUnique({
    where:   { id: workspaceId },
    include: { members: { where: { role: 'OWNER' }, include: { user: true }, take: 1 } },
  })

  const ownerEmail = workspace?.members[0]?.user?.email
  if (!ownerEmail) {
    console.warn('[webhook] No owner email found for workspace', workspaceId)
    return
  }

  const { Resend } = await import('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)

  await resend.emails.send({
    from:    'billing@misecuretechsolutions.com',
    to:      ownerEmail,
    subject: 'Action required: Payment failed for QBR Deck',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #0C101C;">Payment failed</h2>
        <p style="color: #374151;">
          We were unable to process your payment for <strong>QBR Deck</strong>.
          Your account will remain active for <strong>${PAYMENT_GRACE_PERIOD_DAYS} days</strong>
          while you update your payment details.
        </p>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing"
           style="display:inline-block;margin-top:16px;padding:12px 24px;background:#0C101C;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
          Update payment method
        </a>
        <p style="color: #9CA3AF; font-size: 12px; margin-top: 24px;">
          If you have questions, contact us at support@misecuretechsolutions.com
        </p>
      </div>
    `,
  })
}

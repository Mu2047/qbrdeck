// app/api/webhooks/stripe/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Hardened Stripe webhook handler.
//
// SECURITY:
//   - Signature verified before any processing
//   - No secrets, tokens, or payloads logged
//   - Plan mapped server-side from price ID — never trusted from client
//
// IDEMPOTENCY:
//   - Every event checked against StripeEvent table before processing
//   - Duplicate events return 200 without reapplying changes
//   - Failed events are safely retryable
//
// GRACE PERIOD:
//   - pastDueAt set only on FIRST payment failure — not reset on Stripe retries
//   - graceEndsAt = pastDueAt + PAYMENT_GRACE_PERIOD_DAYS
//   - Both cleared on payment recovery
//   - Grace enforcement handled in lib/subscription-access.ts
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { PAYMENT_GRACE_PERIOD_DAYS } from '@/lib/subscription-access'
import type Stripe from 'stripe'

// ── Plan mapping — server-side only ──────────────────────────────────────────

function getPlanFromPriceId(priceId?: string): 'FREE' | 'SOLO' | 'GROWTH' | 'AGENCY' {
  if (!priceId) return 'FREE'
  if (priceId === process.env.STRIPE_PRICE_SOLO)   return 'SOLO'
  if (priceId === process.env.STRIPE_PRICE_GROWTH) return 'GROWTH'
  if (priceId === process.env.STRIPE_PRICE_AGENCY) return 'AGENCY'
  return 'FREE'
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig  = req.headers.get('stripe-signature')

  if (!sig) {
    console.error('[webhook] Missing stripe-signature header')
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  // ── 1. Verify signature before anything else ──────────────────────────────
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err: any) {
    console.error('[webhook] Signature verification failed:', err.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const { id: stripeEventId, type: eventType } = event

  // ── 2. Idempotency check ──────────────────────────────────────────────────
  const existingEvent = await prisma.stripeEvent.findUnique({
    where: { stripeEventId },
  })

  if (existingEvent) {
    if (existingEvent.status === 'PROCESSED') {
      // Already handled — return success without reapplying
      return NextResponse.json({ received: true, idempotent: true })
    }
    if (existingEvent.status === 'PROCESSING') {
      // In-flight — another instance is handling it
      return NextResponse.json({ received: true, processing: true })
    }
    // FAILED or RECEIVED — allow retry
  }

  // ── 3. Record event as PROCESSING ────────────────────────────────────────
  await prisma.stripeEvent.upsert({
    where:  { stripeEventId },
    update: {
      status:     'PROCESSING',
      retryCount: { increment: existingEvent ? 1 : 0 },
      updatedAt:  new Date(),
    },
    create: {
      stripeEventId,
      eventType,
      status:    'PROCESSING',
      receivedAt: new Date(),
    },
  })

  // ── 4. Process event ──────────────────────────────────────────────────────
  try {
    await handleEvent(event)

    // Mark as PROCESSED
    await prisma.stripeEvent.update({
      where: { stripeEventId },
      data: {
        status:      'PROCESSED',
        processedAt: new Date(),
        errorMessage: null,
      },
    })

    return NextResponse.json({ received: true })

  } catch (err: any) {
    // Mark as FAILED — safe to retry
    const safeMessage = typeof err.message === 'string'
      ? err.message.slice(0, 500)  // truncate, never expose full stack or secrets
      : 'Unknown error'

    console.error(`[webhook] Handler failed for ${eventType} (${stripeEventId}):`, safeMessage)

    await prisma.stripeEvent.update({
      where: { stripeEventId },
      data: {
        status:       'FAILED',
        errorMessage: safeMessage,
      },
    })

    // Return 500 so Stripe retries
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }
}

// ── Event handlers ────────────────────────────────────────────────────────────

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
      // Unhandled event types — not an error, just log and acknowledge
      console.log(`[webhook] Unhandled event type: ${event.type}`)
  }
}

// ── checkout.session.completed ────────────────────────────────────────────────

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const customerId     = session.customer as string
  const subscriptionId = session.subscription as string
  const workspaceId    = session.metadata?.workspaceId

  if (!subscriptionId) {
    console.warn('[webhook] checkout.session.completed: no subscriptionId')
    return
  }

  // Retrieve full subscription from Stripe — never trust client metadata for plan
  const sub     = await stripe.subscriptions.retrieve(subscriptionId)
  const priceId = sub.items.data[0]?.price.id
  const plan    = getPlanFromPriceId(priceId)

  const subscriptionData = {
    stripeCustomerId:        customerId,
    stripeSubscriptionId:    subscriptionId,
    stripePriceId:           priceId,
    plan,
    status:                  sub.status,
    stripeStatus:            sub.status,
    stripeCurrentPeriodStart: new Date(sub.current_period_start * 1000),
    stripeCurrentPeriodEnd:   new Date(sub.current_period_end   * 1000),
    currentPeriodEnd:         new Date(sub.current_period_end   * 1000),
    periodStart:              new Date(sub.current_period_start * 1000),
    cancelAtPeriodEnd:        sub.cancel_at_period_end,
    // Reset usage counters for new subscription
    qbrCount:    0,
    exportCount: 0,
    // Clear any stale payment-failure state
    pastDueAt:   null,
    graceEndsAt: null,
  }

  if (workspaceId) {
    await prisma.subscription.upsert({
      where:  { workspaceId },
      update: subscriptionData,
      create: { workspaceId, ...subscriptionData, exportedQbrIds: '[]' },
    })
  } else {
    // Fallback — look up by customer ID
    const existing = await prisma.subscription.findUnique({
      where: { stripeCustomerId: customerId },
    })
    if (existing) {
      await prisma.subscription.update({
        where: { stripeCustomerId: customerId },
        data:  subscriptionData,
      })
    } else {
      console.error('[webhook] checkout.session.completed: no workspace found for customer', customerId)
    }
  }
}

// ── customer.subscription.updated / created ───────────────────────────────────

async function handleSubscriptionUpdated(sub: Stripe.Subscription): Promise<void> {
  const customerId = sub.customer as string
  const priceId    = sub.items.data[0]?.price.id
  const plan       = getPlanFromPriceId(priceId)

  // Only clear pastDueAt/graceEndsAt if Stripe status indicates recovery
  const isRecovered = sub.status === 'active' || sub.status === 'trialing'

  await prisma.subscription.update({
    where: { stripeCustomerId: customerId },
    data: {
      plan,
      status:                  sub.status,
      stripeStatus:            sub.status,
      stripePriceId:           priceId,
      stripeSubscriptionId:    sub.id,
      stripeCurrentPeriodStart: new Date(sub.current_period_start * 1000),
      stripeCurrentPeriodEnd:   new Date(sub.current_period_end   * 1000),
      currentPeriodEnd:         new Date(sub.current_period_end   * 1000),
      cancelAtPeriodEnd:        sub.cancel_at_period_end,
      // Only clear payment-failure state on confirmed recovery
      ...(isRecovered ? { pastDueAt: null, graceEndsAt: null } : {}),
    },
  })
}

// ── customer.subscription.deleted ────────────────────────────────────────────

async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const customerId = sub.customer as string

  await prisma.subscription.update({
    where: { stripeCustomerId: customerId },
    data: {
      plan:                 'FREE',
      status:               'canceled',
      stripeStatus:         'canceled',
      stripeSubscriptionId: null,
      stripePriceId:        null,
      cancelAtPeriodEnd:    false,
      // Clear grace state — no active subscription, no grace period
      pastDueAt:            null,
      graceEndsAt:          null,
      // Preserve: workspaceId, stripeCustomerId, qbrCount, exportCount,
      //           exportedQbrIds, clients, QBRs, ExportEvents, members
    },
  })
  // Data (clients, QBRs, ExportEvents, team) is preserved — cascade is on
  // workspace deletion only, not subscription status change
}

// ── invoice.paid ──────────────────────────────────────────────────────────────

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const customerId     = invoice.customer as string
  const subscriptionId = invoice.subscription as string

  if (!subscriptionId) return  // one-time payment, not a subscription invoice

  // Retrieve current subscription state from Stripe
  const sub = await stripe.subscriptions.retrieve(subscriptionId)

  const existing = await prisma.subscription.findUnique({
    where: { stripeCustomerId: customerId },
    select: { periodStart: true, stripeCurrentPeriodStart: true },
  })

  const newPeriodStart = new Date(sub.current_period_start * 1000)
  const oldPeriodStart = existing?.stripeCurrentPeriodStart ?? existing?.periodStart

  // Only reset usage counters when billing period actually changed
  // Prevents resetting counters on duplicate invoice.paid events
  const periodChanged = !oldPeriodStart ||
    newPeriodStart.getTime() !== oldPeriodStart.getTime()

  await prisma.subscription.update({
    where: { stripeCustomerId: customerId },
    data: {
      status:                  sub.status,
      stripeStatus:            sub.status,
      stripeCurrentPeriodStart: newPeriodStart,
      stripeCurrentPeriodEnd:   new Date(sub.current_period_end * 1000),
      currentPeriodEnd:         new Date(sub.current_period_end * 1000),
      cancelAtPeriodEnd:        sub.cancel_at_period_end,
      // Clear payment-failure state on successful payment
      pastDueAt:   null,
      graceEndsAt: null,
      // Reset usage counters only for new billing period
      ...(periodChanged ? {
        qbrCount:      0,
        exportCount:   0,
        exportedQbrIds: '[]',
        periodStart:   newPeriodStart,
      } : {}),
    },
  })
  // ExportEvent records are preserved — only counters reset
}

// ── invoice.payment_failed ────────────────────────────────────────────────────

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId     = invoice.customer as string
  const subscriptionId = invoice.subscription as string

  if (!subscriptionId) return

  const sub = await stripe.subscriptions.retrieve(subscriptionId)

  const existing = await prisma.subscription.findUnique({
    where:  { stripeCustomerId: customerId },
    select: { pastDueAt: true, graceEndsAt: true, workspaceId: true },
  })

  const now = new Date()

  // Only set pastDueAt/graceEndsAt on FIRST failure — not on Stripe retries
  // This prevents the grace period from being extended by each retry
  const graceUpdate = existing?.pastDueAt
    ? {}  // Already in grace period — preserve original timestamps
    : {
        pastDueAt:   now,
        graceEndsAt: new Date(now.getTime() + PAYMENT_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000),
      }

  await prisma.subscription.update({
    where: { stripeCustomerId: customerId },
    data: {
      status:       sub.status,
      stripeStatus: sub.status,
      ...graceUpdate,
    },
  })

  // Send payment failed email — after DB update so we don't email on DB failure
  if (existing?.workspaceId) {
    await sendPaymentFailedEmail(existing.workspaceId).catch(err => {
      // Log but don't throw — email failure should not fail the webhook
      console.error('[webhook] Payment failed email error:', err?.message)
    })
  }
}

// ── Payment failed email ──────────────────────────────────────────────────────

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

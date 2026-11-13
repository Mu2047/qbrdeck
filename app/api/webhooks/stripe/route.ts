import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { PAYMENT_GRACE_PERIOD_DAYS } from '@/lib/subscription-access'
import { getSubscriptionPeriod } from '@/lib/stripe-subscription-period'
import { resolvePlanFromStripePrice } from '@/lib/billing/regional-prices'
import { resolveInvoiceSubscription } from '@/lib/stripe-invoice-subscription'
import type Stripe from 'stripe'

// Plan comes ONLY from an approved Stripe Price mapping (any region/currency
// of a plan resolves to that one plan). An unknown or missing Price throws
// BEFORE any Subscription write, so the event is marked FAILED, Stripe
// retries, and the workspace keeps its current plan — it is never silently
// downgraded to FREE. customer.subscription.deleted is the only FREE path.
function getPlanFromPriceId(priceId?: string): 'SOLO' | 'GROWTH' | 'AGENCY' {
  return resolvePlanFromStripePrice(priceId)
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

// ─── Subscription authority ─────────────────────────────────────────────────
// Webhooks arrive late, retried and out of order. The workspace's stored
// stripeSubscriptionId is the current owner; an event for any other
// subscription may only replace it when Stripe's CURRENT state proves the
// incoming subscription is live and strictly newer. Anything uncertain fails
// closed: either a no-op (stored state kept) or a thrown error (event FAILED,
// Stripe retries) — never a downgrade or an overwrite.

const LIVE_STATUSES     = new Set<string>(['active', 'trialing'])
const TERMINAL_STATUSES = new Set<string>(['canceled', 'incomplete_expired'])

async function loadStored(workspaceId: string): Promise<{ exists: boolean; storedId: string | null }> {
  const row = await prisma.subscription.findUnique({
    where:  { workspaceId },
    select: { stripeSubscriptionId: true },
  })
  return { exists: !!row, storedId: row?.stripeSubscriptionId ?? null }
}

// Not-found → null (the stored subscription is gone). Any other Stripe error
// throws, so an outage can never be mistaken for "stored subscription gone".
async function retrieveSubscriptionOrNull(id: string): Promise<Stripe.Subscription | null> {
  try {
    return await stripe.subscriptions.retrieve(id)
  } catch (err: any) {
    if (err?.code === 'resource_missing' || err?.statusCode === 404) return null
    throw err
  }
}

type Authority =
  | { apply: true }
  | { apply: false; reason: 'terminal' | 'not-live' | 'older' | 'tie' }

// `incoming` must be Stripe's current copy, never a raw webhook payload.
// Stripe `created` has 1-second resolution: only STRICTLY newer replaces the
// stored subscription; an equal timestamp keeps what is stored.
async function decideAuthority(storedId: string | null, incoming: Stripe.Subscription): Promise<Authority> {
  if (incoming.id === storedId)               return { apply: true }
  if (TERMINAL_STATUSES.has(incoming.status)) return { apply: false, reason: 'terminal' }
  if (!storedId)                              return { apply: true }
  if (!LIVE_STATUSES.has(incoming.status))    return { apply: false, reason: 'not-live' }

  const stored = await retrieveSubscriptionOrNull(storedId)
  if (!stored || TERMINAL_STATUSES.has(stored.status)) return { apply: true }
  if (incoming.created > stored.created)               return { apply: true }
  return { apply: false, reason: incoming.created === stored.created ? 'tie' : 'older' }
}

// The newest live subscription for a customer other than `excludeId`. Throws
// rather than guess when the answer cannot be determined safely.
async function findNewestLiveSubscription(customerId: string, excludeId: string): Promise<Stripe.Subscription | null> {
  // The default list status already excludes canceled subscriptions.
  const page = await stripe.subscriptions.list({ customer: customerId, limit: 100 })
  if (page.has_more) {
    throw new Error(`customer ${customerId} has too many subscriptions to choose a replacement safely`)
  }

  const live = page.data
    .filter(s => s.id !== excludeId && LIVE_STATUSES.has(s.status))
    .sort((a, b) => b.created - a.created)

  if (live.length === 0) return null
  if (live.length > 1 && live[0].created === live[1].created) {
    throw new Error(`customer ${customerId} has ambiguous newest live subscriptions (${live[0].id}, ${live[1].id})`)
  }
  return live[0]
}

// The single write path for a subscription that has authority over an
// existing workspace row. Conditional on the stored id still being
// `previousId`: a concurrent change makes the write miss, and it throws so
// Stripe retries against fresh state. Usage resets only when ownership
// actually changes.
async function applySubscriptionState(
  workspaceId: string,
  sub: Stripe.Subscription,
  previousId: string | null,
): Promise<void> {
  const customerId       = sub.customer as string
  const priceId          = sub.items.data[0]?.price.id
  const plan             = getPlanFromPriceId(priceId)
  const isRecovered      = LIVE_STATUSES.has(sub.status)
  const ownershipChanged = sub.id !== previousId
  const period           = getSubscriptionPeriod(sub, priceId)

  const result = await prisma.subscription.updateMany({
    where: { workspaceId, stripeSubscriptionId: previousId },
    data: {
      plan,
      status:                   sub.status,
      stripeStatus:             sub.status,
      stripePriceId:            priceId,
      stripeSubscriptionId:     sub.id,
      stripeCustomerId:         customerId,
      stripeCurrentPeriodStart: period.start,
      stripeCurrentPeriodEnd:   period.end,
      currentPeriodEnd:         period.end,
      cancelAtPeriodEnd:        sub.cancel_at_period_end,
      ...(isRecovered ? { pastDueAt: null, graceEndsAt: null } : {}),
      ...(ownershipChanged ? { qbrCount: 0, exportCount: 0, periodStart: period.start } : {}),
    },
  })
  assertWritten(result.count, workspaceId, previousId)
}

function assertWritten(count: number, workspaceId: string, expectedId: string | null): void {
  if (count === 0) {
    throw new Error(
      `stale write for workspace ${workspaceId}: stored subscription is no longer ${expectedId ?? 'none'}; retrying against fresh state`
    )
  }
}

function logIgnored(eventType: string, subscriptionId: string, storedId: string | null, reason: string): void {
  console.warn(`[webhook] ${eventType}: ignoring ${subscriptionId} (${reason}); workspace owns ${storedId ?? 'none'}`)
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

  const sub = await stripe.subscriptions.retrieve(subscriptionId)

  const workspaceId = session.metadata?.workspaceId ?? await resolveWorkspaceId(customerId)

  if (!workspaceId) {
    throw new Error(`checkout.session.completed: unable to resolve workspace for customer ${customerId}`)
  }

  // Existing row: a delayed checkout for an older (or now-ended) subscription
  // must not replace a newer one, and a retried checkout for the current
  // subscription must not reset usage — applySubscriptionState handles both.
  const { exists, storedId } = await loadStored(workspaceId)
  if (exists) {
    const authority = await decideAuthority(storedId, sub)
    if (!authority.apply) {
      logIgnored('checkout.session.completed', sub.id, storedId, authority.reason)
      return
    }
    await applySubscriptionState(workspaceId, sub, storedId)
    return
  }

  // No row yet: first subscription for this workspace. create (not upsert) so
  // a concurrent first write fails and is retried instead of overwritten.
  const priceId = sub.items.data[0]?.price.id
  const plan    = getPlanFromPriceId(priceId)
  const period  = getSubscriptionPeriod(sub, priceId)

  const subscriptionData = {
    stripeCustomerId:         customerId,
    stripeSubscriptionId:     subscriptionId,
    stripePriceId:            priceId,
    plan,
    status:                   sub.status,
    stripeStatus:             sub.status,
    stripeCurrentPeriodStart: period.start,
    stripeCurrentPeriodEnd:   period.end,
    currentPeriodEnd:         period.end,
    periodStart:              period.start,
    cancelAtPeriodEnd:        sub.cancel_at_period_end,
    qbrCount:    0,
    exportCount: 0,
    pastDueAt:   null,
    graceEndsAt: null,
  }

  await prisma.subscription.create({
    data: { workspaceId, ...subscriptionData, exportedQbrIds: '[]' },
  })
}

async function handleSubscriptionUpdated(eventSub: Stripe.Subscription): Promise<void> {
  // The payload may be stale or out of order; Stripe's current state wins.
  const sub        = await stripe.subscriptions.retrieve(eventSub.id)
  const customerId = sub.customer as string

  const workspaceId = await resolveWorkspaceId(customerId)
  if (!workspaceId) {
    throw new Error(`customer.subscription.updated: unable to resolve workspace for customer ${customerId}`)
  }

  const { storedId } = await loadStored(workspaceId)
  const authority = await decideAuthority(storedId, sub)
  if (!authority.apply) {
    logIgnored('customer.subscription.updated', sub.id, storedId, authority.reason)
    return
  }

  await applySubscriptionState(workspaceId, sub, storedId)
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const customerId = sub.customer as string

  const workspaceId = await resolveWorkspaceId(customerId)
  if (!workspaceId) {
    throw new Error(`customer.subscription.deleted: unable to resolve workspace for customer ${customerId}`)
  }

  // Only the workspace's current subscription may end it. A stale or retried
  // delete for a replaced subscription is acknowledged as a no-op.
  const { storedId } = await loadStored(workspaceId)
  if (storedId !== sub.id) {
    logIgnored('customer.subscription.deleted', sub.id, storedId, 'not current')
    return
  }

  // A newer live subscription whose own webhook has not been processed yet is
  // adopted directly, so the workspace never passes through FREE. Ambiguity
  // throws inside findNewestLiveSubscription (event FAILED, nothing written).
  const replacement = await findNewestLiveSubscription(customerId, sub.id)
  if (replacement) {
    await applySubscriptionState(workspaceId, replacement, storedId)
    return
  }

  // stripePriceId is deliberately NOT cleared: the last recognized Price is
  // kept as billing history so the Customer Portal can still route a former
  // subscriber to their currency's configuration (lib/billing/portal-config.ts).
  // It is NOT evidence of an active subscription or entitlement — plan, status
  // and stripeSubscriptionId are, and they are reset here.
  const result = await prisma.subscription.updateMany({
    where: { workspaceId, stripeSubscriptionId: sub.id },
    data: {
      plan:                 'FREE',
      status:               'canceled',
      stripeStatus:         'canceled',
      stripeSubscriptionId: null,
      cancelAtPeriodEnd:    false,
      pastDueAt:            null,
      graceEndsAt:          null,
    },
  })
  assertWritten(result.count, workspaceId, sub.id)
}

// ─── Invoice → subscription ─────────────────────────────────────────────────
// The subscription comes from the invoice payload via
// resolveInvoiceSubscription (newer `parent.subscription_details` shape and
// legacy `subscription`). An unresolvable subscription invoice throws (event
// FAILED, Stripe retries); only an invoice Stripe marks as unrelated to any
// subscription is acknowledged without effect.

function stripeIdOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null
  return typeof ref === 'string' ? ref : ref.id
}

function resolveInvoiceTarget(invoice: Stripe.Invoice, eventType: string): { customerId: string; subscriptionId: string } | null {
  const link = resolveInvoiceSubscription(invoice)
  if (link.kind === 'none') {
    console.log(`[webhook] ${eventType}: invoice ${invoice.id} is not subscription-generated; no billing state change`)
    return null
  }

  const customerId = stripeIdOf(invoice.customer)
  if (!customerId) throw new Error(`${eventType}: invoice ${invoice.id} has no customer`)

  return { customerId, subscriptionId: link.subscriptionId }
}

// The retrieved subscription must belong to the invoice's customer; anything
// else is drift that must not be written.
function assertSubscriptionCustomer(sub: Stripe.Subscription, customerId: string, eventType: string): void {
  if (stripeIdOf(sub.customer) !== customerId) {
    throw new Error(`${eventType}: subscription ${sub.id} does not belong to invoice customer ${customerId}`)
  }
}

async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const target = resolveInvoiceTarget(invoice, 'invoice.paid')
  if (!target) return
  const { customerId, subscriptionId } = target

  const workspaceId = await resolveWorkspaceId(customerId)
  if (!workspaceId) {
    throw new Error(`invoice.paid: unable to resolve workspace for customer ${customerId}`)
  }

  const existing = await prisma.subscription.findUnique({
    where:  { workspaceId },
    select: { periodStart: true, stripeCurrentPeriodStart: true, stripeSubscriptionId: true },
  })

  // Invoices never make a subscription current; one for an obsolete
  // subscription must not touch status, period or usage.
  if (!existing || existing.stripeSubscriptionId !== subscriptionId) {
    logIgnored('invoice.paid', subscriptionId, existing?.stripeSubscriptionId ?? null, 'not current')
    return
  }

  const sub    = await stripe.subscriptions.retrieve(subscriptionId)
  assertSubscriptionCustomer(sub, customerId, 'invoice.paid')
  const period = getSubscriptionPeriod(sub, sub.items.data[0]?.price.id)

  const newPeriodStart = period.start
  const oldPeriodStart = existing.stripeCurrentPeriodStart ?? existing.periodStart
  const periodChanged  = !oldPeriodStart || newPeriodStart.getTime() !== oldPeriodStart.getTime()

  const result = await prisma.subscription.updateMany({
    where: { workspaceId, stripeSubscriptionId: subscriptionId },
    data: {
      stripeCustomerId:         customerId,
      status:                   sub.status,
      stripeStatus:             sub.status,
      stripeCurrentPeriodStart: newPeriodStart,
      stripeCurrentPeriodEnd:   period.end,
      currentPeriodEnd:         period.end,
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
  assertWritten(result.count, workspaceId, subscriptionId)
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const target = resolveInvoiceTarget(invoice, 'invoice.payment_failed')
  if (!target) return
  const { customerId, subscriptionId } = target

  const workspaceId = await resolveWorkspaceId(customerId)
  if (!workspaceId) {
    throw new Error(`invoice.payment_failed: unable to resolve workspace for customer ${customerId}`)
  }

  const existing = await prisma.subscription.findUnique({
    where:  { workspaceId },
    select: { pastDueAt: true, stripeSubscriptionId: true },
  })

  // An obsolete subscription's failed invoice must not change status, start a
  // grace period, or email the owner.
  if (!existing || existing.stripeSubscriptionId !== subscriptionId) {
    logIgnored('invoice.payment_failed', subscriptionId, existing?.stripeSubscriptionId ?? null, 'not current')
    return
  }

  const sub = await stripe.subscriptions.retrieve(subscriptionId)
  assertSubscriptionCustomer(sub, customerId, 'invoice.payment_failed')

  const now = new Date()
  const graceUpdate = existing.pastDueAt
    ? {}
    : { pastDueAt: now, graceEndsAt: new Date(now.getTime() + PAYMENT_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000) }

  const result = await prisma.subscription.updateMany({
    where: { workspaceId, stripeSubscriptionId: subscriptionId },
    data: { status: sub.status, stripeStatus: sub.status, ...graceUpdate },
  })
  assertWritten(result.count, workspaceId, subscriptionId)

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

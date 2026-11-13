import type Stripe from 'stripe'

// Which Stripe Subscription an Invoice belongs to, across API versions.
//
// Stripe API 2025-03-31.basil removed the top-level `invoice.subscription`
// field and replaced it with `invoice.parent.subscription_details.subscription`
// (valid only when `invoice.parent.type === 'subscription_details'`):
//   https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects
// This account's webhook endpoint serializes events at 2026-04-22.dahlia (see
// lib/stripe-subscription-period.ts and commit d411a886), so webhook invoices
// carry only `parent`. lib/stripe.ts pins 2024-04-10 and the installed SDK
// (stripe@15) types only the legacy field, so both shapes are read here and
// the newer one is declared locally.
//
// Fails closed: a subscription-generated invoice whose subscription cannot be
// determined unambiguously throws, so the webhook event is marked FAILED and
// Stripe retries — it is never acknowledged as a successful no-op.

type SubscriptionRef = string | { id: string } | null | undefined

// `invoice.parent` as documented for 2025-03-31.basil and later.
export interface InvoiceParent {
  type: 'subscription_details' | 'quote_details' | (string & {})
  subscription_details?: {
    subscription?: SubscriptionRef
    metadata?:     Stripe.Metadata | null
  } | null
  quote_details?: { quote?: string } | null
}

// The fields read here, from either API shape. Stripe.Invoice (legacy) is
// assignable to this, as is a newer-version payload without `subscription`.
export type InvoiceSubscriptionFields = Pick<Stripe.Invoice, 'id' | 'billing_reason'> & {
  subscription?: SubscriptionRef
  parent?:       InvoiceParent | null
}

export type InvoiceSubscriptionLink =
  | { kind: 'subscription'; subscriptionId: string }
  // Stripe itself marks the invoice as unrelated to any subscription.
  | { kind: 'none' }

export class InvoiceSubscriptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceSubscriptionError'
  }
}

function subscriptionIdOf(ref: SubscriptionRef, field: string, invoiceId: string): string | null {
  if (ref === null || ref === undefined) return null
  const id = typeof ref === 'string' ? ref : ref?.id
  if (typeof id !== 'string' || !id.startsWith('sub_')) {
    throw new InvoiceSubscriptionError(`invoice ${invoiceId}: ${field} is not a Stripe Subscription reference`)
  }
  return id
}

export function resolveInvoiceSubscription(invoice: InvoiceSubscriptionFields): InvoiceSubscriptionLink {
  const invoiceId = invoice.id ?? 'unknown'

  const legacyId = subscriptionIdOf(invoice.subscription, 'invoice.subscription', invoiceId)

  let parentId: string | null = null
  if (invoice.parent?.type === 'subscription_details') {
    parentId = subscriptionIdOf(
      invoice.parent.subscription_details?.subscription,
      'invoice.parent.subscription_details.subscription',
      invoiceId,
    )
    if (!parentId) {
      throw new InvoiceSubscriptionError(
        `invoice ${invoiceId}: parent.type is subscription_details but parent.subscription_details.subscription is missing`
      )
    }
  }

  if (parentId && legacyId && parentId !== legacyId) {
    throw new InvoiceSubscriptionError(
      `invoice ${invoiceId}: invoice.subscription and invoice.parent.subscription_details.subscription disagree`
    )
  }

  const subscriptionId = parentId ?? legacyId
  if (subscriptionId) return { kind: 'subscription', subscriptionId }

  // billing_reason 'manual' is Stripe's documented "unrelated to a
  // subscription" (e.g. a one-off invoice from the Dashboard). Anything else
  // without a subscription reference cannot be associated safely.
  if (invoice.billing_reason === 'manual') return { kind: 'none' }

  throw new InvoiceSubscriptionError(
    `invoice ${invoiceId}: no subscription reference (billing_reason ${invoice.billing_reason ?? 'null'}, parent.type ${invoice.parent?.type ?? 'null'})`
  )
}

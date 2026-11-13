import { describe, it, expect } from 'vitest'
import type Stripe from 'stripe'
import {
  resolveInvoiceSubscription,
  InvoiceSubscriptionError,
  type InvoiceSubscriptionFields,
  type InvoiceParent,
} from '@/lib/stripe-invoice-subscription'

// Unit tests for resolving an Invoice's Subscription across Stripe API
// versions. Shapes follow Stripe's documentation:
//   legacy (≤ 2024-04-10, installed stripe@15 types): invoice.subscription
//   2025-03-31.basil and later (this account's webhooks: 2026-04-22.dahlia):
//     invoice.parent = { type: 'subscription_details',
//                        subscription_details: { subscription, metadata } }
//   https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects

// Compile-time: the installed SDK's Stripe.Invoice is accepted as-is, so the
// webhook handler passes its event object without a cast.
type LegacyInvoiceAccepted = Stripe.Invoice extends InvoiceSubscriptionFields ? true : false
const legacyInvoiceAccepted: LegacyInvoiceAccepted = true

const SUB = 'sub_1UZRvUQZ9Ibszi22uB2F0BbR'

function legacy(subscription: InvoiceSubscriptionFields['subscription'], billing_reason: Stripe.Invoice.BillingReason | null = 'subscription_cycle'): InvoiceSubscriptionFields {
  return { id: 'in_legacy', billing_reason, subscription }
}

function subscriptionParent(subscription: string | { id: string } | null | undefined): InvoiceParent {
  return { type: 'subscription_details', subscription_details: { subscription, metadata: {} } }
}

// Newer payloads have no top-level `subscription` key at all.
function current(parent: InvoiceParent | null, billing_reason: Stripe.Invoice.BillingReason | null = 'subscription_cycle'): InvoiceSubscriptionFields {
  return { id: 'in_current', billing_reason, parent }
}

describe('resolveInvoiceSubscription — legacy invoice.subscription', () => {
  it('the SDK Invoice type is accepted without a cast', () => {
    expect(legacyInvoiceAccepted).toBe(true)
  })

  it('a string subscription ID resolves', () => {
    expect(resolveInvoiceSubscription(legacy(SUB))).toEqual({ kind: 'subscription', subscriptionId: SUB })
  })

  it('an expanded subscription object resolves to its id', () => {
    expect(resolveInvoiceSubscription(legacy({ id: SUB }))).toEqual({ kind: 'subscription', subscriptionId: SUB })
  })
})

describe('resolveInvoiceSubscription — parent.subscription_details (2025-03-31.basil+)', () => {
  it('a string subscription ID resolves', () => {
    expect(resolveInvoiceSubscription(current(subscriptionParent(SUB)))).toEqual({ kind: 'subscription', subscriptionId: SUB })
  })

  it('an expanded subscription object resolves to its id', () => {
    expect(resolveInvoiceSubscription(current(subscriptionParent({ id: SUB })))).toEqual({ kind: 'subscription', subscriptionId: SUB })
  })

  it('both shapes present and agreeing resolves', () => {
    const invoice: InvoiceSubscriptionFields = { ...current(subscriptionParent(SUB)), subscription: SUB }
    expect(resolveInvoiceSubscription(invoice)).toEqual({ kind: 'subscription', subscriptionId: SUB })
  })
})

describe('resolveInvoiceSubscription — fails closed', () => {
  it('both shapes present but disagreeing throws', () => {
    const invoice: InvoiceSubscriptionFields = { ...current(subscriptionParent(SUB)), subscription: 'sub_other' }
    expect(() => resolveInvoiceSubscription(invoice)).toThrow(InvoiceSubscriptionError)
  })

  it.each([undefined, null])('parent.type subscription_details with subscription %j throws', (subscription) => {
    expect(() => resolveInvoiceSubscription(current(subscriptionParent(subscription)))).toThrow(/subscription_details\.subscription is missing/)
  })

  it('parent.type subscription_details with no subscription_details hash throws', () => {
    expect(() => resolveInvoiceSubscription(current({ type: 'subscription_details', subscription_details: null }))).toThrow(InvoiceSubscriptionError)
  })

  it.each(['subscription_cycle', 'subscription_create', 'subscription_update', 'subscription_threshold', null] as const)(
    'no reference in either shape (billing_reason %j) throws — never a silent no-op',
    (reason) => {
      expect(() => resolveInvoiceSubscription(current(null, reason))).toThrow(/no subscription reference/)
      expect(() => resolveInvoiceSubscription(legacy(null, reason))).toThrow(/no subscription reference/)
    },
  )

  it('a quote_details parent without a subscription reference throws', () => {
    expect(() => resolveInvoiceSubscription(current({ type: 'quote_details', quote_details: { quote: 'qt_1' } }, 'quote_accept'))).toThrow(InvoiceSubscriptionError)
  })

  it.each(['', 'in_123', 'cus_1', 'price_1'])('a malformed subscription reference %j throws', (ref) => {
    expect(() => resolveInvoiceSubscription(legacy(ref))).toThrow(/not a Stripe Subscription reference/)
    expect(() => resolveInvoiceSubscription(current(subscriptionParent({ id: ref })))).toThrow(/not a Stripe Subscription reference/)
  })
})

describe('resolveInvoiceSubscription — invoices Stripe marks as unrelated to a subscription', () => {
  it.each([
    ['newer shape', current(null, 'manual')],
    ['legacy shape', legacy(null, 'manual')],
  ])('billing_reason manual with no subscription reference (%s) → none', (_label, invoice) => {
    expect(resolveInvoiceSubscription(invoice)).toEqual({ kind: 'none' })
  })

  it('a manual invoice that does reference a subscription still resolves to it', () => {
    expect(resolveInvoiceSubscription(current(subscriptionParent(SUB), 'manual'))).toEqual({ kind: 'subscription', subscriptionId: SUB })
  })
})

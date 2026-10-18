// lib/billing/checkout-request.ts
// ─────────────────────────────────────────────────────────────────────────────
// Pure validation for POST /api/billing/checkout. Turns an untrusted request
// body into a server-controlled RegionalPrice, or a rejection.
//
// Canonical body:   { plan: 'SOLO'|'GROWTH'|'AGENCY', region, currency }
//
// LEGACY (transition release only): { priceId } is accepted ONLY when it is
// exactly one of the configured, checkout-enabled USD Price IDs. Any other
// Price ID — and any body mixing priceId with other fields — is rejected.
// Remove once no deployed client sends { priceId }.
//
// Any extra field (amount, unit_amount, price, …) is rejected outright; the
// amount is always the approved server-side amount behind the Stripe Price.
// ─────────────────────────────────────────────────────────────────────────────

import { isBillingCurrency } from './currencies'
import { isBillingRegion, currencyForRegion } from './regions'
import {
  BillingConfigError,
  getRegionalPrice,
  getRegionalPriceTable,
  isPaidPlan,
  type RegionalPrice,
} from './regional-prices'

type PriceEnv = Record<string, string | undefined>

export type CheckoutRequestResult =
  | { ok: true; price: RegionalPrice & { stripePriceId: string } }
  | { ok: false; status: 400 | 500; error: string }

const CANONICAL_KEYS = new Set(['plan', 'region', 'currency'])

function reject(error: string, status: 400 | 500 = 400): CheckoutRequestResult {
  return { ok: false, status, error }
}

export function parseCheckoutRequest(body: unknown, env: PriceEnv = process.env): CheckoutRequestResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reject('Invalid request')
  const fields = body as Record<string, unknown>
  const keys   = Object.keys(fields)

  try {
    // ── Legacy { priceId } — USD only, exact configured match only ──────────
    if ('priceId' in fields) {
      if (keys.length !== 1 || typeof fields.priceId !== 'string') return reject('Invalid plan selected')
      const match = getRegionalPriceTable(env).find(p =>
        p.currency === 'USD' && p.checkoutEnabled && p.stripePriceId === fields.priceId
      )
      if (!match?.stripePriceId) return reject('Invalid plan selected')
      return { ok: true, price: { ...match, stripePriceId: match.stripePriceId } }
    }

    // ── Canonical { plan, region, currency } ────────────────────────────────
    if (keys.some(k => !CANONICAL_KEYS.has(k))) return reject('Invalid request')

    const { plan, region, currency } = fields
    if (!isPaidPlan(plan))             return reject('Invalid plan selected')
    if (!isBillingRegion(region))      return reject('Unsupported billing region')
    if (!isBillingCurrency(currency))  return reject('Unsupported billing currency')
    if (currencyForRegion(region) !== currency)
      return reject('Currency does not match the selected billing region')

    const price = getRegionalPrice(plan, region, env)
    if (!price.checkoutEnabled || !price.stripePriceId)
      return reject('Checkout is not available for this billing region yet')

    return { ok: true, price: { ...price, stripePriceId: price.stripePriceId } }
  } catch (err) {
    if (err instanceof BillingConfigError) return reject('Billing is temporarily unavailable', 500)
    throw err
  }
}

// ── Duplicate-subscription guard ─────────────────────────────────────────────
// A workspace that already has a live Stripe subscription must not start a
// second one through Checkout. Plan changes go through subscription
// management, never a parallel subscription.

const TERMINAL_STRIPE_STATUSES = new Set(['canceled', 'incomplete_expired'])

export interface CheckoutGuardSubscription {
  plan:                 string
  status:               string
  stripeStatus:         string | null
  stripeSubscriptionId: string | null
}

export function hasLivePaidSubscription(sub: CheckoutGuardSubscription | null | undefined): boolean {
  if (!sub) return false
  if (sub.plan !== 'FREE') return true
  return !!sub.stripeSubscriptionId && !TERMINAL_STRIPE_STATUSES.has(sub.stripeStatus ?? sub.status)
}

export const EXISTING_SUBSCRIPTION_MESSAGE =
  'This workspace already has a subscription. Use Manage Subscription to change or cancel your plan.'

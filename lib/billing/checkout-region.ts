// lib/billing/checkout-region.ts
// ─────────────────────────────────────────────────────────────────────────────
// Which billing region the billing page shows and sends to checkout. Pure — no
// Stripe, no DB.
//
// The page offers a region only when the server would accept a checkout for
// it (getAvailableRegions), so a hidden or forged region never gets further
// than the server-side validation in lib/billing/checkout-request.ts. In
// Production this is always ['GLOBAL'], so no selector is ever rendered.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_REGION, currencyForRegion, type BillingRegion } from './regions'
import type { BillingCurrency } from './currencies'
import { getAvailableRegions, type PaidPlan } from './regional-prices'

type PriceEnv = Record<string, string | undefined>

export function selectableRegions(env: PriceEnv = process.env): BillingRegion[] {
  return getAvailableRegions(env)
}

// Untrusted input (a query parameter). Anything not currently selectable —
// unknown, disabled, wrong type — resolves to the default region.
export function resolvePageRegion(requested: unknown, env: PriceEnv = process.env): BillingRegion {
  const selectable = selectableRegions(env)
  return typeof requested === 'string' && (selectable as string[]).includes(requested)
    ? (requested as BillingRegion)
    : DEFAULT_REGION
}

export interface CheckoutRequestBody {
  plan:     PaidPlan
  region:   BillingRegion
  currency: BillingCurrency
}

// Currency is always derived from the region, never chosen separately.
export function checkoutRequestBody(plan: PaidPlan, region: BillingRegion): CheckoutRequestBody {
  return { plan, region, currency: currencyForRegion(region) }
}

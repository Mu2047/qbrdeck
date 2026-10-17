// lib/billing/regional-prices.ts
// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for paid-plan prices and Stripe Price → Plan mapping.
//
// RULES:
//   - Entitlements live in lib/limits.ts only. Nothing here carries a limit or
//     feature flag; every regional price resolves to a canonical PaidPlan and
//     lib/limits.ts decides what that plan can do. Currency, region, country
//     and amount NEVER determine entitlement.
//   - Approved amounts are reviewed code config, in Stripe minor units.
//   - Stripe Price IDs come from server env only. The browser never supplies
//     a Price ID or an amount that the server trusts.
//   - A region is purchasable only when the region is approved for checkout
//     in code AND every paid plan has a configured Stripe Price ID.
//   - `recognized` (webhook may map it) is separate from `checkoutEnabled`
//     (new customers may buy it), so a retired/grandfathered price can keep
//     resolving to its plan after it stops being sold.
//   - Unknown or missing Price IDs fail closed — they never resolve to FREE.
//
// Env naming:
//   STRIPE_PRICE_{PLAN}_{CURRENCY}   e.g. STRIPE_PRICE_SOLO_USD, STRIPE_PRICE_AGENCY_XOF
//   USD also accepts the legacy STRIPE_PRICE_{PLAN} names. If both the new and
//   legacy USD names are set to different values, configuration fails closed.
// ─────────────────────────────────────────────────────────────────────────────

import type { PlanKey } from '@/lib/limits'
import type { BillingCurrency } from './currencies'
import { REGIONS, type BillingRegion } from './regions'
import { formatPrice } from './format-price'

export type PaidPlan = Exclude<PlanKey, 'FREE'>

export const PAID_PLANS: readonly PaidPlan[] = ['SOLO', 'GROWTH', 'AGENCY']

export function isPaidPlan(value: unknown): value is PaidPlan {
  return typeof value === 'string' && (PAID_PLANS as readonly string[]).includes(value)
}

// ── Approved commercial amounts (minor units) ────────────────────────────────

export const APPROVED_PRICE_AMOUNTS: Record<BillingRegion, Record<PaidPlan, number>> = {
  GLOBAL:   { SOLO: 4_900,   GROWTH: 9_900,   AGENCY: 19_900 },   // $49 / $99 / $199
  GM:       { SOLO: 200_000, GROWTH: 400_000, AGENCY: 750_000 },  // D2,000 / D4,000 / D7,500
  XOF_ZONE: { SOLO: 15_000,  GROWTH: 30_000,  AGENCY: 55_000 },   // zero-decimal
}

// Code-level checkout gate. GM and XOF_ZONE stay false until their Stripe
// Prices exist and a controlled test checkout has been certified — setting a
// Price ID env var alone cannot make them purchasable.
export const CHECKOUT_APPROVED_REGIONS: Record<BillingRegion, boolean> = {
  GLOBAL:   true,
  GM:       false,
  XOF_ZONE: false,
}

export interface RegionalPrice {
  plan:            PaidPlan
  region:          BillingRegion
  currency:        BillingCurrency
  stripePriceId:   string | undefined
  unitAmountMinor: number
  checkoutEnabled: boolean
  recognized:      boolean
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class BillingConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BillingConfigError'
  }
}

export class UnknownStripePriceError extends Error {
  constructor(priceId: string) {
    super(`Unrecognized Stripe Price ID "${priceId}" — refusing to derive a plan from it`)
    this.name = 'UnknownStripePriceError'
  }
}

export class MissingStripePriceError extends Error {
  constructor() {
    super('Stripe subscription has no Price ID — refusing to derive a plan from it')
    this.name = 'MissingStripePriceError'
  }
}

// ── Env resolution ───────────────────────────────────────────────────────────

type PriceEnv = Record<string, string | undefined>

export function priceEnvKey(plan: PaidPlan, currency: BillingCurrency): string {
  return `STRIPE_PRICE_${plan}_${currency}`
}

export function legacyUsdPriceEnvKey(plan: PaidPlan): string {
  return `STRIPE_PRICE_${plan}`
}

function readEnv(env: PriceEnv, key: string): string | undefined {
  const value = env[key]?.trim()
  return value ? value : undefined
}

function resolveStripePriceId(plan: PaidPlan, currency: BillingCurrency, env: PriceEnv): string | undefined {
  const current = readEnv(env, priceEnvKey(plan, currency))
  if (currency !== 'USD') return current

  const legacy = readEnv(env, legacyUsdPriceEnvKey(plan))
  if (current && legacy && current !== legacy) {
    throw new BillingConfigError(
      `${priceEnvKey(plan, currency)} and ${legacyUsdPriceEnvKey(plan)} are both set to different Price IDs`
    )
  }
  return current ?? legacy
}

// Builds and validates the full price table. Throws BillingConfigError if the
// same Stripe Price ID is configured for more than one plan/region cell.
export function getRegionalPriceTable(env: PriceEnv = process.env): RegionalPrice[] {
  const table: RegionalPrice[] = []
  const seen = new Map<string, string>()

  for (const region of Object.values(REGIONS)) {
    for (const plan of PAID_PLANS) {
      const stripePriceId = resolveStripePriceId(plan, region.currency, env)

      if (stripePriceId) {
        const cell  = `${plan}/${region.code}`
        const prior = seen.get(stripePriceId)
        if (prior) throw new BillingConfigError(`Stripe Price ID ${stripePriceId} is configured for both ${prior} and ${cell}`)
        seen.set(stripePriceId, cell)
      }

      table.push({
        plan,
        region:          region.code,
        currency:        region.currency,
        stripePriceId,
        unitAmountMinor: APPROVED_PRICE_AMOUNTS[region.code][plan],
        checkoutEnabled: CHECKOUT_APPROVED_REGIONS[region.code] && !!stripePriceId,
        recognized:      !!stripePriceId,
      })
    }
  }

  return table
}

export function getRegionalPrice(plan: PaidPlan, region: BillingRegion, env: PriceEnv = process.env): RegionalPrice {
  const price = getRegionalPriceTable(env).find(p => p.plan === plan && p.region === region)
  if (!price) throw new BillingConfigError(`No regional price for ${plan}/${region}`)
  return price
}

// Regions a new customer can actually check out in: approved in code and
// every paid plan configured. Fails closed (no regions) on bad config.
export function getAvailableRegions(env: PriceEnv = process.env): BillingRegion[] {
  let table: RegionalPrice[]
  try {
    table = getRegionalPriceTable(env)
  } catch {
    return []
  }
  return Object.values(REGIONS)
    .map(r => r.code)
    .filter(code => PAID_PLANS.every(plan => table.find(p => p.plan === plan && p.region === code)?.checkoutEnabled))
}

// Webhook entry point: the ONLY way a Stripe Price becomes a Plan.
export function resolvePlanFromStripePrice(priceId: string | null | undefined, env: PriceEnv = process.env): PaidPlan {
  if (!priceId) throw new MissingStripePriceError()
  const match = getRegionalPriceTable(env).find(p => p.recognized && p.stripePriceId === priceId)
  if (!match) throw new UnknownStripePriceError(priceId)
  return match.plan
}

// Display only — reads the approved amount, never env, so it is safe in any
// render context.
export function formatRegionalPrice(plan: PaidPlan, region: BillingRegion): string {
  return formatPrice(APPROVED_PRICE_AMOUNTS[region][plan], REGIONS[region].currency)
}

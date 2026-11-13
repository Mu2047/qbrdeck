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
//     (in code, Preview-only via BILLING_PREVIEW_REGIONS, or Production-only
//     via BILLING_PRODUCTION_REGIONS — see isCheckoutApproved) AND every paid
//     plan has a configured Stripe Price ID. During Production certification
//     (BILLING_PRODUCTION_TEST_WORKSPACES non-empty) the region is further
//     limited to the listed workspaces — see isRegionCheckoutAllowedForWorkspace.
//   - `recognized` (webhook may map it) is separate from `checkoutEnabled`
//     (new customers may buy it), so a retired/grandfathered price can keep
//     resolving to its plan after it stops being sold. Recognition depends ONLY
//     on the Price ID being configured: no checkout flag, environment or
//     workspace allow-list ever affects it. Turning a region's checkout OFF
//     therefore never orphans an existing subscriber (webhook plan resolution,
//     portal routing and paid display keep working).
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

// Preview-only certification. A region listed here becomes purchasable ONLY
// when BOTH server-side signals hold:
//   - VERCEL_ENV === 'preview'  (set by the Vercel platform; never the client)
//   - BILLING_PREVIEW_REGIONS explicitly lists the region (comma-separated)
// This list is the ceiling: a region missing here (GLOBAL is approved in code
// already) can never be enabled from env, whatever BILLING_PREVIEW_REGIONS
// contains. Production (VERCEL_ENV === 'production'), local dev and unknown
// environments ignore BILLING_PREVIEW_REGIONS entirely.
export const PREVIEW_CHECKOUT_REGIONS: readonly BillingRegion[] = ['GM', 'XOF_ZONE']

// Comma-separated list → trimmed, non-empty entries.
function parseList(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

// Exact, case-sensitive codes only; unknown values are ignored. The ceiling
// decides which regions may ever be returned.
function regionsFromList(raw: unknown, ceiling: readonly BillingRegion[]): BillingRegion[] {
  const requested = new Set(parseList(raw))
  return ceiling.filter(region => requested.has(region))
}

export function previewCheckoutRegions(env: PriceEnv = process.env): BillingRegion[] {
  if (env.VERCEL_ENV !== 'preview') return []
  return regionsFromList(env.BILLING_PREVIEW_REGIONS, PREVIEW_CHECKOUT_REGIONS)
}

// Production checkout kill-switch / enablement. A region listed here becomes
// purchasable for NEW checkouts only when BOTH server-side signals hold:
//   - VERCEL_ENV === 'production'  (set by the Vercel platform; never the client)
//   - BILLING_PRODUCTION_REGIONS explicitly lists the region (comma-separated)
// Defaults OFF: missing/empty env → no regional Production checkout. This list
// is the hard ceiling — env can never enable a region missing here. Preview,
// development and unknown environments ignore BILLING_PRODUCTION_REGIONS.
//
// Removing a region from BILLING_PRODUCTION_REGIONS blocks NEW checkouts only.
// Existing subscribers stay recognized (see `recognized` above), as long as
// the region's STRIPE_PRICE_* env vars stay configured.
export const PRODUCTION_CHECKOUT_REGIONS: readonly BillingRegion[] = ['GM', 'XOF_ZONE']

export function productionCheckoutRegions(env: PriceEnv = process.env): BillingRegion[] {
  if (env.VERCEL_ENV !== 'production') return []
  return regionsFromList(env.BILLING_PRODUCTION_REGIONS, PRODUCTION_CHECKOUT_REGIONS)
}

// Optional Production certification allow-list: exact workspace IDs
// (comma-separated, trimmed, case-sensitive). Production only.
//   - non-empty → a Production-enabled region is offered ONLY to these workspaces
//   - empty/missing → public rollout of the enabled regions
// It narrows NEW regional checkout only. It never affects GLOBAL/USD, Preview
// certification, or recognition of existing subscriptions.
export function productionTestWorkspaces(env: PriceEnv = process.env): string[] {
  if (env.VERCEL_ENV !== 'production') return []
  return parseList(env.BILLING_PRODUCTION_TEST_WORKSPACES)
}

// Region-level gate (no workspace context). Used to build the price table.
export function isCheckoutApproved(region: BillingRegion, env: PriceEnv = process.env): boolean {
  return CHECKOUT_APPROVED_REGIONS[region] === true
    || previewCheckoutRegions(env).includes(region)
    || productionCheckoutRegions(env).includes(region)
}

// Workspace-level gate for NEW checkout. Fails closed: a missing workspace ID
// is never on the certification allow-list. The workspace ID must come from
// the server-side session, never from the request body.
export function isRegionCheckoutAllowedForWorkspace(
  region: BillingRegion,
  workspaceId: string | null | undefined,
  env: PriceEnv = process.env,
): boolean {
  if (CHECKOUT_APPROVED_REGIONS[region] === true) return true       // GLOBAL/USD — always
  if (previewCheckoutRegions(env).includes(region)) return true     // Preview semantics unchanged
  if (!productionCheckoutRegions(env).includes(region)) return false
  const allowList = productionTestWorkspaces(env)
  if (allowList.length === 0) return true                           // public rollout
  return typeof workspaceId === 'string' && allowList.includes(workspaceId)
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
        checkoutEnabled: isCheckoutApproved(region.code, env) && !!stripePriceId,
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

// Regions a new customer in `workspaceId` can actually check out in: approved
// (code / Preview / Production), every paid plan configured, and — during
// Production certification — the workspace on the allow-list. Fails closed (no
// regions) on bad config. Omitting workspaceId is treated as "not listed", so
// a caller without workspace context can never open a region under
// certification.
export function getAvailableRegions(env: PriceEnv = process.env, workspaceId: string | null = null): BillingRegion[] {
  let table: RegionalPrice[]
  try {
    table = getRegionalPriceTable(env)
  } catch {
    return []
  }
  return Object.values(REGIONS)
    .map(r => r.code)
    .filter(code => PAID_PLANS.every(plan => table.find(p => p.plan === plan && p.region === code)?.checkoutEnabled))
    .filter(code => isRegionCheckoutAllowedForWorkspace(code, workspaceId, env))
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

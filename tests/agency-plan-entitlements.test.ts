import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  PLAN_LIMITS,
  getLimits,
  isUnderLimit,
  formatLimit,
  canUseWhiteLabel,
  canUseFullAnalytics,
  canInviteTeam,
  type PlanKey,
} from '@/lib/limits'
import { resolveBranding, isWhiteLabelPlan, isPlatformBrandedPlan } from '@/lib/branding'
import { hasSeatCapacity, fitsWithinSeatLimit } from '@/lib/team-invites'
import { canInviteMoreMembers, resolveMspBranding } from '@/lib/permissions'
import { selectActiveMembership } from '@/lib/workspace'
import {
  APPROVED_PRICE_AMOUNTS,
  UnknownStripePriceError,
  formatRegionalPrice,
  getRegionalPriceTable,
  resolvePlanFromStripePrice,
} from '@/lib/billing/regional-prices'
import { parseCheckoutRequest } from '@/lib/billing/checkout-request'

// Agency plan certification matrix — FREE / SOLO / GROWTH / AGENCY side by
// side, so a regression in any one plan's entitlement shows up next to the
// others.
//
// Same two-kind convention as tests/team-collaboration.test.ts:
//
//  - EXECUTABLE tests import the real lib/limits.ts, lib/branding.ts,
//    lib/team-invites.ts, lib/permissions.ts and lib/workspace.ts and run them.
//
//  - Stripe Price → Plan mapping, the checkout price whitelist and the plan
//    price live in lib/billing/* (pure, env passed explicitly) and are run
//    for real. SOURCE-CONTRACT tests then read the webhook, checkout route,
//    lib/stripe.ts and the billing page as plain text to prove they delegate
//    to that canonical module (Next.js route files may only export handlers,
//    and importing lib/stripe.ts would construct a live Stripe client).
//
// No test here opens a database connection, calls Stripe, or touches a real
// subscription.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const webhookSource  = readSourceLF('app/api/webhooks/stripe/route.ts')
const checkoutSource = readSourceLF('app/api/billing/checkout/route.ts')
const stripeSource   = readSourceLF('lib/stripe.ts')
const billingSource  = readSourceLF('app/(app)/dashboard/billing/page.tsx')

const PLANS: PlanKey[] = ['FREE', 'SOLO', 'GROWTH', 'AGENCY']

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTABLE — canonical plan table (lib/limits.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe('canonical plan matrix (EXECUTABLE — real lib/limits.ts)', () => {
  const expected: Record<PlanKey, {
    clients: number | null; qbrs: number | null; exports: number | null; seats: number | null
    whiteLabel: boolean; analytics: 'basic' | 'full'
  }> = {
    FREE:   { clients: 2,    qbrs: 3,    exports: 3,    seats: 1,    whiteLabel: false, analytics: 'basic' },
    SOLO:   { clients: 10,   qbrs: 20,   exports: null, seats: 1,    whiteLabel: false, analytics: 'basic' },
    GROWTH: { clients: 50,   qbrs: null, exports: null, seats: 5,    whiteLabel: true,  analytics: 'full'  },
    AGENCY: { clients: null, qbrs: null, exports: null, seats: null, whiteLabel: true,  analytics: 'full'  },
  }

  for (const plan of PLANS) {
    it(`${plan} matches the commercial contract`, () => {
      const l = PLAN_LIMITS[plan]
      const e = expected[plan]
      expect(l.clients).toBe(e.clients)
      expect(l.qbrsPerMonth).toBe(e.qbrs)
      expect(l.exportPackagesPerMonth).toBe(e.exports)
      expect(l.teamSeats).toBe(e.seats)
      expect(l.whiteLabel).toBe(e.whiteLabel)
      expect(l.analytics).toBe(e.analytics)
    })
  }
})

describe('AGENCY unlimited is null everywhere — no fake numeric cap', () => {
  const agency = PLAN_LIMITS.AGENCY

  it('clients, QBRs, exports and team seats are all null', () => {
    expect(agency.clients).toBeNull()
    expect(agency.qbrsPerMonth).toBeNull()
    expect(agency.exportPackagesPerMonth).toBeNull()
    expect(agency.teamSeats).toBeNull()
  })

  it('getLimits("AGENCY") returns the same unlimited row', () => {
    expect(getLimits('AGENCY')).toBe(agency)
  })

  it('no AGENCY limit is a finite number of any size', () => {
    for (const v of [agency.clients, agency.qbrsPerMonth, agency.exportPackagesPerMonth, agency.teamSeats]) {
      expect(typeof v).not.toBe('number')
    }
  })

  it('every AGENCY limit formats as "Unlimited" in the UI', () => {
    expect(formatLimit(agency.clients)).toBe('Unlimited')
    expect(formatLimit(agency.qbrsPerMonth)).toBe('Unlimited')
    expect(formatLimit(agency.exportPackagesPerMonth)).toBe('Unlimited')
    expect(formatLimit(agency.teamSeats)).toBe('Unlimited')
  })
})

describe('client / QBR / export enforcement — the shared isUnderLimit gate', () => {
  it('AGENCY is never rejected by client count, monthly QBRs, or monthly exports', () => {
    for (const used of [0, 2, 10, 50, 999, 1_000_000]) {
      expect(isUnderLimit(used, PLAN_LIMITS.AGENCY.clients)).toBe(true)
      expect(isUnderLimit(used, PLAN_LIMITS.AGENCY.qbrsPerMonth)).toBe(true)
      expect(isUnderLimit(used, PLAN_LIMITS.AGENCY.exportPackagesPerMonth)).toBe(true)
    }
  })

  it('finite plans still stop exactly at their limits', () => {
    expect(isUnderLimit(2,  PLAN_LIMITS.FREE.clients)).toBe(false)
    expect(isUnderLimit(10, PLAN_LIMITS.SOLO.clients)).toBe(false)
    expect(isUnderLimit(50, PLAN_LIMITS.GROWTH.clients)).toBe(false)
    expect(isUnderLimit(3,  PLAN_LIMITS.FREE.qbrsPerMonth)).toBe(false)
    expect(isUnderLimit(20, PLAN_LIMITS.SOLO.qbrsPerMonth)).toBe(false)
    expect(isUnderLimit(3,  PLAN_LIMITS.FREE.exportPackagesPerMonth)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTABLE — team seats (lib/team-invites.ts, lib/permissions.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe('team seats — AGENCY does not inherit the Growth 5-seat ceiling', () => {
  it('GROWTH rejects the 6th reserved seat; AGENCY accepts it', () => {
    // reserved = Owner + 4 others already holding seats → asking for seat 6
    expect(hasSeatCapacity('GROWTH', 5)).toBe(false)
    expect(hasSeatCapacity('AGENCY', 5)).toBe(true)
  })

  it('AGENCY pending invites never hit a numeric ceiling', () => {
    for (const reserved of [5, 6, 50, 999, 1_000_000]) {
      expect(hasSeatCapacity('AGENCY', reserved)).toBe(true)
      expect(fitsWithinSeatLimit('AGENCY', reserved)).toBe(true)
      expect(canInviteMoreMembers('AGENCY', reserved)).toBe(true)
    }
  })

  it('canInviteTeam: FREE/SOLO no, GROWTH/AGENCY yes', () => {
    expect(canInviteTeam('FREE')).toBe(false)
    expect(canInviteTeam('SOLO')).toBe(false)
    expect(canInviteTeam('GROWTH')).toBe(true)
    expect(canInviteTeam('AGENCY')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTABLE — analytics and white-label gates
// ─────────────────────────────────────────────────────────────────────────────

describe('analytics entitlement', () => {
  it('FREE/SOLO basic, GROWTH/AGENCY advanced', () => {
    expect(canUseFullAnalytics('FREE')).toBe(false)
    expect(canUseFullAnalytics('SOLO')).toBe(false)
    expect(canUseFullAnalytics('GROWTH')).toBe(true)
    expect(canUseFullAnalytics('AGENCY')).toBe(true)
  })
})

describe('white-label entitlement — AGENCY behaves exactly like GROWTH', () => {
  it('every white-label helper agrees per plan', () => {
    for (const plan of PLANS) {
      const wl = plan === 'GROWTH' || plan === 'AGENCY'
      expect(canUseWhiteLabel(plan)).toBe(wl)
      expect(isWhiteLabelPlan(plan)).toBe(wl)
      expect(isPlatformBrandedPlan(plan)).toBe(!wl)
      expect(resolveMspBranding(plan, 'Summit MSP', 'https://x/logo.png').isWhiteLabel).toBe(wl)
    }
  })

  it('AGENCY branding resolves identically to GROWTH (name, logo, no "Powered by")', () => {
    const growth = resolveBranding({ plan: 'GROWTH', workspaceName: 'Summit MSP' })
    const agency = resolveBranding({ plan: 'AGENCY', workspaceName: 'Summit MSP' })
    expect(agency).toEqual(growth)
    expect(agency.brandingMode).toBe('WHITE_LABEL')
    expect(agency.showPoweredBy).toBe(false)

    expect(resolveMspBranding('AGENCY', 'Summit MSP', 'https://x/logo.png'))
      .toEqual(resolveMspBranding('GROWTH', 'Summit MSP', 'https://x/logo.png'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTABLE — active-workspace isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('active-workspace isolation — entitlements come from the ACTIVE workspace only', () => {
  type M = { workspaceId: string; workspace: { subscription: { plan: string } | null } }
  const agencyWs: M = { workspaceId: 'ws_agency', workspace: { subscription: { plan: 'AGENCY' } } }
  const freeWs:   M = { workspaceId: 'ws_free',   workspace: { subscription: null } }
  const growthWs: M = { workspaceId: 'ws_growth', workspace: { subscription: { plan: 'GROWTH' } } }
  const memberships = [agencyWs, freeWs, growthWs]

  const activePlan = (activeId: string | null) =>
    selectActiveMembership(memberships, activeId)?.workspace.subscription?.plan ?? 'FREE'

  it('switching to the Free workspace drops every Agency entitlement', () => {
    const l = getLimits(activePlan('ws_free'))
    expect(l).toBe(PLAN_LIMITS.FREE)
    expect(canUseWhiteLabel(activePlan('ws_free'))).toBe(false)
    expect(canUseFullAnalytics(activePlan('ws_free'))).toBe(false)
  })

  it('switching to the Growth workspace re-imposes the 5-seat and 50-client limits', () => {
    expect(getLimits(activePlan('ws_growth'))).toBe(PLAN_LIMITS.GROWTH)
    expect(hasSeatCapacity(activePlan('ws_growth'), 5)).toBe(false)
  })

  it('only the Agency workspace itself is unlimited', () => {
    expect(getLimits(activePlan('ws_agency'))).toBe(PLAN_LIMITS.AGENCY)
  })

  it('an unknown/foreign workspace id falls back to the earliest membership, never a plan the user lacks', () => {
    expect(selectActiveMembership(memberships, 'ws_someone_else')).toBe(agencyWs)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Stripe price mapping, checkout whitelist, price display
// (EXECUTABLE — lib/billing/*, plus SOURCE-CONTRACT delegation checks)
// ─────────────────────────────────────────────────────────────────────────────

const PRICE_ENV = {
  STRIPE_PRICE_SOLO:   'price_solo',
  STRIPE_PRICE_GROWTH: 'price_growth',
  STRIPE_PRICE_AGENCY: 'price_agency',
}

describe('Stripe webhook plan mapping', () => {
  const fnMatch = webhookSource.match(/function getPlanFromPriceId[\s\S]*?\n\}/)
  const fn = fnMatch?.[0] ?? ''

  it('the webhook delegates plan mapping to the canonical resolver (SOURCE-CONTRACT)', () => {
    expect(fn).not.toBe('')
    expect(fn).toMatch(/return resolvePlanFromStripePrice\(priceId\)/)
    expect(fn).not.toMatch(/process\.env/)
    expect(fn).not.toMatch(/'FREE'/)
  })

  it('STRIPE_PRICE_AGENCY maps to AGENCY and nothing else does (EXECUTABLE)', () => {
    expect(resolvePlanFromStripePrice('price_agency', PRICE_ENV)).toBe('AGENCY')
    const agencyIds = getRegionalPriceTable(PRICE_ENV).filter(p => p.recognized && p.plan === 'AGENCY').map(p => p.stripePriceId)
    expect(agencyIds).toEqual(['price_agency'])
  })

  it('each paid price maps only to its own plan; unknown prices fail closed instead of falling back to FREE (EXECUTABLE)', () => {
    expect(resolvePlanFromStripePrice('price_solo', PRICE_ENV)).toBe('SOLO')
    expect(resolvePlanFromStripePrice('price_growth', PRICE_ENV)).toBe('GROWTH')
    expect(() => resolvePlanFromStripePrice('price_unknown', PRICE_ENV)).toThrow(UnknownStripePriceError)
  })

  it('subscription.deleted returns the workspace to FREE without deleting data', () => {
    const del = webhookSource.match(/async function handleSubscriptionDeleted[\s\S]*?\n\}/)?.[0] ?? ''
    expect(del).toMatch(/plan:\s+'FREE'/)
    expect(del).not.toMatch(/\.delete(Many)?\(/)
  })

  it('no webhook handler deletes clients, QBRs, members, or exports on a plan change', () => {
    expect(webhookSource).not.toMatch(/\b(client|qBR|workspaceMember|workspaceInvite|exportEvent)\.delete(Many)?\(/)
  })
})

describe('checkout whitelist', () => {
  it('Agency is one of exactly three purchasable prices (EXECUTABLE)', () => {
    const purchasable = getRegionalPriceTable(PRICE_ENV).filter(p => p.checkoutEnabled).map(p => p.stripePriceId)
    expect(purchasable).toEqual(['price_solo', 'price_growth', 'price_agency'])

    const agency = parseCheckoutRequest({ plan: 'AGENCY', region: 'GLOBAL', currency: 'USD' }, PRICE_ENV)
    expect(agency.ok && agency.price.stripePriceId).toBe('price_agency')
    expect(parseCheckoutRequest({ priceId: 'price_other' }, PRICE_ENV).ok).toBe(false)
  })

  it('the checkout route creates sessions only from the server-resolved price (SOURCE-CONTRACT)', () => {
    expect(checkoutSource).toMatch(/const parsed = parseCheckoutRequest\(body\)/)
    expect(checkoutSource).toMatch(/line_items: \[\{ price: price\.stripePriceId, quantity: 1 \}\]/)
    expect(checkoutSource).not.toMatch(/process\.env\.STRIPE_PRICE_/)
  })
})

describe('Agency price and billing display', () => {
  it('Agency is priced at $199 (stored as 19900 USD minor units) (EXECUTABLE)', () => {
    expect(APPROVED_PRICE_AMOUNTS.GLOBAL.AGENCY).toBe(19_900)
    expect(formatRegionalPrice('AGENCY', 'GLOBAL')).toBe('$199')
  })

  it('lib/stripe.ts no longer carries plan prices, limits or features (SOURCE-CONTRACT)', () => {
    expect(stripeSource).not.toMatch(/export const PLANS\b/)
    expect(stripeSource).not.toMatch(/\b(price|priceId|clientLimit|qbrLimit|exportLimit|features):/)
  })

  it('billing page renders plan price/limits from the canonical sources (SOURCE-CONTRACT)', () => {
    expect(billingSource).toContain('{formatRegionalPrice(planKey, region)}')
    expect(billingSource).toMatch(/const limits\s+= PLAN_LIMITS\[currentPlan\]/)
    expect(billingSource).not.toMatch(/plan\.(price|priceId|clientLimit|qbrLimit|exportLimit|features)/)
    expect(billingSource).not.toMatch(/PLANS\[/)
  })
})

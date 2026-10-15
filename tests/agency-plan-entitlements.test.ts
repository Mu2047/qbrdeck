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

// Agency plan certification matrix — FREE / SOLO / GROWTH / AGENCY side by
// side, so a regression in any one plan's entitlement shows up next to the
// others.
//
// Same two-kind convention as tests/team-collaboration.test.ts:
//
//  - EXECUTABLE tests import the real lib/limits.ts, lib/branding.ts,
//    lib/team-invites.ts, lib/permissions.ts and lib/workspace.ts and run them.
//
//  - SOURCE-CONTRACT tests read the Stripe webhook, checkout route, lib/stripe.ts
//    and the billing page as plain text. The webhook's getPlanFromPriceId is not
//    exported (Next.js route files may only export handlers), and importing
//    lib/stripe.ts would construct a live Stripe client, so both are proven
//    structurally.
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
// SOURCE-CONTRACT — Stripe price mapping, checkout, price display
// ─────────────────────────────────────────────────────────────────────────────

describe('Stripe webhook plan mapping (SOURCE-CONTRACT)', () => {
  const fnMatch = webhookSource.match(/function getPlanFromPriceId[\s\S]*?\n\}/)
  const fn = fnMatch?.[0] ?? ''

  it('locates getPlanFromPriceId', () => {
    expect(fn).not.toBe('')
  })

  it('STRIPE_PRICE_AGENCY maps to AGENCY and nothing else does', () => {
    expect(fn).toMatch(/priceId === process\.env\.STRIPE_PRICE_AGENCY\) return 'AGENCY'/)
    expect(fn.match(/return 'AGENCY'/g)).toHaveLength(1)
  })

  it('each paid price maps only to its own plan; unknown prices fall back to FREE', () => {
    expect(fn).toMatch(/STRIPE_PRICE_SOLO\)\s+return 'SOLO'/)
    expect(fn).toMatch(/STRIPE_PRICE_GROWTH\) return 'GROWTH'/)
    expect(fn.trim()).toMatch(/return 'FREE'\n\}$/)
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

describe('checkout whitelist (SOURCE-CONTRACT)', () => {
  it('Agency is one of exactly three allowed prices', () => {
    const allowed = checkoutSource.match(/const ALLOWED_PRICES = \[([\s\S]*?)\]/)?.[1] ?? ''
    expect(allowed).toContain('process.env.STRIPE_PRICE_AGENCY')
    expect(allowed.match(/process\.env\.STRIPE_PRICE_\w+/g)).toEqual([
      'process.env.STRIPE_PRICE_SOLO',
      'process.env.STRIPE_PRICE_GROWTH',
      'process.env.STRIPE_PRICE_AGENCY',
    ])
  })
})

describe('Agency price and billing display (SOURCE-CONTRACT)', () => {
  const agencyBlock = stripeSource.match(/AGENCY: \{[\s\S]*?\n  \},/)?.[0] ?? ''

  it('Agency is priced at $199 (prices are stored in whole dollars, not cents)', () => {
    expect(agencyBlock).toMatch(/price:\s*199,/)
    expect(agencyBlock).toMatch(/priceId:\s*process\.env\.STRIPE_PRICE_AGENCY/)
  })

  it('billing page renders plan price/limits from the canonical sources, not lib/stripe.ts limit fields', () => {
    expect(billingSource).toContain('${plan.price}')
    expect(billingSource).toMatch(/const limits\s+= PLAN_LIMITS\[currentPlan\]/)
    expect(billingSource).not.toMatch(/plan\.(clientLimit|qbrLimit|exportLimit|features)/)
    expect(billingSource).not.toMatch(/PLANS\[\w+\]\.(clientLimit|qbrLimit|exportLimit|features)/)
  })
})

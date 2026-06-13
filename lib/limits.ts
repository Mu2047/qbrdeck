// lib/limits.ts
// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for all plan feature limits.
//
// RULES:
//   - Every backend route that enforces a limit imports from here.
//   - Every UI that displays a limit reads from here.
//   - lib/stripe.ts handles Stripe price IDs, checkout, and customer portal only.
//   - null = unlimited.
//   - Never use 999 as a proxy for unlimited — use null.
//   - When limits change, change them here only.
// ─────────────────────────────────────────────────────────────────────────────

export type AnalyticsAccess = 'basic' | 'full'
export type PlanKey = 'FREE' | 'SOLO' | 'GROWTH' | 'AGENCY'

export interface PlanLimits {
  // Numeric limits — null means unlimited
  clients:                number | null  // max clients per workspace
  qbrsPerMonth:           number | null  // max QBR generations per billing month
  exportPackagesPerMonth: number | null  // max unique QBR export packages per billing month
  teamSeats:              number | null  // max workspace members (owner + invited)

  // Feature flags
  whiteLabel:   boolean          // Growth/Agency: MSP white-label branding on exports
  csvImport:    boolean          // CSV metrics import on QBR generation form
  analytics:    AnalyticsAccess  // 'basic' = summary KPIs only | 'full' = all widgets + filters
}

export const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  FREE: {
    clients:                2,
    qbrsPerMonth:           3,
    exportPackagesPerMonth: 3,
    teamSeats:              1,    // owner only, no invites
    whiteLabel:             false,
    csvImport:              true, // CSV import available on all plans
    analytics:              'basic',
  },
  SOLO: {
    clients:                10,
    qbrsPerMonth:           20,
    exportPackagesPerMonth: null, // unlimited exports
    teamSeats:              1,    // solo operator, no team
    whiteLabel:             false,
    csvImport:              true,
    analytics:              'basic',
  },
  GROWTH: {
    clients:                50,
    qbrsPerMonth:           null, // unlimited
    exportPackagesPerMonth: null, // unlimited
    teamSeats:              5,    // up to 5 members including owner
    whiteLabel:             true,
    csvImport:              true,
    analytics:              'full',
  },
  AGENCY: {
    clients:                null, // unlimited
    qbrsPerMonth:           null, // unlimited
    exportPackagesPerMonth: null, // unlimited
    teamSeats:              null, // unlimited
    whiteLabel:             true,
    csvImport:              true,
    analytics:              'full',
  },
}

// ── Convenience helpers ───────────────────────────────────────────────────────

// Returns true if the used count is under the limit (null = always true)
export function isUnderLimit(used: number, limit: number | null): boolean {
  if (limit === null) return true
  return used < limit
}

// Returns true if a new billing month has started since periodStart
export function shouldResetPeriod(periodStart: Date): boolean {
  const now = new Date()
  return (
    now.getMonth()    !== periodStart.getMonth() ||
    now.getFullYear() !== periodStart.getFullYear()
  )
}

// Returns human-readable limit string for UI display
export function formatLimit(limit: number | null): string {
  return limit === null ? 'Unlimited' : String(limit)
}

// Returns the limits for a given plan key, defaulting to FREE if unknown
export function getLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan as PlanKey] ?? PLAN_LIMITS.FREE
}

// Plan display names for UI
export const PLAN_NAMES: Record<PlanKey, string> = {
  FREE:   'Free',
  SOLO:   'Solo',
  GROWTH: 'Growth',
  AGENCY: 'Agency',
}

// ── Feature gate helpers ──────────────────────────────────────────────────────
// Use these in both backend routes and frontend components.

export function canUseWhiteLabel(plan: string): boolean {
  return getLimits(plan).whiteLabel
}

export function canUseFullAnalytics(plan: string): boolean {
  return getLimits(plan).analytics === 'full'
}

export function canInviteTeam(plan: string): boolean {
  const seats = getLimits(plan).teamSeats
  return seats === null || seats > 1
}

// ── Upgrade prompt messages ───────────────────────────────────────────────────
// Consistent wording used by both backend error responses and frontend UI.

export const UPGRADE_MESSAGES = {
  clientLimit:      "You've reached your client limit. Upgrade to add more clients.",
  qbrLimit:         "You've reached your monthly QBR generation limit. Upgrade to continue.",
  exportLimit:      "You've reached your monthly export package limit. Upgrade to continue.",
  teamLimit:        "You've reached your team seat limit. Upgrade to Agency to add more members.",
  teamNotAvailable: "Team access is available on Growth and Agency plans.",
  whiteLabelLocked: "White-label branding is available on Growth and Agency plans.",
  analyticsLocked:  "Advanced analytics is available on Growth and Agency plans.",
} as const
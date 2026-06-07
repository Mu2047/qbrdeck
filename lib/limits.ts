export const PLAN_LIMITS = {
  FREE:   { clients: 2,    qbrsPerMonth: 3,    exportsPerMonth: 3    },
  SOLO:   { clients: 10,   qbrsPerMonth: 20,   exportsPerMonth: null },
  GROWTH: { clients: 50,   qbrsPerMonth: null, exportsPerMonth: null },
  AGENCY: { clients: null, qbrsPerMonth: null, exportsPerMonth: null },
} as const

export type PlanKey = keyof typeof PLAN_LIMITS

export function shouldResetPeriod(periodStart: Date): boolean {
  const now = new Date()
  return (
    now.getMonth() !== periodStart.getMonth() ||
    now.getFullYear() !== periodStart.getFullYear()
  )
}

export function isUnderLimit(used: number, limit: number | null): boolean {
  if (limit === null) return true
  return used < limit
}
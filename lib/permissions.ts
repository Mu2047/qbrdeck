import { TeamRole } from '@prisma/client'
import { getLimits } from '@/lib/limits'

// Role hierarchy — higher index = more permissions
const ROLE_RANK: Record<TeamRole, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN:  2,
  OWNER:  3,
}

export function hasRole(userRole: TeamRole, required: TeamRole): boolean {
  return ROLE_RANK[userRole] >= ROLE_RANK[required]
}

export const can = {
  // Billing
  manageBilling:     (role: TeamRole) => role === 'OWNER',
  manageSettings:    (role: TeamRole) => role === 'OWNER',

  // Team
  inviteMembers:     (role: TeamRole) => hasRole(role, 'ADMIN'),   // ADMIN+ may invite
  removeMembers:     (role: TeamRole) => role === 'OWNER',
  changeRoles:       (role: TeamRole) => role === 'OWNER',

  // Clients
  createClient:      (role: TeamRole) => hasRole(role, 'ADMIN'),
  editClient:        (role: TeamRole) => hasRole(role, 'ADMIN'),
  deleteClient:      (role: TeamRole) => hasRole(role, 'ADMIN'),
  viewClients:       (role: TeamRole) => hasRole(role, 'VIEWER'),

  // QBRs
  generateQBR:       (role: TeamRole) => hasRole(role, 'MEMBER'),
  exportQBR:         (role: TeamRole) => hasRole(role, 'MEMBER'),
  viewQBR:           (role: TeamRole) => hasRole(role, 'VIEWER'),
  editQBRReminders:  (role: TeamRole) => hasRole(role, 'ADMIN'),
  // Same MEMBER+ bar as generateQBR/exportQBR — deletion is at least as
  // strict as editing, exporting, or sharing a QBR.
  deleteQBR:         (role: TeamRole) => hasRole(role, 'MEMBER'),
}
export function canGrantRole(inviterRole: TeamRole, targetRole: TeamRole): boolean {
  if (targetRole === 'OWNER') return inviterRole === 'OWNER'
  return hasRole(inviterRole, 'ADMIN')
}
// Plan seat limits are NOT defined here. PLAN_LIMITS.teamSeats in lib/limits.ts
// is the single canonical source (FREE/SOLO 1, GROWTH 5, AGENCY null =
// unlimited). A duplicate SEAT_LIMITS map used to live here and capped AGENCY
// at a fake finite 999, contradicting the advertised "unlimited team members"
// entitlement; it has been removed rather than kept in sync.
export function canInviteMoreMembers(plan: string, currentMemberCount: number): boolean {
  const limit = getLimits(plan).teamSeats
  if (limit === null) return true // AGENCY — genuinely unlimited, no numeric ceiling
  return currentMemberCount < limit
}
export function resolveMspBranding(plan: string, workspaceName: string, logoUrl: string | null) {
  const isWhiteLabel = plan === 'GROWTH' || plan === 'AGENCY'
  return {
    mspName:      isWhiteLabel ? workspaceName : 'QBR Deck',
    logoUrl:      isWhiteLabel ? (logoUrl ?? undefined) : undefined,
    isWhiteLabel,
  }
}
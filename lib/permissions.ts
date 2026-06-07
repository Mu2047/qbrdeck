import { TeamRole } from '@prisma/client'

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
  inviteMembers:     (role: TeamRole) => hasRole(role, 'OWNER'),
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
}

// Plan seat limits
export const SEAT_LIMITS: Record<string, number> = {
  FREE:   1,
  SOLO:   1,
  GROWTH: 5,
  AGENCY: 999,
}

export function canInviteMoreMembers(plan: string, currentMemberCount: number): boolean {
  const limit = SEAT_LIMITS[plan] ?? 1
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
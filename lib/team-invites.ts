import { randomBytes, createHash } from 'crypto'
import type { Prisma } from '@prisma/client'
import { getLimits } from '@/lib/limits'

// ─────────────────────────────────────────────────────────────────────────────
// Team invitation tokens + seat capacity.
//
// Token handling deliberately mirrors lib/share-links.ts: a CSPRNG raw bearer
// token that exists in plaintext ONLY in the acceptance URL, with only its
// SHA-256 hash persisted. WorkspaceInvite.token is a plain unique String
// column, so storing a hash there needs no schema change — the column's
// meaning becomes "token hash" for every invitation created from here on.
//
// Legacy compatibility: invitations created before this change stored a raw
// cuid() in the same column. Acceptance therefore tries the hashed lookup
// first and falls back to a raw lookup, exactly like resolveSharedQbr() does
// for pre-ShareLink portal links. The fallback only ever matches rows whose
// stored value is not a hash, so it cannot weaken new-token behavior.
// ─────────────────────────────────────────────────────────────────────────────

export const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days — unchanged

export function hashInviteToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

// 256-bit CSPRNG bearer token. Returned raw to the caller exactly once, for
// the acceptance URL — never persisted, never logged.
export function generateInviteToken(): string {
  return randomBytes(32).toString('hex')
}

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase()
}

// Roles a workspace may hand out via invitation. OWNER is intentionally absent:
// ownership transfer is a separate workflow that does not exist yet, so an
// invitation must never be able to mint an owner. Enforced server-side,
// independently of the Settings UI's own ADMIN/MEMBER/VIEWER dropdown.
export const INVITEABLE_ROLES = ['ADMIN', 'MEMBER', 'VIEWER'] as const
export type InviteableRole = (typeof INVITEABLE_ROLES)[number]

export function isInviteableRole(role: unknown): role is InviteableRole {
  return typeof role === 'string' && (INVITEABLE_ROLES as readonly string[]).includes(role)
}

/**
 * Reserved team capacity for a workspace = active members + still-valid
 * pending invitations.
 *
 * Expiry is evaluated directly against expiresAt rather than trusting the
 * stored status, so an expired invitation stops reserving its seat the moment
 * it lapses — no background job is required to release capacity. REVOKED and
 * ACCEPTED rows are excluded: a revoked invite reserves nothing, and an
 * accepted one is already represented by its WorkspaceMember row.
 *
 * Must be called with a transaction client that already holds the Workspace
 * row lock (see lib/workspace-lock.ts) whenever the result is used to make a
 * capacity decision — otherwise the counts can race.
 */
export async function countReservedSeats(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  now: Date = new Date(),
): Promise<{ memberCount: number; pendingInviteCount: number; reserved: number }> {
  const memberCount = await tx.workspaceMember.count({ where: { workspaceId } })
  const pendingInviteCount = await tx.workspaceInvite.count({
    where: { workspaceId, status: 'PENDING', expiresAt: { gt: now } },
  })
  return { memberCount, pendingInviteCount, reserved: memberCount + pendingInviteCount }
}

/**
 * True when one more seat may be reserved under `plan`.
 *
 * Canonical seat limits come from lib/limits.ts (PLAN_LIMITS.teamSeats):
 * FREE/SOLO = 1 total, GROWTH = 5 total (the Owner counts as one), AGENCY =
 * null, meaning genuinely unlimited — never a large finite stand-in.
 */
export function hasSeatCapacity(plan: string, reserved: number): boolean {
  const limit = getLimits(plan).teamSeats
  if (limit === null) return true
  return reserved < limit
}

/**
 * True when a workspace's already-reserved capacity fits inside `plan`.
 *
 * Used at acceptance rather than hasSeatCapacity(): the invitation being
 * accepted ALREADY holds one reserved seat, so pending -> active is a net-zero
 * capacity change. What must still be verified is that the workspace is not
 * currently ABOVE its entitlement — e.g. a Growth workspace at 5/5 that has
 * since downgraded to Solo must not be able to convert a lingering invite.
 */
export function fitsWithinSeatLimit(plan: string, reserved: number): boolean {
  const limit = getLimits(plan).teamSeats
  if (limit === null) return true
  return reserved <= limit
}

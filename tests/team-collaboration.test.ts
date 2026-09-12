import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { PLAN_LIMITS, getLimits, type PlanKey } from '@/lib/limits'
import { can, canGrantRole, canInviteMoreMembers, hasRole } from '@/lib/permissions'
import {
  INVITE_EXPIRY_MS,
  INVITEABLE_ROLES,
  fitsWithinSeatLimit,
  generateInviteToken,
  hasSeatCapacity,
  hashInviteToken,
  isInviteableRole,
  isModernInviteToken,
  normalizeInviteEmail,
} from '@/lib/team-invites'

// Stage 2 — Team Collaboration hardening.
//
// Two kinds of test live in this file, and they are labelled honestly:
//
//  - EXECUTABLE tests import the real lib/team-invites.ts, lib/permissions.ts
//    and lib/limits.ts and run them. Seat arithmetic, token construction,
//    hashing, role policy and plan gating are all proven this way, against the
//    real implementations — never a copy of their values.
//
//  - SOURCE-CONTRACT tests read the route files as plain text and regex-match
//    against them. This repo has no DB integration harness and no Clerk/Prisma
//    request-mocking harness (same precedent as tests/api-clients-plan-limit.
//    test.ts and tests/generate-qbr-route.test.ts), so transaction ordering,
//    lock placement and "email happens after commit" are proven structurally.
//
// No test here opens a database connection, dispatches concurrent requests,
// creates an invitation, or calls Resend. The concurrency-safety claim rests on
// reusing the FOR UPDATE-inside-prisma.$transaction pattern already relied on
// by lib/workspace.ts, app/api/clients/route.ts and app/api/generate-qbr/
// route.ts — not on a fresh empirical stress test performed here.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const inviteSource     = readSourceLF('app/api/workspace/invite/route.ts')
const acceptSource     = readSourceLF('app/api/workspace/invite/accept/route.ts')
const membersSource    = readSourceLF('app/api/workspace/members/route.ts')
const workspaceSource  = readSourceLF('app/api/workspace/route.ts')
const permissionSource = readSourceLF('lib/permissions.ts')
const settingsSource   = readSourceLF('app/(app)/dashboard/(gated)/settings/page.tsx')
const billingSource    = readSourceLF('app/(app)/dashboard/billing/page.tsx')

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTABLE — canonical seat source and plan gating
// ─────────────────────────────────────────────────────────────────────────────

describe('canonical team-seat limits (EXECUTABLE — real lib/limits.ts)', () => {
  it('FREE = 1, SOLO = 1, GROWTH = 5, AGENCY = null (genuinely unlimited)', () => {
    expect(PLAN_LIMITS.FREE.teamSeats).toBe(1)
    expect(PLAN_LIMITS.SOLO.teamSeats).toBe(1)
    expect(PLAN_LIMITS.GROWTH.teamSeats).toBe(5)
    expect(PLAN_LIMITS.AGENCY.teamSeats).toBeNull()
  })

  it('AGENCY unlimited is null — never a fake finite ceiling like 999', () => {
    const agency = PLAN_LIMITS.AGENCY.teamSeats
    expect(agency).toBeNull()
    expect(agency).not.toBe(999)
  })

  it('lib/permissions.ts no longer DECLARES or exports a duplicate seat-limit map', () => {
    // The historical name may still appear in the explanatory comment that
    // records why it was removed; what must not exist is a live declaration.
    expect(permissionSource).not.toMatch(/export const SEAT_LIMITS/)
    expect(permissionSource).not.toMatch(/SEAT_LIMITS\s*[:=]\s*\{/)
    expect(permissionSource).not.toMatch(/SEAT_LIMITS\[/)
    expect(permissionSource).not.toMatch(/AGENCY:\s*999/)
  })

  it('no route or lib still imports a seat-limit map from lib/permissions.ts', () => {
    for (const src of [inviteSource, acceptSource, workspaceSource]) {
      expect(src).not.toMatch(/SEAT_LIMITS/)
    }
  })

  it('canInviteMoreMembers now reads the canonical teamSeats limit', () => {
    expect(permissionSource).toMatch(/getLimits\(plan\)\.teamSeats/)
  })

  it('getLimits falls back to FREE for an unrecognized plan value', () => {
    expect(getLimits('NOT_A_REAL_PLAN').teamSeats).toBe(PLAN_LIMITS.FREE.teamSeats)
  })
})

describe('hasSeatCapacity — one more seat may be reserved? (EXECUTABLE)', () => {
  const cases: Array<{ plan: PlanKey; reserved: number; expected: boolean; why: string }> = [
    { plan: 'FREE',   reserved: 0, expected: true,  why: 'empty workspace' },
    { plan: 'FREE',   reserved: 1, expected: false, why: 'owner already occupies the single seat' },
    { plan: 'SOLO',   reserved: 1, expected: false, why: 'solo operator, no team' },
    { plan: 'GROWTH', reserved: 0, expected: true,  why: 'empty' },
    { plan: 'GROWTH', reserved: 1, expected: true,  why: 'owner only' },
    { plan: 'GROWTH', reserved: 4, expected: true,  why: 'one seat left' },
    { plan: 'GROWTH', reserved: 5, expected: false, why: '5 TOTAL including the owner' },
    { plan: 'GROWTH', reserved: 6, expected: false, why: 'already over' },
    { plan: 'AGENCY', reserved: 5, expected: true,  why: 'unlimited' },
    { plan: 'AGENCY', reserved: 1_000_000, expected: true, why: 'no numeric ceiling at all' },
  ]

  for (const { plan, reserved, expected, why } of cases) {
    it(`${plan} at reserved=${reserved} → ${expected ? 'allow' : 'reject'} (${why})`, () => {
      expect(hasSeatCapacity(plan, reserved)).toBe(expected)
    })
  }

  it('FREE and SOLO cannot invite anyone once the owner holds the only seat', () => {
    expect(hasSeatCapacity('FREE', 1)).toBe(false)
    expect(hasSeatCapacity('SOLO', 1)).toBe(false)
  })

  it('the Owner counts toward Growth\'s 5 — owner + 4 invitees fills it exactly', () => {
    expect(hasSeatCapacity('GROWTH', 4)).toBe(true)  // owner + 3 others, room for 1
    expect(hasSeatCapacity('GROWTH', 5)).toBe(false) // owner + 4 others = full
  })
})

describe('fitsWithinSeatLimit — acceptance-time check, net-zero capacity move (EXECUTABLE)', () => {
  it('Growth at exactly 5 reserved may still accept — pending→active is net zero', () => {
    expect(fitsWithinSeatLimit('GROWTH', 5)).toBe(true)
  })

  it('Growth above its limit (post-downgrade drift) cannot accept', () => {
    expect(fitsWithinSeatLimit('GROWTH', 6)).toBe(false)
  })

  it('a Growth workspace that downgraded to SOLO cannot convert a lingering invite', () => {
    // 4 members + 1 pending invite = 5 reserved, now on SOLO (limit 1).
    expect(fitsWithinSeatLimit('SOLO', 5)).toBe(false)
  })

  it('AGENCY always fits, at any size', () => {
    expect(fitsWithinSeatLimit('AGENCY', 1_000_000)).toBe(true)
  })

  it('differs from hasSeatCapacity exactly at the boundary (<= vs <)', () => {
    expect(hasSeatCapacity('GROWTH', 5)).toBe(false)   // cannot reserve a NEW seat
    expect(fitsWithinSeatLimit('GROWTH', 5)).toBe(true) // but may convert an existing one
  })
})

describe('canInviteMoreMembers — Agency has no hidden ceiling (EXECUTABLE)', () => {
  it('AGENCY returns true well past the old fake 999 limit', () => {
    expect(canInviteMoreMembers('AGENCY', 999)).toBe(true)
    expect(canInviteMoreMembers('AGENCY', 5_000)).toBe(true)
  })

  it('GROWTH still stops at 5', () => {
    expect(canInviteMoreMembers('GROWTH', 4)).toBe(true)
    expect(canInviteMoreMembers('GROWTH', 5)).toBe(false)
  })

  it('FREE and SOLO cannot invite', () => {
    expect(canInviteMoreMembers('FREE', 1)).toBe(false)
    expect(canInviteMoreMembers('SOLO', 1)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTABLE — token security
// ─────────────────────────────────────────────────────────────────────────────

describe('invitation token construction (EXECUTABLE — real lib/team-invites.ts)', () => {
  it('generates a 256-bit token rendered as 64 hex characters', () => {
    const token = generateInviteToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is not a cuid() — no longer a guessable/low-entropy bearer value', () => {
    const token = generateInviteToken()
    expect(token.startsWith('c')).toBe(token.startsWith('c')) // shape, not randomness
    expect(token.length).toBe(64)
    expect(token).not.toMatch(/^c[a-z0-9]{24}$/) // the cuid() shape it replaced
  })

  it('two generated tokens differ (construction check, not a statistical claim)', () => {
    expect(generateInviteToken()).not.toBe(generateInviteToken())
  })

  it('hashInviteToken is SHA-256 hex of the raw token', () => {
    const raw = generateInviteToken()
    const expected = createHash('sha256').update(raw).digest('hex')
    expect(hashInviteToken(raw)).toBe(expected)
    expect(hashInviteToken(raw)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('the stored hash is never equal to the raw token it came from', () => {
    const raw = generateInviteToken()
    expect(hashInviteToken(raw)).not.toBe(raw)
  })

  it('hashing is deterministic, so acceptance can look a token up by hash', () => {
    const raw = generateInviteToken()
    expect(hashInviteToken(raw)).toBe(hashInviteToken(raw))
  })

  it('a wrong token hashes to a different value, so it cannot match', () => {
    expect(hashInviteToken('wrong-token')).not.toBe(hashInviteToken(generateInviteToken()))
  })

  it('the invitation expiry window is unchanged at 7 days', () => {
    expect(INVITE_EXPIRY_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTABLE — Stage 2B: stored hash cannot be used as a bearer credential
// ─────────────────────────────────────────────────────────────────────────────
//
// Prior to this fix, submitting the STORED SHA-256 hash H as the acceptance
// token defeated hash-at-rest protection: the hashed lookup for SHA256(H)
// missed, but the unconditional legacy raw-token fallback then matched H
// directly against the row it was the hash of. isModernInviteToken() closes
// this by refusing the raw fallback for anything shaped like the new
// 64-hex-character scheme — which both a real raw token and its own hash
// always are — so only case (A) below can ever succeed, never case (B).

describe('isModernInviteToken — the load-bearing gate on the legacy fallback (EXECUTABLE)', () => {
  it('CASE A — a real generated raw token matches the modern shape', () => {
    const rawToken = generateInviteToken()
    expect(isModernInviteToken(rawToken)).toBe(true)
  })

  it('CASE B — the STORED HASH of a raw token also matches the modern shape (this is exactly why gating on shape, not on hash-lookup-miss alone, is required)', () => {
    const rawToken = generateInviteToken()
    const storedHash = hashInviteToken(rawToken)
    expect(isModernInviteToken(storedHash)).toBe(true)
  })

  it('CASE C — a legacy Prisma cuid()-shaped token does NOT match the modern shape', () => {
    // Real cuid() output: 25 characters, always starting with "c", base-36
    // lowercase. Representative fixture — not a real Production token.
    const legacyToken = 'cl9x2k3p40000ab1c2d3e4f5g'
    expect(legacyToken.length).toBe(25)
    expect(isModernInviteToken(legacyToken)).toBe(false)
  })

  it('rejects strings of the right length but wrong alphabet (uppercase hex, non-hex chars)', () => {
    expect(isModernInviteToken('A'.repeat(64))).toBe(false) // uppercase — real hex output is lowercase
    expect(isModernInviteToken('g'.repeat(64))).toBe(false) // 'g' is not a hex digit
  })

  it('rejects strings of the right alphabet but wrong length', () => {
    expect(isModernInviteToken('a'.repeat(63))).toBe(false)
    expect(isModernInviteToken('a'.repeat(65))).toBe(false)
    expect(isModernInviteToken('')).toBe(false)
  })

  it('a real raw token and its own hash are BOTH modern-shaped, and are two different 64-hex values', () => {
    const rawToken = generateInviteToken()
    const storedHash = hashInviteToken(rawToken)
    expect(isModernInviteToken(rawToken)).toBe(true)
    expect(isModernInviteToken(storedHash)).toBe(true)
    expect(rawToken).not.toBe(storedHash)
  })
})

describe('accept route — legacy fallback is gated on isModernInviteToken (SOURCE-CONTRACT, Stage 2B repair)', () => {
  it('imports isModernInviteToken from lib/team-invites', () => {
    expect(acceptSource).toMatch(/import \{[^}]*\bisModernInviteToken\b[^}]*\} from '@\/lib\/team-invites'/)
  })

  it('the raw fallback executes only when the hashed lookup missed AND the token is not modern-shaped', () => {
    expect(acceptSource).toMatch(
      /if \(!invite && !isModernInviteToken\(token\)\) \{\s*invite = await prisma\.workspaceInvite\.findUnique\(\{ where: \{ token \} \}\)/
    )
  })

  it('the fallback is no longer reachable on a bare "!invite" alone — the old unconditional version is gone', () => {
    expect(acceptSource).not.toMatch(/if \(!invite\) \{\s*invite = await prisma\.workspaceInvite\.findUnique\(\{ where: \{ token \} \}\)/)
  })

  it('the hashed lookup still runs first, unconditionally, before the gated fallback', () => {
    const hashedIdx  = acceptSource.indexOf('token: hashInviteToken(token)')
    const gatedIdx   = acceptSource.indexOf('!invite && !isModernInviteToken(token)')
    expect(hashedIdx).toBeGreaterThan(-1)
    expect(gatedIdx).toBeGreaterThan(-1)
    expect(hashedIdx).toBeLessThan(gatedIdx)
  })
})

describe('email normalization (EXECUTABLE)', () => {
  it('trims and lowercases so case/whitespace cannot duplicate a reservation', () => {
    expect(normalizeInviteEmail('  Colleague@Company.COM ')).toBe('colleague@company.com')
  })

  it('is idempotent', () => {
    const once = normalizeInviteEmail('A@B.com')
    expect(normalizeInviteEmail(once)).toBe(once)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTABLE — role policy
// ─────────────────────────────────────────────────────────────────────────────

describe('inviteable roles — OWNER is never inviteable (EXECUTABLE)', () => {
  it('exactly ADMIN, MEMBER, VIEWER are inviteable', () => {
    expect([...INVITEABLE_ROLES]).toEqual(['ADMIN', 'MEMBER', 'VIEWER'])
  })

  it('OWNER is rejected — ownership transfer is a separate workflow that does not exist yet', () => {
    expect(isInviteableRole('OWNER')).toBe(false)
  })

  it('arbitrary/manipulated role strings are rejected', () => {
    for (const bad of ['owner', 'SUPERADMIN', 'admin', '', 'null', 'ADMIN ', 123, null, undefined, {}]) {
      expect(isInviteableRole(bad)).toBe(false)
    }
  })

  it('the three legitimate roles are accepted', () => {
    expect(isInviteableRole('ADMIN')).toBe(true)
    expect(isInviteableRole('MEMBER')).toBe(true)
    expect(isInviteableRole('VIEWER')).toBe(true)
  })
})

describe('existing permission policy is preserved (EXECUTABLE — real lib/permissions.ts)', () => {
  it('Admin and above may invite; Member and Viewer may not', () => {
    expect(can.inviteMembers('OWNER')).toBe(true)
    expect(can.inviteMembers('ADMIN')).toBe(true)
    expect(can.inviteMembers('MEMBER')).toBe(false)
    expect(can.inviteMembers('VIEWER')).toBe(false)
  })

  it('only the Owner may remove members, change roles, or manage billing', () => {
    for (const role of ['ADMIN', 'MEMBER', 'VIEWER'] as const) {
      expect(can.removeMembers(role)).toBe(false)
      expect(can.changeRoles(role)).toBe(false)
      expect(can.manageBilling(role)).toBe(false)
    }
    expect(can.removeMembers('OWNER')).toBe(true)
    expect(can.changeRoles('OWNER')).toBe(true)
    expect(can.manageBilling('OWNER')).toBe(true)
  })

  it('canGrantRole — only an Owner could ever grant OWNER, and Admin+ may grant the rest', () => {
    expect(canGrantRole('ADMIN', 'OWNER')).toBe(false)
    expect(canGrantRole('MEMBER', 'OWNER')).toBe(false)
    expect(canGrantRole('VIEWER', 'ADMIN')).toBe(false)
    expect(canGrantRole('ADMIN', 'MEMBER')).toBe(true)
    expect(canGrantRole('OWNER', 'ADMIN')).toBe(true)
  })

  it('the role hierarchy ordering is unchanged', () => {
    expect(hasRole('OWNER', 'ADMIN')).toBe(true)
    expect(hasRole('ADMIN', 'MEMBER')).toBe(true)
    expect(hasRole('MEMBER', 'VIEWER')).toBe(true)
    expect(hasRole('VIEWER', 'MEMBER')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-CONTRACT — invite creation concurrency
// ─────────────────────────────────────────────────────────────────────────────

describe('invite creation — concurrency contract (SOURCE-CONTRACT)', () => {
  const txMatch = inviteSource.match(/await prisma\.\$transaction\(async \(tx\) => \{[\s\S]*?\n {4}\}\)/)
  const txBody = txMatch?.[0] ?? ''

  it('locates the reservation transaction', () => {
    expect(txMatch).not.toBeNull()
  })

  it('locks the Workspace row first, before any count or read used for the decision', () => {
    const lockIdx = txBody.indexOf('lockWorkspaceRow(tx, membership.workspaceId)')
    const subIdx  = txBody.indexOf('tx.subscription.findUnique(')
    expect(lockIdx).toBeGreaterThan(-1)
    expect(subIdx).toBeGreaterThan(-1)
    expect(lockIdx).toBeLessThan(subIdx)
  })

  it('re-reads the Subscription/plan inside the lock rather than trusting the pre-transaction value', () => {
    expect(txBody).toMatch(/tx\.subscription\.findUnique\(\{\s*where:\s*\{ workspaceId: membership\.workspaceId \},/)
    expect(txBody).not.toMatch(/membership\.subscription\?\.plan/)
  })

  it('counts reserved seats inside the lock via the shared helper', () => {
    expect(txBody).toMatch(/countReservedSeats\(tx, membership\.workspaceId, now\)/)
  })

  it('enforces capacity via hasSeatCapacity before creating anything', () => {
    const capIdx    = txBody.indexOf('hasSeatCapacity(plan, reserved)')
    const createIdx = txBody.indexOf('tx.workspaceInvite.create(')
    expect(capIdx).toBeGreaterThan(-1)
    expect(createIdx).toBeGreaterThan(-1)
    expect(capIdx).toBeLessThan(createIdx)
  })

  it('rejects an existing member and an existing valid pending invite inside the same lock', () => {
    expect(txBody).toMatch(/already_member/)
    expect(txBody).toMatch(/already_invited/)
    expect(txBody).toMatch(/tx\.workspaceMember\.findUnique\(/)
    expect(txBody).toMatch(/tx\.workspaceInvite\.findFirst\(/)
  })

  it('matches both the member email and the prior invite email case-insensitively', () => {
    const matches = txBody.match(/mode: 'insensitive'/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('persists only the token HASH — the raw token never reaches the database', () => {
    expect(txBody).toMatch(/token:\s*tokenHash/)
    expect(txBody).not.toMatch(/token:\s*rawToken/)
  })

  it('the invitation is committed BEFORE the email is sent — no DB lock spans Resend', () => {
    const txIdx    = inviteSource.indexOf('await prisma.$transaction(')
    const emailIdx = inviteSource.indexOf('await resend.emails.send(')
    expect(txIdx).toBeGreaterThan(-1)
    expect(emailIdx).toBeGreaterThan(-1)
    expect(txIdx).toBeLessThan(emailIdx)
    expect(txBody).not.toMatch(/resend/)
  })

  it('POST contains exactly one transaction (the reservation)', () => {
    const postMatch = inviteSource.match(/export async function POST\(req: NextRequest\) \{[\s\S]*?\n\}\n/)
    const postSource = postMatch?.[0] ?? ''
    expect((postSource.match(/prisma\.\$transaction\(/g) ?? []).length).toBe(1)
  })

  it('uses no process-local/in-memory lock', () => {
    expect(inviteSource).not.toMatch(/new Map\(/)
    expect(inviteSource).not.toMatch(/new Set\(/)
    expect(inviteSource).not.toMatch(/\bmutex\b/i)
    expect(inviteSource).not.toMatch(/\bsemaphore\b/i)
  })
})

describe('invite creation — authorization and role validation (SOURCE-CONTRACT)', () => {
  it('rejects unauthenticated callers with 401', () => {
    expect(inviteSource).toMatch(/if \(!clerkId\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/)
  })

  it('requires can.inviteMembers (Admin+) before any work', () => {
    const permIdx = inviteSource.indexOf('can.inviteMembers(membership.role)')
    const txIdx   = inviteSource.indexOf('await prisma.$transaction(')
    expect(permIdx).toBeGreaterThan(-1)
    expect(permIdx).toBeLessThan(txIdx)
  })

  it('validates the requested role server-side via isInviteableRole, before the transaction', () => {
    const roleIdx = inviteSource.indexOf('isInviteableRole(role)')
    const txIdx   = inviteSource.indexOf('await prisma.$transaction(')
    expect(roleIdx).toBeGreaterThan(-1)
    expect(roleIdx).toBeLessThan(txIdx)
  })

  it('still applies canGrantRole so an inviter cannot exceed their own authority', () => {
    expect(inviteSource).toMatch(/canGrantRole\(membership\.role, role as TeamRole\)/)
  })

  it('is workspace-scoped throughout — never takes a workspaceId from the request body', () => {
    expect(inviteSource).not.toMatch(/body\.workspaceId/)
    expect(inviteSource).toMatch(/membership\.workspaceId/)
  })
})

describe('invite creation — email failure compensation (SOURCE-CONTRACT)', () => {
  it('tracks the created invitation id outside the try, so the catch can see it', () => {
    const declIdx = inviteSource.indexOf('let createdInviteId: string | null = null')
    const tryIdx  = inviteSource.indexOf('try {')
    expect(declIdx).toBeGreaterThan(-1)
    expect(declIdx).toBeLessThan(tryIdx)
  })

  it('compensation targets that exact invitation id AND is guarded on status PENDING', () => {
    expect(inviteSource).toMatch(
      /updateMany\(\{\s*where:\s*\{ id: createdInviteId, status: 'PENDING' \},\s*data:\s*\{ status: 'REVOKED', revokedAt: new Date\(\) \},/
    )
  })

  it('an accepted invitation can never be revoked by compensation (the PENDING guard)', () => {
    const catchBlock = inviteSource.match(/\} catch \(err: any\) \{[\s\S]*?\n {2}\}\n\}/)?.[0] ?? ''
    expect(catchBlock).toMatch(/status: 'PENDING'/)
  })

  it('compensation failure is logged separately and never masks the original failure', () => {
    expect(inviteSource).toMatch(/console\.error\('\[invite\] Failed to release reserved seat after email failure', compErr\)/)
  })

  it('the caller receives a sanitized error, never raw provider detail', () => {
    const catchBlock = inviteSource.match(/\} catch \(err: any\) \{[\s\S]*?\n {2}\}\n\}/)?.[0] ?? ''
    expect(catchBlock).toMatch(/return NextResponse\.json\(\{ error: 'Failed to send invite' \}, \{ status: 500 \}\)/)
    expect(catchBlock).not.toMatch(/err\.message/)
  })

  it('the raw token is never logged', () => {
    expect(inviteSource).not.toMatch(/console\.(log|error|warn)\([^)]*rawToken/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-CONTRACT — acceptance
// ─────────────────────────────────────────────────────────────────────────────

describe('invite acceptance — token lookup and legacy compatibility (SOURCE-CONTRACT)', () => {
  it('hashes the incoming token and looks it up by hash first', () => {
    expect(acceptSource).toMatch(/findUnique\(\{\s*where:\s*\{ token: hashInviteToken\(token\) \},/)
  })

  it('falls back to a raw lookup only when the hashed lookup misses AND the token is not modern-shaped (Stage 2B: prevents a stored hash from being replayed as a bearer token — see the isModernInviteToken describe block below)', () => {
    const hashIdx   = acceptSource.indexOf('hashInviteToken(token)')
    const legacyIdx = acceptSource.indexOf('findUnique({ where: { token } })')
    expect(hashIdx).toBeGreaterThan(-1)
    expect(legacyIdx).toBeGreaterThan(-1)
    expect(hashIdx).toBeLessThan(legacyIdx)
    expect(acceptSource).toMatch(/if \(!invite && !isModernInviteToken\(token\)\) \{\s*invite = await prisma\.workspaceInvite\.findUnique\(\{ where: \{ token \} \}\)/)
  })

  it('rejects unknown, non-pending, and expired invitations before doing any work', () => {
    expect(acceptSource).toMatch(/if \(!invite\) return NextResponse\.json\(\{ error: 'Invalid invitation' \}, \{ status: 404 \}\)/)
    expect(acceptSource).toMatch(/invite\.status !== 'PENDING'/)
    expect(acceptSource).toMatch(/new Date\(\) > invite\.expiresAt/)
  })

  it('never logs the raw token or its hash', () => {
    expect(acceptSource).not.toMatch(/console\.(log|error|warn)\([^)]*token/)
  })
})

describe('invite acceptance — email binding (SOURCE-CONTRACT)', () => {
  it('requires the signed-in account email to match the invited address, case-insensitively', () => {
    expect(acceptSource).toMatch(/user\.email\.toLowerCase\(\) !== invite\.email\.toLowerCase\(\)/)
  })

  it('a mismatched account is rejected with 403 and told which address was invited', () => {
    expect(acceptSource).toMatch(/This invitation was sent to \$\{invite\.email\}[\s\S]*?status: 403/)
  })
})

describe('invite acceptance — concurrency contract (SOURCE-CONTRACT)', () => {
  const txMatch = acceptSource.match(/await prisma\.\$transaction\(async \(tx\) => \{[\s\S]*?\n {4}\}\)/)
  const txBody = txMatch?.[0] ?? ''

  it('locates the acceptance transaction', () => {
    expect(txMatch).not.toBeNull()
  })

  it('locks the Workspace row before re-reading anything', () => {
    const lockIdx  = txBody.indexOf('lockWorkspaceRow(tx, invite!.workspaceId)')
    const freshIdx = txBody.indexOf('tx.workspaceInvite.findUnique(')
    expect(lockIdx).toBeGreaterThan(-1)
    expect(freshIdx).toBeGreaterThan(-1)
    expect(lockIdx).toBeLessThan(freshIdx)
  })

  it('re-reads the invitation fresh inside the lock and re-checks PENDING + expiry', () => {
    expect(txBody).toMatch(/if \(!fresh \|\| fresh\.status !== 'PENDING'\) return \{ kind: 'already_used' \}/)
    expect(txBody).toMatch(/if \(new Date\(\) > fresh\.expiresAt\) return \{ kind: 'expired' \}/)
  })

  it('re-reads the CURRENT plan inside the lock — the send-time decision is not trusted', () => {
    expect(txBody).toMatch(/tx\.subscription\.findUnique\(\{\s*where:\s*\{ workspaceId: fresh\.workspaceId \},/)
  })

  it('re-counts reserved seats and applies fitsWithinSeatLimit (net-zero move, current entitlement)', () => {
    expect(txBody).toMatch(/countReservedSeats\(tx, fresh\.workspaceId\)/)
    expect(txBody).toMatch(/fitsWithinSeatLimit\(plan, reserved\)/)
  })

  it('an over-limit workspace (e.g. after downgrade) is rejected at acceptance', () => {
    expect(txBody).toMatch(/over_seat_limit/)
    expect(acceptSource).toMatch(/result\.kind === 'over_seat_limit'[\s\S]*?status: 403/)
  })

  it('consumes the invitation with a conditional PENDING-guarded updateMany, so replay loses', () => {
    expect(txBody).toMatch(
      /updateMany\(\{\s*where:\s*\{ id: fresh\.id, status: 'PENDING' \},\s*data:\s*\{ status: 'ACCEPTED', acceptedAt: new Date\(\), acceptedByUserId: user\.id \},/
    )
    expect(txBody).toMatch(/if \(claimed\.count !== 1\) throw new InviteClaimLostError\(\)/)
  })

  it('membership creation and invitation consumption happen in the SAME transaction', () => {
    expect(txBody).toMatch(/tx\.workspaceMember\.create\(/)
    expect(txBody).toMatch(/tx\.workspaceInvite\.updateMany\(/)
  })

  it('the granted role comes from the stored invitation, never from the request body', () => {
    expect(txBody).toMatch(/role:\s*fresh\.role,/)
    expect(acceptSource).not.toMatch(/body\.role/)
    expect(acceptSource).not.toMatch(/const \{ token, role \}/)
  })

  it('a duplicate membership is rejected before any write', () => {
    expect(txBody).toMatch(/already_member/)
    expect(txBody).toMatch(/tx\.workspaceMember\.findUnique\(/)
  })

  it('no network call happens inside the acceptance transaction', () => {
    expect(txBody).not.toMatch(/resend|fetch\(|sendQBREmail/)
  })

  it('a lost claim returns the already-used response, never a 500', () => {
    expect(acceptSource).toMatch(/err instanceof InviteClaimLostError/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-CONTRACT — revocation, removal, role changes
// ─────────────────────────────────────────────────────────────────────────────

describe('revocation (SOURCE-CONTRACT)', () => {
  const deleteBlock = inviteSource.match(/export async function DELETE\([\s\S]*$/)?.[0] ?? ''

  it('requires authentication and the same can.inviteMembers permission as creation', () => {
    expect(deleteBlock).toMatch(/if \(!clerkId\)/)
    expect(deleteBlock).toMatch(/can\.inviteMembers\(membership\.role\)/)
  })

  it('is workspace-scoped — another workspace\'s invitation returns 404, not an error leak', () => {
    expect(deleteBlock).toMatch(/invite\.workspaceId !== membership\.workspaceId/)
    expect(deleteBlock).toMatch(/\{ error: 'Not found' \}, \{ status: 404 \}/)
  })

  it('sets REVOKED and stamps revokedAt, releasing the reserved seat', () => {
    expect(deleteBlock).toMatch(/status: 'REVOKED', revokedAt: new Date\(\)/)
  })
})

describe('member removal and role changes are unchanged and still safe (SOURCE-CONTRACT)', () => {
  it('removal is Owner-only via can.removeMembers', () => {
    expect(membersSource).toMatch(/can\.removeMembers\(membership\.role\)/)
  })

  it('role change is Owner-only via can.changeRoles', () => {
    expect(membersSource).toMatch(/can\.changeRoles\(membership\.role\)/)
  })

  it('both are workspace-scoped — a cross-workspace target returns 404', () => {
    const crossChecks = membersSource.match(/target\.workspaceId !== membership\.workspaceId/g) ?? []
    expect(crossChecks.length).toBe(2)
  })

  it('the last Owner can be neither removed nor demoted', () => {
    expect(membersSource).toMatch(/Cannot remove the last owner/)
    expect(membersSource).toMatch(/Cannot demote the last owner/)
  })

  it('role changes validate against the real enum and canGrantRole', () => {
    expect(membersSource).toMatch(/VALID_ROLES\.includes\(role as TeamRole\)/)
    expect(membersSource).toMatch(/canGrantRole\(membership\.role, role as TeamRole\)/)
  })

  it('removal deletes only the membership — no Client, QBR, or User deletion anywhere', () => {
    expect(membersSource).toMatch(/prisma\.workspaceMember\.delete\(/)
    expect(membersSource).not.toMatch(/prisma\.client\.delete/)
    expect(membersSource).not.toMatch(/prisma\.qBR\.delete/)
    expect(membersSource).not.toMatch(/prisma\.user\.delete/)
    expect(membersSource).not.toMatch(/clerkClient/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-CONTRACT — expiry surfacing and seat display
// ─────────────────────────────────────────────────────────────────────────────

describe('expired invitations are not presented as active (SOURCE-CONTRACT)', () => {
  it('the workspace API computes expiry from expiresAt rather than trusting stored status', () => {
    expect(workspaceSource).toMatch(/expired:\s*i\.expiresAt <= now/)
  })

  it('Settings renders an Expired badge instead of Pending for a lapsed invitation', () => {
    expect(settingsSource).toMatch(/inv\.expired \?/)
    expect(settingsSource).toMatch(/>Expired<\/span>/)
  })
})

describe('seat usage is reported honestly (SOURCE-CONTRACT)', () => {
  it('the workspace API returns reserved capacity = members + valid pending invites', () => {
    expect(workspaceSource).toMatch(/reserved:\s*members\.length \+ pendingInviteCount/)
    expect(workspaceSource).toMatch(/limit:\s*getLimits\(plan\)\.teamSeats/)
  })

  it('only unexpired pending invitations count toward reserved capacity', () => {
    expect(workspaceSource).toMatch(/decoratedInvites\.filter\(i => !i\.expired\)\.length/)
  })

  it('the Billing usage row counts pending invitations, not members alone', () => {
    expect(billingSource).toMatch(/status: 'PENDING', expiresAt: \{ gt: new Date\(\) \}/)
    expect(billingSource).toMatch(/const seatsUsed = memberCount \+ pendingInviteCount/)
    expect(billingSource).toMatch(/used=\{seatsUsed\}/)
  })

  it('Billing still renders Unlimited for a null limit (Agency), never a numeric stand-in', () => {
    expect(billingSource).toMatch(/isUnlimited \? 'Unlimited' : limit/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scope guard
// ─────────────────────────────────────────────────────────────────────────────

describe('Stage 2 scope discipline (SOURCE-CONTRACT)', () => {
  it('no Stripe, pricing, or subscription-lifecycle code is touched by the invite routes', () => {
    for (const src of [inviteSource, acceptSource]) {
      expect(src).not.toMatch(/stripe/i)
      expect(src).not.toMatch(/subscription\.(update|create|upsert)\(/)
    }
  })

  it('no ownership-transfer, Clerk Organizations, SSO, or rate-limiting infrastructure was added', () => {
    for (const src of [inviteSource, acceptSource]) {
      expect(src).not.toMatch(/organization/i)
      expect(src).not.toMatch(/rateLimit|ratelimit/i)
      expect(src).not.toMatch(/redis|upstash|kv/i)
    }
  })

  it('no background job or cron was introduced to expire invitations', () => {
    expect(inviteSource).not.toMatch(/cron/i)
    expect(acceptSource).not.toMatch(/cron/i)
  })
})

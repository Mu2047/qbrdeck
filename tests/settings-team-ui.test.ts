import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { can } from '@/lib/permissions'
import { INVITEABLE_ROLES, hasSeatCapacity } from '@/lib/team-invites'

// Admin invite UI alignment — Settings → Team must show exactly the controls
// the server already permits.
//
// Same honesty labels as tests/team-collaboration.test.ts:
//
//  - EXECUTABLE: the page's two role booleans (isOwner, canInvite) are pulled
//    out of the source and evaluated for every role, then checked against the
//    real can.* helpers in lib/permissions.ts. The UI cannot drift from the
//    server policy without failing here.
//
//  - SOURCE-CONTRACT: which JSX block each boolean guards is proven by slicing
//    the page between its section comments. This repo has no React rendering
//    harness, so nothing here mounts the component.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const settingsSource = readSourceLF('app/(app)/dashboard/(gated)/settings/page.tsx')
const inviteSource   = readSourceLF('app/api/workspace/invite/route.ts')

const ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start)
  const to   = source.indexOf(end, from + start.length)
  expect(from, `marker not found: ${start}`).toBeGreaterThanOrEqual(0)
  expect(to, `marker not found: ${end}`).toBeGreaterThan(from)
  return source.slice(from, to)
}

// Evaluates `const <name> = <expr>` from the page for a given currentRole.
function evalRoleBoolean(name: string, role: string): boolean {
  const match = settingsSource.match(new RegExp(`const ${name} = (currentRole[^\\n]*)`))
  expect(match, `${name} declaration not found`).not.toBeNull()
  const expr = match![1]
  // Only role-literal comparisons joined by || — refuse to eval anything else.
  expect(expr).toMatch(/^currentRole === '[A-Z]+'( \|\| currentRole === '[A-Z]+')*$/)
  return new Function('currentRole', `return ${expr}`)(role)
}

const inviteForm     = between(settingsSource, '{/* Invite form', '{/* Members list */}')
const membersList    = between(settingsSource, '{/* Members list */}', '{/* Pending invites */}')
const pendingInvites = between(settingsSource, '{/* Pending invites */}', '{/* Role guide */}')
const planGate       = between(inviteForm, "(plan === 'FREE' || plan === 'SOLO') ?", ') : (\n                <div className="space-y-3">')

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTABLE — UI booleans agree with the server permission helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('Settings role booleans (EXECUTABLE — evaluated per role)', () => {
  it('canInvite: Owner and Admin yes, Member and Viewer no', () => {
    expect(evalRoleBoolean('canInvite', 'OWNER')).toBe(true)
    expect(evalRoleBoolean('canInvite', 'ADMIN')).toBe(true)
    expect(evalRoleBoolean('canInvite', 'MEMBER')).toBe(false)
    expect(evalRoleBoolean('canInvite', 'VIEWER')).toBe(false)
  })

  it('canInvite matches can.inviteMembers for every role (the check the invite API enforces for send AND revoke)', () => {
    for (const role of ROLES) {
      expect(evalRoleBoolean('canInvite', role)).toBe(can.inviteMembers(role))
    }
  })

  it('isOwner matches can.removeMembers, can.changeRoles and can.manageBilling for every role', () => {
    for (const role of ROLES) {
      const owner = evalRoleBoolean('isOwner', role)
      expect(owner).toBe(can.removeMembers(role))
      expect(owner).toBe(can.changeRoles(role))
      expect(owner).toBe(can.manageBilling(role))
    }
  })

  it('the page does not import the server permission module (it pulls in @prisma/client)', () => {
    expect(settingsSource).not.toMatch(/from ['"]@\/lib\/permissions['"]/)
    expect(settingsSource).not.toMatch(/from ['"]@prisma\/client['"]/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-CONTRACT — which control each boolean guards
// ─────────────────────────────────────────────────────────────────────────────

describe('invite form visibility (SOURCE-CONTRACT)', () => {
  it('is guarded by canInvite (Owner + Admin), no longer by isOwner', () => {
    expect(inviteForm).toMatch(/^\{\/\* Invite form[^\n]*\*\/\}\n\s*\{canInvite && \(/)
  })

  it('offers exactly ADMIN, MEMBER, VIEWER — OWNER can never be selected', () => {
    expect(inviteForm).toContain("(['ADMIN', 'MEMBER', 'VIEWER'] as Role[]).map(r => (")
    expect(inviteForm).not.toMatch(/'OWNER'/)
    // The dropdown and the server's inviteable set are the same three roles.
    expect([...INVITEABLE_ROLES]).toEqual(['ADMIN', 'MEMBER', 'VIEWER'])
  })
})

describe('Free/Solo plan gate (SOURCE-CONTRACT)', () => {
  it('both Owner and Admin see that team access requires Growth', () => {
    expect(planGate).toContain('Team access requires Growth plan')
  })

  it('the Upgrade to Growth billing link is shown only to the Owner', () => {
    const ownerBranch = between(planGate, '{isOwner ? (', ') : (')
    expect(ownerBranch).toContain('href="/dashboard/billing"')
    expect(ownerBranch).toContain('Upgrade to Growth')
    // Exactly one billing link in the whole gate, and it is the Owner's.
    expect(planGate.match(/\/dashboard\/billing/g)).toHaveLength(1)
  })

  it('an Admin is told to ask the Owner instead, with no link or button', () => {
    const adminBranch = planGate.slice(planGate.indexOf(') : (', planGate.indexOf('{isOwner ? (')))
    expect(adminBranch).toContain('Ask your workspace Owner to upgrade to Growth.')
    expect(adminBranch).not.toMatch(/<a\b|<button\b|billing/)
  })
})

describe('pending-invite revoke (SOURCE-CONTRACT)', () => {
  it('the revoke button is guarded by canInvite (Owner + Admin), matching DELETE /api/workspace/invite', () => {
    expect(pendingInvites).toMatch(/\{canInvite && \(\s*<button onClick=\{\(\) => revokeInvite\(inv\.id\)\}/)
    expect(pendingInvites).not.toMatch(/isOwner/)
  })

  it('the revoke API still gates on can.inviteMembers and only scopes by workspace, not by inviter', () => {
    const del = inviteSource.slice(inviteSource.indexOf('export async function DELETE'))
    expect(del).toMatch(/if \(!can\.inviteMembers\(membership\.role\)\)/)
    expect(del).toMatch(/invite\.workspaceId !== membership\.workspaceId/)
    expect(del).not.toMatch(/invitedById/)
  })
})

describe('Owner-only controls are unchanged (SOURCE-CONTRACT)', () => {
  it('the member role dropdown is still Owner-only', () => {
    expect(membersList).toMatch(/\{isOwner && m\.role !== 'OWNER' \? \(\s*<select/)
  })

  it('the remove-member button is still Owner-only', () => {
    expect(membersList).toMatch(/\{isOwner && m\.role !== 'OWNER' && \(\s*<button onClick=\{\(\) => removeMember\(m\.id\)\}/)
  })

  it('canInvite grants nothing in the members list — no role change, removal, or ownership transfer', () => {
    expect(membersList).not.toMatch(/canInvite/)
    // The role dropdown never offers OWNER, so there is no transfer path here.
    expect(membersList).toContain("(['ADMIN', 'MEMBER', 'VIEWER'] as Role[]).map(r => (")
  })

  it('the General-tab billing card is still Owner-only', () => {
    expect(settingsSource).toMatch(/\{!subLoading && subscription && isOwner && \(/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Regression — seat enforcement stays server-side
// ─────────────────────────────────────────────────────────────────────────────

describe('Growth seat limit stays server-side and role-independent', () => {
  it('the invite route enforces hasSeatCapacity on the locked, freshly read plan for every inviter', () => {
    expect(inviteSource).toMatch(/await lockWorkspaceRow\(tx, membership\.workspaceId\)/)
    expect(inviteSource).toMatch(/if \(!hasSeatCapacity\(plan, reserved\)\)/)
    // The seat check never branches on the inviter's role.
    const tx = between(inviteSource, 'prisma.$transaction(async (tx) => {', "return { kind: 'created'")
    expect(tx).not.toMatch(/membership\.role/)
  })

  it('Growth still caps at 5 reserved seats (owner + 4), whoever sends the invite', () => {
    expect(hasSeatCapacity('GROWTH', 4)).toBe(true)
    expect(hasSeatCapacity('GROWTH', 5)).toBe(false)
  })

  it('the Settings page does no seat arithmetic of its own', () => {
    expect(settingsSource).not.toMatch(/hasSeatCapacity|countReservedSeats|teamSeats/)
  })
})

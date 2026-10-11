import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { can } from '@/lib/permissions'
import { buildWorkspaceList, selectActiveMembership } from '@/lib/workspace'

// Member/Viewer UI alignment — client-management and QBR controls must follow
// the same can.* checks the API routes enforce.
//
// Production certification: a MEMBER in Test Growth was offered "+ Add client"
// on the Dashboard and "Edit" on client detail, although POST /api/clients
// (can.createClient) and PATCH /api/clients/[id] (can.editClient) are ADMIN+.
//
// Same honesty labels as the other suites here:
//  - EXECUTABLE: real can.* and active-workspace resolution, per role.
//  - SOURCE-CONTRACT: which JSX each gate wraps, proven by reading the pages
//    as text (this repo has no component rendering harness).

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const dashboardSource    = readSourceLF('app/(app)/dashboard/(gated)/page.tsx')
const clientsSource      = readSourceLF('app/(app)/dashboard/(gated)/clients/page.tsx')
const clientDetailSource = readSourceLF('app/(app)/dashboard/(gated)/clients/[id]/page.tsx')
const analyticsSource    = readSourceLF('app/(app)/dashboard/(gated)/analytics/page.tsx')
const settingsSource     = readSourceLF('app/(app)/dashboard/(gated)/settings/page.tsx')
const permissionsSource  = readSourceLF('lib/permissions.ts')
const limitsSource       = readSourceLF('lib/limits.ts')
const hookSource         = readSourceLF('lib/use-active-role.ts')
const clientsRoute       = readSourceLF('app/api/clients/route.ts')
const clientRoute        = readSourceLF('app/api/clients/[id]/route.ts')
const generateRoute      = readSourceLF('app/api/generate-qbr/route.ts')
const qbrRoute           = readSourceLF('app/api/qbrs/[qbrId]/route.ts')
const logoRoute          = readSourceLF('app/api/upload-logo/route.ts')
const workspaceRoute     = readSourceLF('app/api/workspace/route.ts')

const ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const
type Role = (typeof ROLES)[number]

// Every occurrence of `needle` must sit directly inside `{<gate> && (`.
function expectEveryOccurrenceGated(source: string, needle: string, gate: string) {
  const total = source.split(needle).length - 1
  expect(total, `${needle} not found`).toBeGreaterThan(0)
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const gated = source.match(new RegExp(`\\{${gate} && \\(\\s*${escaped}`, 'g')) ?? []
  expect(gated.length, `every "${needle}" must be wrapped in {${gate} && (`).toBe(total)
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTABLE — the role matrix the UI now follows
// ─────────────────────────────────────────────────────────────────────────────

describe('canonical role matrix (EXECUTABLE — real lib/permissions.ts)', () => {
  const expected: Record<Role, Record<string, boolean>> = {
    OWNER:  { createClient: true,  editClient: true,  generateQBR: true,  viewClients: true, viewQBR: true, manageSettings: true,  inviteMembers: true,  changeRoles: true,  removeMembers: true,  manageBilling: true  },
    ADMIN:  { createClient: true,  editClient: true,  generateQBR: true,  viewClients: true, viewQBR: true, manageSettings: false, inviteMembers: true,  changeRoles: false, removeMembers: false, manageBilling: false },
    MEMBER: { createClient: false, editClient: false, generateQBR: true,  viewClients: true, viewQBR: true, manageSettings: false, inviteMembers: false, changeRoles: false, removeMembers: false, manageBilling: false },
    VIEWER: { createClient: false, editClient: false, generateQBR: false, viewClients: true, viewQBR: true, manageSettings: false, inviteMembers: false, changeRoles: false, removeMembers: false, manageBilling: false },
  }

  for (const role of ROLES) {
    it(`${role}: ${Object.entries(expected[role]).filter(([, v]) => v).map(([k]) => k).join(', ') || 'view only'}`, () => {
      for (const [action, allowed] of Object.entries(expected[role])) {
        expect((can as Record<string, (r: Role) => boolean>)[action](role), `${role}.${action}`).toBe(allowed)
      }
    })
  }
})

describe('active-workspace role isolation (EXECUTABLE)', () => {
  const memberships = [
    { workspaceId: 'ws_a', role: 'OWNER'  as const, workspace: { name: 'Owned Co' } },
    { workspaceId: 'ws_b', role: 'MEMBER' as const, workspace: { name: 'Test Growth' } },
  ]

  it('server pages: A active → Owner controls; B active → Member controls only', () => {
    const a = selectActiveMembership(memberships, 'ws_a')!.role
    const b = selectActiveMembership(memberships, 'ws_b')!.role
    expect([can.createClient(a), can.editClient(a), can.generateQBR(a), can.manageSettings(a)]).toEqual([true, true, true, true])
    expect([can.createClient(b), can.editClient(b), can.generateQBR(b), can.manageSettings(b)]).toEqual([false, false, true, false])
  })

  it('client pages (useActiveRole): the role is taken from the list entry flagged active, never another membership', () => {
    // Mirrors useActiveRole: GET /api/workspace/active returns buildWorkspaceList(...)
    // and the hook reads the entry with active === true.
    const activeRole = (activeId: string) =>
      buildWorkspaceList(memberships, activeId).find(w => w.active)!.role
    expect(can.editClient(activeRole('ws_a'))).toBe(true)
    expect(can.editClient(activeRole('ws_b'))).toBe(false)
    expect(can.generateQBR(activeRole('ws_b'))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-CONTRACT — backend authority (unchanged) and client-safety
// ─────────────────────────────────────────────────────────────────────────────

describe('API routes enforce the same checks the UI now mirrors (SOURCE-CONTRACT)', () => {
  it('create, edit, delete client: createClient / editClient / deleteClient', () => {
    expect(clientsRoute).toContain('if (!can.createClient(membership.role))')
    expect(clientRoute).toContain('if (!can.editClient(membership.role))')
    expect(clientRoute).toContain('if (!can.deleteClient(membership.role))')
  })

  it('generate and view QBR: generateQBR / viewQBR', () => {
    expect(generateRoute).toContain('if (!can.generateQBR(membership.role))')
    expect(qbrRoute).toContain('if (!can.viewQBR(membership.role))')
  })

  it('logo upload and workspace settings: manageSettings (Owner-only)', () => {
    expect(logoRoute).toContain('if (!can.manageSettings(membership.role))')
    expect(workspaceRoute).toContain('if (!can.manageSettings(membership.role))')
  })
})

describe('lib/permissions.ts is safe to import from client components (SOURCE-CONTRACT)', () => {
  it('imports Prisma types only, never the runtime client', () => {
    expect(permissionsSource).toContain("import type { TeamRole } from '@prisma/client'")
    expect(permissionsSource).not.toMatch(/^import \{[^}]*\} from '@prisma\/client'/m)
    expect(permissionsSource).not.toMatch(/@\/lib\/prisma|@clerk\/nextjs\/server|next\/headers/)
  })

  it('its only runtime dependency, lib/limits.ts, imports nothing', () => {
    expect(permissionsSource.match(/^import (?!type)[^\n]*/gm)).toEqual(["import { getLimits } from '@/lib/limits'"])
    expect(limitsSource).not.toMatch(/^import\b/m)
  })

  it('useActiveRole reads the active entry of GET /api/workspace/active and fails closed', () => {
    expect(hookSource).toMatch(/^'use client'/)
    expect(hookSource).toContain("fetch('/api/workspace/active'")
    expect(hookSource).toContain('.find((w: { active: boolean }) => w.active)')
    expect(hookSource).toMatch(/\.catch\(\(\) => \{\s*if \(!cancelled\) setRole\(null\)/)
    expect(hookSource).toContain('useState<TeamRole | null>(null)')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-CONTRACT — page gates
// ─────────────────────────────────────────────────────────────────────────────

describe('Dashboard (server page)', () => {
  it('derives both gates from can.* on the active-workspace role', () => {
    expect(dashboardSource).toContain('const canCreateClient = can.createClient(ctx.member.role)')
    expect(dashboardSource).toContain('const canGenerateQBR  = can.generateQBR(ctx.member.role)')
  })

  it('every "Add client" link is Admin+ only (hidden for Member and Viewer)', () => {
    expectEveryOccurrenceGated(dashboardSource, '<Link href="/dashboard/clients/new"', 'canCreateClient')
  })

  it('"Start QBR" is Member+ (still shown to Member, hidden for Viewer)', () => {
    expectEveryOccurrenceGated(dashboardSource, '<Link\n            href={`/dashboard/clients/${client.id}/qbr/new', 'canGenerateQBR')
  })

  it('client rows stay visible to every role', () => {
    expect(dashboardSource).toMatch(/\{clients\.map\(\(client\) => \(\s*<Link key=\{client\.id\} href=\{`\/dashboard\/clients\/\$\{client\.id\}`\}/)
  })
})

describe('Clients list (server page)', () => {
  it('derives the gate from can.createClient on the active-workspace role', () => {
    expect(clientsSource).toContain('const canCreateClient = can.createClient(ctx.member.role)')
  })

  it('every "Add client" link is Admin+ only', () => {
    expectEveryOccurrenceGated(clientsSource, '<Link href="/dashboard/clients/new"', 'canCreateClient')
  })

  it('the client list itself is not gated', () => {
    expect(clientsSource).toMatch(/\{clients\.map\(\(client\) => \(\s*<Link key=\{client\.id\}/)
  })
})

describe('Client detail (client page)', () => {
  it('derives gates from can.* on useActiveRole(), failing closed while the role is unknown', () => {
    expect(clientDetailSource).toContain('const role           = useActiveRole()')
    expect(clientDetailSource).toContain('const canEditClient  = role !== null && can.editClient(role)')
    expect(clientDetailSource).toContain('const canGenerateQBR = role !== null && can.generateQBR(role)')
  })

  it('"Edit" is Admin+ only', () => {
    expect(clientDetailSource).toMatch(/\{canEditClient && \(\s*<button\s+onClick=\{\(\) => \{ setError\(''\); setEditing\(true\) \}\}/)
    expect(clientDetailSource.match(/setEditing\(true\)/g)).toHaveLength(1)
  })

  it('the next-QBR date picker and "Save date" (both PATCH the client) are Admin+ only', () => {
    expect(clientDetailSource).toMatch(/\{canEditClient && \(\s*<div className="flex items-center gap-2">\s*<input\s+type="date"/)
    const gated = clientDetailSource.slice(clientDetailSource.indexOf('{canEditClient && (\n          <div className="flex items-center gap-2">'))
    expect(gated.indexOf("'Save date'")).toBeLessThan(gated.indexOf('\n          )}'))
  })

  it('the only PATCH calls on the page are behind canEditClient', () => {
    expect(clientDetailSource.match(/method: 'PATCH'/g)).toHaveLength(2)
  })

  it('"New QBR" and "Generate first QBR" are Member+ (hidden for Viewer)', () => {
    expectEveryOccurrenceGated(clientDetailSource, '<Link href={`/dashboard/clients/${client.id}/qbr/new`}', 'canGenerateQBR')
  })

  it('QBR schedule and QBR history stay visible to every role', () => {
    expect(clientDetailSource).toContain('{/* QBR Schedule */}\n      {!editing && (')
    expect(clientDetailSource).toMatch(/\{client\.qbrs\?\.map\(\(qbr: any\) => \(\s*<Link/)
  })

  it('no hard-coded role comparisons', () => {
    expect(clientDetailSource).not.toMatch(/role\s*===\s*'/)
  })
})

describe('Analytics (client page)', () => {
  it('"Add your first client" is Admin+ only, failing closed', () => {
    expect(analyticsSource).toContain('const canCreateClient = role !== null && can.createClient(role)')
    expectEveryOccurrenceGated(analyticsSource, '<Link href="/dashboard/clients/new"', 'canCreateClient')
  })
})

describe('Settings → General: Owner-only branding/workspace controls are non-actionable for others', () => {
  it('"Upload logo" is rendered for everyone but disabled for non-Owners', () => {
    expect(settingsSource).toMatch(/onClick=\{\(\) => fileInputRef\.current\?\.click\(\)\} disabled=\{logoUploading \|\| !isOwner\}/)
    expect(settingsSource).toContain('Only the workspace owner can change the logo.')
  })

  it('workspace name is disabled and "Save settings" hidden for non-Owners', () => {
    expect(settingsSource).toMatch(/value=\{companyName\}[^\n]*disabled=\{!isOwner\}/)
    expect(settingsSource).toMatch(/\{isOwner && \(\s*<button onClick=\{save\}/)
  })
})

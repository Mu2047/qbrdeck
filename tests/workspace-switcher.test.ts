import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildWorkspaceList, selectActiveMembership } from '@/lib/workspace'
import { can } from '@/lib/permissions'

// Stage 2G2 — minimal multi-workspace switcher.
//
// Same two-kind convention as tests/active-workspace-foundation.test.ts and
// tests/team-collaboration.test.ts:
//
//  - EXECUTABLE tests import the real lib/workspace.ts and lib/permissions.ts
//    and run them directly.
//
//  - SOURCE-CONTRACT tests read app/api/workspace/active/route.ts and
//    app/(app)/layout.tsx as plain text and regex-match against them — this
//    repo has no Clerk/Prisma/Next-request mocking harness and no component
//    rendering harness (same precedent as every other *.test.ts here), so the
//    full fetch -> switch -> refresh flow is proven structurally.
//
// No test here opens a database connection, calls Clerk, or switches the real
// Production user's active workspace.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const switchRouteSource = readSourceLF('app/api/workspace/active/route.ts')
const appLayoutSource   = readSourceLF('app/(app)/layout.tsx')
const checkoutSource    = readSourceLF('app/api/billing/checkout/route.ts')
const portalSource      = readSourceLF('app/api/billing/portal/route.ts')

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTABLE — buildWorkspaceList (lib/workspace.ts)
// ─────────────────────────────────────────────────────────────────────────────

type M = { workspaceId: string; role: 'OWNER' | 'ADMIN' | 'VIEWER'; workspace: { name: string } }

const soloA   : M = { workspaceId: 'ws_solo',   role: 'OWNER', workspace: { name: 'Solo Co' } }
const growthB : M = { workspaceId: 'ws_growth', role: 'ADMIN', workspace: { name: 'Test Growth' } }
const agencyC : M = { workspaceId: 'ws_agency', role: 'VIEWER', workspace: { name: 'Agency Inc' } }

describe('buildWorkspaceList — switcher data shape (EXECUTABLE — real lib/workspace.ts)', () => {
  it('one membership: single entry, marked active, correct role', () => {
    const list = buildWorkspaceList([soloA], 'ws_solo')
    expect(list).toEqual([{ workspaceId: 'ws_solo', name: 'Solo Co', role: 'OWNER', active: true }])
  })

  it('two memberships: both present, roles preserved, only the active one flagged', () => {
    const list = buildWorkspaceList([soloA, growthB], 'ws_growth')
    expect(list).toHaveLength(2)
    expect(list.find(w => w.workspaceId === 'ws_solo')).toMatchObject({ role: 'OWNER', active: false })
    expect(list.find(w => w.workspaceId === 'ws_growth')).toMatchObject({ role: 'ADMIN', active: true })
  })

  it('the active workspace is always ordered first, regardless of input order', () => {
    expect(buildWorkspaceList([soloA, growthB], 'ws_growth')[0].workspaceId).toBe('ws_growth')
    expect(buildWorkspaceList([growthB, soloA], 'ws_solo')[0].workspaceId).toBe('ws_solo')
  })

  it('a membership absent from the input (e.g. removed) never appears in the output', () => {
    // Simulates removal: ws_agency simply isn't in the list the caller passed
    // (because it already isn't in the real WorkspaceMember rows anymore).
    const list = buildWorkspaceList([soloA, growthB], 'ws_solo')
    expect(list.some(w => w.workspaceId === 'ws_agency')).toBe(false)
  })

  it('an activeId naming a workspace not present marks nothing active, and never throws', () => {
    expect(() => buildWorkspaceList([soloA, growthB], 'ws_not_a_real_membership')).not.toThrow()
    const list = buildWorkspaceList([soloA, growthB], 'ws_not_a_real_membership')
    expect(list.every(w => w.active === false)).toBe(true)
  })

  it('a null activeId marks nothing active, and never throws', () => {
    expect(() => buildWorkspaceList([soloA, growthB], null)).not.toThrow()
    expect(buildWorkspaceList([soloA, growthB], null).every(w => w.active === false)).toBe(true)
  })

  it('is pure — two independent calls never leak into each other (no cross-user data)', () => {
    const userOneList = buildWorkspaceList([soloA], 'ws_solo')
    const userTwoList = buildWorkspaceList([growthB, agencyC], 'ws_growth')
    expect(userOneList).toHaveLength(1)
    expect(userTwoList).toHaveLength(2)
    expect(userOneList.some(w => w.workspaceId === 'ws_growth' || w.workspaceId === 'ws_agency')).toBe(false)
    expect(userTwoList.some(w => w.workspaceId === 'ws_solo')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTABLE — role isolation, explicit switcher-context regression
// ─────────────────────────────────────────────────────────────────────────────

describe('switching workspace changes the role fed to can.* — never merges roles (EXECUTABLE)', () => {
  it('Owner in A, Admin in B: selecting A yields OWNER permissions, selecting B yields ADMIN permissions', () => {
    const memberships = [soloA, growthB]

    const selectedA = selectActiveMembership(memberships, 'ws_solo')!
    expect(can.manageBilling(selectedA.role)).toBe(true)

    const selectedB = selectActiveMembership(memberships, 'ws_growth')!
    expect(can.manageBilling(selectedB.role)).toBe(false)
    expect(can.inviteMembers(selectedB.role)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-CONTRACT — switch endpoint (app/api/workspace/active/route.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe('switch endpoint — auth and input validation (SOURCE-CONTRACT, Stage 2G2)', () => {
  it('GET requires authentication before listing', () => {
    const getMatch = switchRouteSource.match(/export async function GET\(\) \{([\s\S]*?)\n\}/)
    const getBody = getMatch?.[1] ?? ''
    expect(getMatch).not.toBeNull()
    expect(getBody).toMatch(/status: 401/)
  })

  it('POST requires authentication and validates workspaceId before touching the database', () => {
    const postIdx        = switchRouteSource.indexOf('export async function POST')
    const authCheckIdx   = switchRouteSource.indexOf('status: 401', postIdx)
    const validateIdx    = switchRouteSource.indexOf("status: 400", postIdx)
    const dbFindIdx       = switchRouteSource.indexOf('prisma.user.findUnique', postIdx)
    expect(postIdx).toBeGreaterThan(-1)
    expect(authCheckIdx).toBeGreaterThan(postIdx)
    expect(validateIdx).toBeGreaterThan(authCheckIdx)
    expect(dbFindIdx).toBeGreaterThan(validateIdx)
  })
})

describe('switch endpoint — membership is the only authority (SOURCE-CONTRACT, Stage 2G2)', () => {
  it('verifies WorkspaceMember for exactly this user and this workspace via the composite key', () => {
    expect(switchRouteSource).toContain('workspaceId_userId: { workspaceId, userId: user.id }')
  })

  it('rejects with 403 when no membership is found, before the cookie is ever set', () => {
    const rejectIdx = switchRouteSource.indexOf("status: 403")
    const cookieIdx  = switchRouteSource.indexOf('setActiveWorkspaceCookie(')
    expect(rejectIdx).toBeGreaterThan(-1)
    expect(cookieIdx).toBeGreaterThan(-1)
    expect(rejectIdx).toBeLessThan(cookieIdx)
  })

  it('does not gate on role — a Viewer may switch into a workspace they belong to', () => {
    // The membership existence check selects only `{ id: true }` — it never
    // reads or branches on `role`, so no role value can block a legitimate
    // switch.
    const membershipCheck = switchRouteSource.match(
      /const membership = await prisma\.workspaceMember\.findUnique\(\{([\s\S]*?)\n  \}\)/
    )
    const body = membershipCheck?.[1] ?? ''
    expect(membershipCheck).not.toBeNull()
    expect(body).not.toMatch(/role/)
  })

  it('uses the shared cookie-write helper rather than duplicating cookie options', () => {
    expect(switchRouteSource).toContain("import { setActiveWorkspaceCookie } from '@/lib/active-workspace'")
    expect(switchRouteSource).not.toMatch(/httpOnly|sameSite|maxAge/i)
  })

  it('performs no membership, workspace, subscription, or role mutation anywhere in the file', () => {
    expect(switchRouteSource).not.toMatch(/\.(create|update|upsert|delete|updateMany|deleteMany)\(/)
  })

  it('the list endpoint delegates to the shared listUserWorkspaces() helper rather than querying directly', () => {
    expect(switchRouteSource).toContain('import { listUserWorkspaces } from ')
    expect(switchRouteSource).toContain('await listUserWorkspaces(clerkId)')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-CONTRACT — switcher UI (app/(app)/layout.tsx)
// ─────────────────────────────────────────────────────────────────────────────

describe('switcher UI — single vs multi-workspace rendering (SOURCE-CONTRACT, Stage 2G2)', () => {
  it('the selector only renders once 2+ workspaces are confirmed — never for 0 or 1', () => {
    expect(appLayoutSource).toContain('{workspaces.length > 1 && (')
  })

  it('fetches the workspace list from the shared switch/list endpoint', () => {
    expect(appLayoutSource).toContain("fetch('/api/workspace/active')")
  })

  it('uses a plain native <select> — no new UI/dropdown library introduced', () => {
    expect(appLayoutSource).toMatch(/<select\b/)
    expect(appLayoutSource).not.toMatch(/@radix-ui|headlessui|react-select|downshift/i)
  })

  it('the selector has an accessible label, not color-only context', () => {
    expect(appLayoutSource).toMatch(/htmlFor="workspace-switcher"/)
    expect(appLayoutSource).toMatch(/id="workspace-switcher"/)
  })

  it('never renders the raw workspaceId as visible text — only as key/value attributes', () => {
    expect(appLayoutSource).toContain('key={w.workspaceId}')
    expect(appLayoutSource).toContain('value={w.workspaceId}')
    expect(appLayoutSource).not.toMatch(/>\{w\.workspaceId\}|\{w\.workspaceId\}<\//)
  })

  it('displays workspace name and role as the visible label', () => {
    expect(appLayoutSource).toContain('{w.name} — {ROLE_LABEL[w.role] ?? w.role}')
  })
})

describe('switcher UI — switch call and navigation (SOURCE-CONTRACT, Stage 2G2)', () => {
  it('posts the selected workspaceId to the switch endpoint', () => {
    const switchFnMatch = appLayoutSource.match(/async function switchWorkspace\(workspaceId: string\) \{([\s\S]*?)\n  \}/)
    const body = switchFnMatch?.[1] ?? ''
    expect(switchFnMatch).not.toBeNull()
    expect(body).toContain("fetch('/api/workspace/active'")
    expect(body).toContain("method: 'POST'")
    expect(body).toContain('JSON.stringify({ workspaceId })')
  })

  it('on success, navigates to /dashboard and refreshes server-rendered context', () => {
    const switchFnMatch = appLayoutSource.match(/async function switchWorkspace\(workspaceId: string\) \{([\s\S]*?)\n  \}/)
    const body = switchFnMatch?.[1] ?? ''
    expect(body).toContain("router.push('/dashboard')")
    expect(body).toContain('router.refresh()')
  })

  it('on failure, sets an error and returns before navigating — never pretends success', () => {
    const switchFnMatch = appLayoutSource.match(/async function switchWorkspace\(workspaceId: string\) \{([\s\S]*?)\n  \}/)
    const body = switchFnMatch?.[1] ?? ''
    const errorBranchIdx = body.indexOf('if (!res.ok || data.error)')
    const returnIdx       = body.indexOf('return', errorBranchIdx)
    const pushIdx          = body.indexOf("router.push('/dashboard')")
    expect(errorBranchIdx).toBeGreaterThan(-1)
    expect(returnIdx).toBeGreaterThan(errorBranchIdx)
    expect(returnIdx).toBeLessThan(pushIdx)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-CONTRACT — billing isolation is unaffected (preserved, not widened)
// ─────────────────────────────────────────────────────────────────────────────

describe('billing authorization remains workspace-specific and role-gated (SOURCE-CONTRACT, Stage 2G2 regression)', () => {
  it('checkout still resolves membership through getWorkspaceMembership (the active-workspace-aware resolver) and gates on can.manageBilling', () => {
    expect(checkoutSource).toContain('getWorkspaceMembership(')
    expect(checkoutSource).toContain('can.manageBilling(membership.role)')
  })

  it('billing portal still resolves membership the same way and gates the same way', () => {
    expect(portalSource).toContain('getWorkspaceMembership(')
    expect(portalSource).toContain('can.manageBilling(membership.role)')
  })
})

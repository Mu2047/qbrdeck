import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { markActiveWorkspace } from '@/lib/switcher-state'

// Stage 2G2C — stale active label after a successful workspace switch.
//
// Production: switching Test Growth (Admin) -> Muhammed Camara (Owner)
// succeeded server-side, but the sidebar selector kept showing
// "Test Growth — Admin". The layout fetched its list once and router.refresh()
// does not remount a client layout, so the list was never re-read.
//
// Same convention as tests/workspace-switcher.test.ts:
//  - EXECUTABLE tests run the real lib/switcher-state.ts helper, plus the
//    layout's own activeWorkspaceId derivation on its output.
//  - SOURCE-CONTRACT tests read app/(app)/layout.tsx as text (no component
//    rendering harness exists in this repo).

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const layoutSource = readSourceLF('app/(app)/layout.tsx')
const helperSource = readSourceLF('lib/switcher-state.ts')

type W = { workspaceId: string; name: string; role: string; active: boolean }

const growthAdmin: W = { workspaceId: 'ws_growth', name: 'Test Growth',     role: 'ADMIN', active: true }
const freeOwner:   W = { workspaceId: 'ws_free',   name: 'Muhammed Camara', role: 'OWNER', active: false }
const list = [growthAdmin, freeOwner]

// Exactly how the layout derives the <select> value.
const selectedId = (ws: W[]) => ws.find(w => w.active)?.workspaceId ?? ''

const switchBody = (() => {
  const m = layoutSource.match(/async function switchWorkspace\(workspaceId: string\) \{([\s\S]*?)\n  \}/)
  expect(m).not.toBeNull()
  return m![1]
})()

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTABLE — markActiveWorkspace
// ─────────────────────────────────────────────────────────────────────────────

describe('markActiveWorkspace (EXECUTABLE)', () => {
  it('a successful switch marks the selected workspace active:true', () => {
    const next = markActiveWorkspace(list, 'ws_free')
    expect(next.find(w => w.workspaceId === 'ws_free')!.active).toBe(true)
  })

  it('the previously active workspace becomes active:false', () => {
    const next = markActiveWorkspace(list, 'ws_free')
    expect(next.find(w => w.workspaceId === 'ws_growth')!.active).toBe(false)
  })

  it('exactly one workspace is active afterwards', () => {
    expect(markActiveWorkspace(list, 'ws_free').filter(w => w.active)).toHaveLength(1)
  })

  it('the selector value moves Growth -> Free -> Growth with no stale label', () => {
    expect(selectedId(list)).toBe('ws_growth')
    const afterFirst = markActiveWorkspace(list, 'ws_free')
    expect(selectedId(afterFirst)).toBe('ws_free')
    const afterBack = markActiveWorkspace(afterFirst, 'ws_growth')
    expect(selectedId(afterBack)).toBe('ws_growth')
  })

  it('names and roles are preserved, so the visible label is the new workspace\'s own', () => {
    const active = markActiveWorkspace(list, 'ws_free').find(w => w.active)!
    expect(`${active.name} — ${active.role}`).toBe('Muhammed Camara — OWNER')
  })

  it('an id not in the list leaves the list (and the current selection) unchanged', () => {
    const next = markActiveWorkspace(list, 'ws_unknown')
    expect(next).toBe(list)
    expect(selectedId(next)).toBe('ws_growth')
  })

  it('does not mutate its input', () => {
    const before = JSON.stringify(list)
    markActiveWorkspace(list, 'ws_free')
    expect(JSON.stringify(list)).toBe(before)
  })

  it('the helper is client-safe — no imports at all (lib/workspace.ts pulls in Prisma)', () => {
    expect(helperSource).not.toMatch(/^import\b/m)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-CONTRACT — layout wiring
// ─────────────────────────────────────────────────────────────────────────────

describe('switchWorkspace wiring (SOURCE-CONTRACT)', () => {
  it('imports the helper from the client-safe module, not lib/workspace', () => {
    expect(layoutSource).toContain("import { markActiveWorkspace } from '@/lib/switcher-state'")
    expect(layoutSource).not.toMatch(/from ['"]@\/lib\/workspace['"]/)
  })

  it('on success, updates local state with the switched-to id', () => {
    expect(switchBody).toContain('setWorkspaces(prev => markActiveWorkspace(prev, workspaceId))')
  })

  it('the state update happens only after the failure branch has returned', () => {
    const failReturn = switchBody.indexOf('return', switchBody.indexOf('if (!res.ok || data.error)'))
    const update     = switchBody.indexOf('markActiveWorkspace(')
    expect(failReturn).toBeGreaterThan(-1)
    expect(update).toBeGreaterThan(failReturn)
  })

  it('a failed switch never touches the list — the only update is on the success path', () => {
    expect(switchBody.match(/setWorkspaces\(/g)).toHaveLength(1)
    const catchBlock = switchBody.slice(switchBody.indexOf('} catch {'))
    expect(catchBlock).not.toMatch(/setWorkspaces|markActiveWorkspace/)
  })

  it('re-enables the selector after a successful switch (it was left disabled before)', () => {
    const update = switchBody.indexOf('markActiveWorkspace(')
    const reenable = switchBody.indexOf('setSwitching(false)', update)
    expect(reenable).toBeGreaterThan(update)
  })

  it('router navigation and refresh still run, after the state update', () => {
    const update  = switchBody.indexOf('markActiveWorkspace(')
    const push    = switchBody.indexOf("router.push('/dashboard')")
    const refresh = switchBody.indexOf('router.refresh()', update)
    expect(push).toBeGreaterThan(update)
    expect(refresh).toBeGreaterThan(push)
  })

  it('the <select> is still driven by the active entry in local state', () => {
    expect(layoutSource).toContain('const activeWorkspaceId = workspaces.find(w => w.active)?.workspaceId ?? \'\'')
    expect(layoutSource).toContain('value={activeWorkspaceId}')
  })

  it('single-workspace users are unchanged: the selector still renders only for 2+ workspaces', () => {
    expect(layoutSource).toContain('{workspaces.length > 1 && (')
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { can } from '@/lib/permissions'
import { buildWorkspaceList, selectActiveMembership } from '@/lib/workspace'

// Viewer saved-QBR UI alignment — the saved-QBR detail page must offer only
// what the API routes allow, on the role in the ACTIVE workspace.
//
// PR #44 review: a VIEWER on /dashboard/clients/[id]/qbr/[qbrId] was offered
// Send to Client, Share Link, PDF, PowerPoint, Delete and click-to-edit text,
// although every one of those routes refuses VIEWER.
//
// Same honesty labels as tests/role-ui-permissions.test.ts:
//  - EXECUTABLE: real can.* and active-workspace resolution, per role.
//  - SOURCE-CONTRACT: which JSX each gate wraps, proven by reading the files
//    as text (this repo has no component rendering harness).

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const pageSource  = readSourceLF('app/(app)/dashboard/(gated)/clients/[id]/qbr/[qbrId]/page.tsx')
const qbrRoute    = readSourceLF('app/api/qbrs/[qbrId]/route.ts')
const sendRoute   = readSourceLF('app/api/qbrs/[qbrId]/send/route.ts')
const shareRoute  = readSourceLF('app/api/qbrs/[qbrId]/share/route.ts')
const pdfRoute    = readSourceLF('app/api/export-pdf/route.ts')
const pptxRoute   = readSourceLF('app/api/export-pptx/route.ts')

const ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const
type Role = (typeof ROLES)[number]

// The page's three gates, exactly as the page derives them from the role.
function gatesFor(role: Role | null) {
  return {
    canEditQBR:   role !== null && can.generateQBR(role),
    canExportQBR: role !== null && can.exportQBR(role),
    canDeleteQBR: role !== null && can.deleteQBR(role),
    canViewQBR:   role !== null && can.viewQBR(role),
  }
}

// Text between `{<gate> && (` and its matching `)}` at the same indentation.
function gatedBlock(gate: string): string {
  const m = pageSource.match(new RegExp(`\\n( *)\\{${gate} && \\(\\n([\\s\\S]*?)\\n\\1\\)\\}`))
  expect(m, `{${gate} && ( block not found`).not.toBeNull()
  return m![2]
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTABLE — backend QBR policy the UI follows
// ─────────────────────────────────────────────────────────────────────────────

describe('saved-QBR permission matrix (EXECUTABLE — real lib/permissions.ts)', () => {
  const expected: Record<Role, ReturnType<typeof gatesFor>> = {
    OWNER:  { canViewQBR: true, canEditQBR: true,  canExportQBR: true,  canDeleteQBR: true  },
    ADMIN:  { canViewQBR: true, canEditQBR: true,  canExportQBR: true,  canDeleteQBR: true  },
    MEMBER: { canViewQBR: true, canEditQBR: true,  canExportQBR: true,  canDeleteQBR: true  },
    VIEWER: { canViewQBR: true, canEditQBR: false, canExportQBR: false, canDeleteQBR: false },
  }

  for (const role of ROLES) {
    it(`${role}: ${role === 'VIEWER' ? 'view only' : 'view, edit, send/share/PDF/PowerPoint, delete'}`, () => {
      expect(gatesFor(role)).toEqual(expected[role])
    })
  }

  it('unknown role (loading / failed) fails closed: no edit, export or delete', () => {
    const g = gatesFor(null)
    expect([g.canEditQBR, g.canExportQBR, g.canDeleteQBR]).toEqual([false, false, false])
  })
})

describe('active-workspace role drives the saved-QBR UI (EXECUTABLE)', () => {
  const memberships = [
    { workspaceId: 'ws_a', role: 'OWNER'  as const, workspace: { name: 'Owned Co' } },
    { workspaceId: 'ws_b', role: 'VIEWER' as const, workspace: { name: 'Client Co' } },
  ]
  // Mirrors useActiveRole: the entry of GET /api/workspace/active flagged active.
  const activeRole = (activeId: string) =>
    buildWorkspaceList(memberships, activeId).find(w => w.active)!.role as Role

  it('A active → Owner controls', () => {
    expect(gatesFor(activeRole('ws_a'))).toEqual({ canViewQBR: true, canEditQBR: true, canExportQBR: true, canDeleteQBR: true })
  })

  it('B active → Viewer read-only, no bleed from the Owner membership', () => {
    expect(gatesFor(activeRole('ws_b'))).toEqual({ canViewQBR: true, canEditQBR: false, canExportQBR: false, canDeleteQBR: false })
  })

  it('server routes resolve the same membership for the same cookie', () => {
    expect(selectActiveMembership(memberships, 'ws_a')!.role).toBe(activeRole('ws_a'))
    expect(selectActiveMembership(memberships, 'ws_b')!.role).toBe(activeRole('ws_b'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-CONTRACT — backend routes (unchanged) stay server-protected
// ─────────────────────────────────────────────────────────────────────────────

describe('QBR routes enforce the checks the page mirrors (SOURCE-CONTRACT)', () => {
  it('GET view: viewQBR; PATCH edit: generateQBR; DELETE: deleteQBR', () => {
    const get    = qbrRoute.slice(qbrRoute.indexOf('export async function GET'),    qbrRoute.indexOf('export async function PATCH'))
    const patch  = qbrRoute.slice(qbrRoute.indexOf('export async function PATCH'),  qbrRoute.indexOf('export async function DELETE'))
    const del    = qbrRoute.slice(qbrRoute.indexOf('export async function DELETE'))
    expect(get).toContain('if (!can.viewQBR(membership.role))')
    expect(patch).toContain('if (!can.generateQBR(membership.role))')
    expect(del).toContain('if (!can.deleteQBR(membership.role))')
  })

  it('send, share (create and revoke), PDF and PowerPoint: exportQBR', () => {
    expect(sendRoute).toContain('if (!can.exportQBR(membership.role))')
    expect(shareRoute.match(/if \(!can\.exportQBR\(membership\.role\)\)/g)).toHaveLength(2)
    expect(pdfRoute).toContain('if (!can.exportQBR(membership.role))')
    expect(pptxRoute).toContain('if (!can.exportQBR(membership.role))')
  })

  it('every refusal is a 403', () => {
    for (const src of [qbrRoute, sendRoute, shareRoute, pdfRoute, pptxRoute]) {
      expect(src).toMatch(/can\.\w+\(membership\.role\)\)\n\s*return NextResponse\.json\(\{ error: 'Forbidden' \}, \{ status: 403 \}\)/)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-CONTRACT — saved-QBR page gates
// ─────────────────────────────────────────────────────────────────────────────

describe('saved-QBR page derives gates from can.* on useActiveRole()', () => {
  it('uses the same helpers as the routes, failing closed while the role is unknown', () => {
    expect(pageSource).toContain("import { can } from '@/lib/permissions'")
    expect(pageSource).toContain("import { useActiveRole } from '@/lib/use-active-role'")
    expect(pageSource).toContain('const role         = useActiveRole()')
    expect(pageSource).toContain('const canEditQBR   = role !== null && can.generateQBR(role)')
    expect(pageSource).toContain('const canExportQBR = role !== null && can.exportQBR(role)')
    expect(pageSource).toContain('const canDeleteQBR = role !== null && can.deleteQBR(role)')
  })

  it('no hard-coded role comparisons', () => {
    expect(pageSource).not.toMatch(/role\s*===\s*'/)
  })
})

describe('Viewer: no Send, Share, PDF or PowerPoint (exportQBR gate)', () => {
  const exportBar = () => gatedBlock('canExportQBR')

  it('the whole export bar sits inside {canExportQBR && (', () => {
    const bar = exportBar()
    expect(bar).toContain('Export this QBR to share with your client.')
    expect(bar).toContain('<Mail size={14} /> Send to Client')
    expect(bar).toContain('aria-label="Share Link"')
    expect(bar).toContain("onClick={() => exportFile('pdf')}")
    expect(bar).toContain("onClick={() => exportFile('pptx')}")
  })

  it('those controls exist nowhere else on the page', () => {
    expect(pageSource.match(/Send to Client<\/button>|> Send to Client\n/g) ?? []).toHaveLength(1)
    expect(pageSource.match(/aria-label="Share Link"/g)).toHaveLength(1)
    expect(pageSource.match(/exportFile\('pdf'\)/g)).toHaveLength(1)
    expect(pageSource.match(/exportFile\('pptx'\)/g)).toHaveLength(1)
    expect(pageSource.match(/onClick=\{shareQBR\}/g)).toHaveLength(1)
    expect(pageSource.match(/setShowEmailInput\(v => !v\)/g)).toHaveLength(1)
  })
})

describe('Viewer: no Delete (deleteQBR gate)', () => {
  it('the danger zone, trigger and confirmation sit inside {canDeleteQBR && (', () => {
    const zone = gatedBlock('canDeleteQBR')
    expect(zone).toContain('<Trash2 size={12} /> Delete this QBR')
    expect(zone).toContain('onClick={deleteQbr}')
    expect(zone).toContain('setConfirmingDelete(true)')
  })

  it('setConfirmingDelete(true) and deleteQbr are reachable only from that block', () => {
    expect(pageSource.match(/setConfirmingDelete\(true\)/g)).toHaveLength(1)
    expect(pageSource.match(/onClick=\{deleteQbr\}/g)).toHaveLength(1)
  })
})

describe('Viewer: content is read-only (generateQBR gate, same as PATCH)', () => {
  it('"Click any text to edit" hint is inside {canEditQBR && (', () => {
    expect(gatedBlock('canEditQBR')).toContain('Click any text to edit. Changes save automatically.')
    expect(pageSource.match(/Click any text to edit/g)).toHaveLength(1)
  })

  it('every slide (and so every EditableText) renders inside the canEditQBR context provider', () => {
    expect(pageSource).toContain('const CanEditQBRContext = createContext(false)')
    const open  = pageSource.indexOf('<CanEditQBRContext.Provider value={canEditQBR}>')
    const close = pageSource.indexOf('</CanEditQBRContext.Provider>')
    expect(open).toBeGreaterThan(-1)
    const inside = pageSource.slice(open, close)
    expect(inside).toContain('{resolvedSlides.map((slide: any, i: number) => (')
    const allUses    = pageSource.match(/<EditableText\b/g)!.length
    const insideUses = inside.match(/<EditableText\b/g)!.length
    expect(insideUses).toBe(allUses)
  })

  it('EditableText renders plain text with no click-to-edit affordance when the context says no', () => {
    const comp = pageSource.slice(pageSource.indexOf('function EditableText('))
    expect(comp).toContain('const canEdit = useContext(CanEditQBRContext)')
    const guard = comp.indexOf('if (!canEdit) return <span className={className}>{value}</span>')
    expect(guard).toBeGreaterThan(-1)
    // The read-only return comes before both the editing input and the
    // click-to-edit span, and after every hook (rules of hooks).
    expect(guard).toBeLessThan(comp.indexOf('if (editing) {'))
    expect(guard).toBeLessThan(comp.indexOf('title="Click to edit"'))
    expect(guard).toBeGreaterThan(comp.indexOf('useEffect('))
  })

  it('the metric status select (which also PATCHes) is shown only to editors; others see the label', () => {
    expect(pageSource).toMatch(/\) : canEditQBR \? \(\s*<select\s+value=\{m\.status\}/)
    expect(pageSource).toContain('{statusLabel(m.status)}')
    expect(pageSource.match(/<select\b/g)).toHaveLength(1)
  })
})

describe('Viewer can still read the saved QBR', () => {
  it('cover, health score, slide titles and Back link are not gated', () => {
    const ungated = pageSource
      .replace(gatedBlock('canExportQBR'), '')
      .replace(gatedBlock('canDeleteQBR'), '')
    expect(ungated).toContain('<ArrowLeft size={14} /> Back')
    expect(ungated).toContain('{qbr.client.name}')
    expect(ungated).toContain("{qbr.healthScore != null ? qbr.healthScore : 'N/A'}")
    expect(ungated).toContain('{qbr.healthStatus ?? \'Not assessed\'}')
    expect(ungated).toContain('<p className="text-white text-sm font-medium">{slide.title}</p>')
    // Slides are inside the context provider, never behind a {canEditQBR && ( gate.
    expect(pageSource).toMatch(/<CanEditQBRContext\.Provider value=\{canEditQBR\}>\n\s*\{resolvedSlides\.map/)
  })

  it('the QBR is still loaded for every role (GET is viewQBR, VIEWER+)', () => {
    expect(pageSource).toContain('fetch(`/api/qbrs/${params.qbrId}`)')
    expect(can.viewQBR('VIEWER')).toBe(true)
  })
})

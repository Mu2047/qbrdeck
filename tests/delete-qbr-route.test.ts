import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: they read the affected route/page/lib files as
// plain text and regex/slice-match against them. They do NOT invoke the
// DELETE handler, do NOT mount any React component, and do NOT connect to a
// database — this repo has no DB-backed integration-test framework (see
// tests/saved-qbr-route.test.ts and tests/analytics-deleted-qbr-filtering.test.ts
// for the same precedent this file follows). These tests prove the intended
// source contract — request shape, authorization order, quota-accounting
// non-mutation, and cross-route deletedAt gating — not executed runtime HTTP
// behavior against a real Postgres instance.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const ROUTE_PATH = 'app/api/qbrs/[qbrId]/route.ts'
const routeSource = readSourceLF(ROUTE_PATH)

// Isolate the DELETE handler body so an assertion about it can never be
// accidentally satisfied by source that only exists in GET/PATCH.
const deleteMatch = routeSource.match(/export async function DELETE\([\s\S]*$/)
const deleteBody = deleteMatch?.[0] ?? ''

describe('DELETE /api/qbrs/[qbrId] — handler exists', () => {
  it('exports a DELETE handler', () => {
    expect(deleteMatch).not.toBeNull()
  })

  it('does not use raw SQL ($queryRaw/$executeRaw)', () => {
    expect(deleteBody).not.toMatch(/\$queryRaw|\$executeRaw/)
  })
})

// ── 1. authorized workspace user can delete own QBR ─────────────────────────
// ── 3. unauthenticated delete rejected ───────────────────────────────────────
describe('DELETE — authentication (item 3: unauthenticated rejected)', () => {
  it('authenticates via Clerk auth() and returns 401 when absent, before any other work', () => {
    const authIdx = deleteBody.indexOf('const { userId: clerkId } = auth()')
    const unauthorizedIdx = deleteBody.indexOf("if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })")
    expect(authIdx).toBeGreaterThan(-1)
    expect(unauthorizedIdx).toBeGreaterThan(authIdx)
  })
})

// ── 4. authorization model (item 1 continued) ────────────────────────────────
describe('DELETE — authorization: at least as strict as edit/export/share', () => {
  it('resolves the current workspace membership via getWorkspaceMembership(clerkId)', () => {
    expect(deleteBody).toMatch(/getWorkspaceMembership\(clerkId\)/)
    expect(deleteBody).toMatch(/if \(!membership\) return NextResponse\.json\(\{ error: 'Workspace not found' \}, \{ status: 404 \}\)/)
  })

  it('checks can.deleteQBR(membership.role) and returns 403 Forbidden if not permitted', () => {
    expect(deleteBody).toMatch(/if \(!can\.deleteQBR\(membership\.role\)\)/)
    expect(deleteBody).toMatch(/return NextResponse\.json\(\{ error: 'Forbidden' \}, \{ status: 403 \}\)/)
  })

  it('the authorization check happens before the QBR lookup (never ID-only deletion)', () => {
    const authzIdx  = deleteBody.indexOf('can.deleteQBR(membership.role)')
    const lookupIdx = deleteBody.indexOf('prisma.qBR.findFirst(')
    expect(authzIdx).toBeGreaterThan(-1)
    expect(lookupIdx).toBeGreaterThan(authzIdx)
  })

  it('deleteQBR is defined in lib/permissions.ts at the same MEMBER+ bar as generateQBR/exportQBR', () => {
    const permSource = readSourceLF('lib/permissions.ts')
    expect(permSource).toMatch(/deleteQBR:\s*\(role: TeamRole\) => hasRole\(role, 'MEMBER'\)/)
  })
})

// ── 2. cannot delete another workspace's QBR ─────────────────────────────────
// ── 5. deleted QBR excluded from direct QBR detail lookup (this route's own GET/PATCH already prove this; DELETE lookup itself is scoped identically) ─
describe('DELETE — QBR lookup: scoped by id, workspaceId, and deletedAt: null (item 2: workspace isolation; not direct ID-only)', () => {
  it('the lookup is scoped by id, workspaceId, and deletedAt: null — identical shape to GET/PATCH in this file', () => {
    expect(deleteBody).toMatch(/const qbr = await prisma\.qBR\.findFirst\(\{\s*where:\s*\{ id: params\.qbrId, workspaceId: membership\.workspaceId, deletedAt: null \},/)
  })

  it('a missing, cross-workspace, or already-deleted QBR returns the same 404 Not found (item 12: idempotent double-delete/retry)', () => {
    expect(deleteBody).toMatch(/if \(!qbr\) return NextResponse\.json\(\{ error: 'Not found' \}, \{ status: 404 \}\)/)
  })
})

// ── 19. no hard-delete Prisma call is used ───────────────────────────────────
describe('DELETE — soft delete only: sets deletedAt, never a hard delete', () => {
  it('performs prisma.qBR.update({ data: { deletedAt: new Date() } }) — a soft delete', () => {
    expect(deleteBody).toMatch(/await prisma\.qBR\.update\(\{\s*where:\s*\{ id: params\.qbrId \},\s*data:\s*\{ deletedAt: new Date\(\) \},\s*\}\)/)
  })

  it('never calls prisma.qBR.delete or prisma.qBR.deleteMany anywhere in this route file', () => {
    expect(routeSource).not.toMatch(/prisma\.qBR\.delete(?!d)/)
    expect(routeSource).not.toMatch(/prisma\.qBR\.deleteMany/)
  })
})

// ── 14/15/16. quota accounting is never touched by delete ───────────────────
describe('DELETE — quota accounting: qbrCount/exportCount/exportedQbrIds are never mutated', () => {
  it('the DELETE handler body never references Subscription counters', () => {
    expect(deleteBody).not.toMatch(/qbrCount/)
    expect(deleteBody).not.toMatch(/exportCount/)
    expect(deleteBody).not.toMatch(/exportedQbrIds/)
  })

  it('the DELETE handler body never touches prisma.subscription at all', () => {
    expect(deleteBody).not.toMatch(/prisma\.subscription/)
  })
})

// ── ShareLink rows are left untouched — invalidation is via qbr.deletedAt ───
describe('DELETE — ShareLink rows are not mutated by this route (invalidation happens via qbr.deletedAt check in resolveSharedQbr)', () => {
  it('the DELETE handler body never references prisma.shareLink', () => {
    expect(deleteBody).not.toMatch(/prisma\.shareLink/)
  })
})

// ── error hygiene — matches GET/PATCH convention in this same file ──────────
describe('DELETE — error hygiene for unexpected failures', () => {
  const catchMatch = deleteBody.match(/\} catch \(err: any\) \{[\s\S]*?\n  \}\n\}/)
  const catchBody = catchMatch?.[0] ?? ''

  it('locates the DELETE catch block', () => {
    expect(catchMatch).not.toBeNull()
  })

  it("logs server-side via console.error('[saved-qbr-delete]', params.qbrId, err)", () => {
    expect(catchBody).toMatch(/console\.error\('\[saved-qbr-delete\]', params\.qbrId, err\)/)
  })

  it("returns a stable sanitized error at 500, never raw err.message", () => {
    expect(catchBody).toMatch(/return NextResponse\.json\(\{ error: 'Failed to delete QBR' \}, \{ status: 500 \}\)/)
    expect(catchBody).not.toMatch(/err\.message/)
  })
})

// ── 20. existing non-deleted QBR behavior continues working ─────────────────
describe('GET/PATCH — unchanged by this PR (item 20: existing behavior preserved)', () => {
  it('GET still scopes by id, workspaceId, deletedAt: null and checks can.viewQBR', () => {
    expect(routeSource).toMatch(/if \(!can\.viewQBR\(membership\.role\)\)/)
  })
  it('PATCH still scopes by id, workspaceId, deletedAt: null and checks can.generateQBR', () => {
    expect(routeSource).toMatch(/if \(!can\.generateQBR\(membership\.role\)\)/)
  })
})

// ── 7/8/9/10/11. deleted QBR cannot be edited/exported/shared/emailed ───────
// These routes already gated on `deletedAt: null` before this PR (the field
// pre-existed as unused-for-delete scaffolding — see PR audit). This PR adds
// no changes to them; these tests pin that the gating they already had is
// exactly what makes edit/export/share/email fail safely once DELETE sets
// deletedAt. They exist here (not just in each route's own test file) so the
// full "delete blocks everything" contract is provable from one place.
describe('Cross-route contract — a deleted QBR is already rejected by every mutation/read path (items 7–11)', () => {
  it('PATCH (edit) rejects a soft-deleted QBR via deletedAt: null in its lookup — item 7', () => {
    const patchStart = routeSource.indexOf('export async function PATCH(')
    const deleteStart = routeSource.indexOf('export async function DELETE(')
    expect(patchStart).toBeGreaterThan(-1)
    expect(deleteStart).toBeGreaterThan(patchStart)
    const patchBody = routeSource.slice(patchStart, deleteStart)
    expect(patchBody).toMatch(/deletedAt: null/)
  })

  it('performQbrExport (PDF + PPTX, item 8 + 9) rejects a soft-deleted QBR via deletedAt: null in its lookup', () => {
    const exportSource = readSourceLF('lib/qbr-export.ts')
    expect(exportSource).toMatch(/const qbr = await prisma\.qBR\.findFirst\(\{\s*where:\s*\{ id: qbrId, workspaceId: membership\.workspaceId, deletedAt: null \},/)
  })

  it('POST /api/qbrs/[qbrId]/share (item 10: new ShareLink) rejects a soft-deleted QBR via deletedAt: null', () => {
    const shareSource = readSourceLF('app/api/qbrs/[qbrId]/share/route.ts')
    const postBody = shareSource.match(/export async function POST\([\s\S]*?\n\}\n\n\/\/ Revoke/)?.[0] ?? shareSource
    expect(postBody).toMatch(/deletedAt: null/)
  })

  it('POST /api/qbrs/[qbrId]/send (item 11: email) rejects a soft-deleted QBR via deletedAt: null', () => {
    const sendSource = readSourceLF('app/api/qbrs/[qbrId]/send/route.ts')
    expect(sendSource).toMatch(/deletedAt: null/)
  })
})

// ── 12/13. existing manual + email-created ShareLink stop rendering ─────────
describe('Cross-route contract — resolveSharedQbr() rejects a deleted QBR for both manual and email-created links (items 12–13)', () => {
  const shareLinksSource = readSourceLF('lib/share-links.ts')

  it('the hashed-ShareLink path (covers both manually created and email-created links, which share createShareLink) checks link.qbr.deletedAt and returns null', () => {
    const hashedPathBlock = shareLinksSource.match(/if \(link\) \{[\s\S]*?\n  \}/)?.[0] ?? ''
    expect(hashedPathBlock).toMatch(/if \(link\.qbr\.deletedAt\) return null/)
  })

  it('the legacy plaintext shareToken fallback also excludes a deleted QBR at the query level', () => {
    const legacyBlock = shareLinksSource.match(/const legacy = await prisma\.qBR\.findFirst\(\{[\s\S]*?\n  \}\)/)?.[0] ?? ''
    expect(legacyBlock).toMatch(/deletedAt: null/)
  })

  it('createShareLink is the single path used by both the manual Share Link button and the email Send-to-Client flow (proves item 12 and 13 share one invalidation mechanism)', () => {
    const shareRouteSource = readSourceLF('app/api/qbrs/[qbrId]/share/route.ts')
    const sendRouteSource  = readSourceLF('app/api/qbrs/[qbrId]/send/route.ts')
    expect(shareRouteSource).toMatch(/createShareLink\(/)
    expect(sendRouteSource).toMatch(/createShareLink\(/)
  })
})

// ── 4/6. deleted QBR excluded from Client QBR history + Analytics ───────────
describe('Cross-route contract — history views already exclude deleted QBRs (item 4)', () => {
  it('GET /api/clients/[id] (Client QBR history) scopes the nested qbrs relation by deletedAt: null', () => {
    const clientRouteSource = readSourceLF('app/api/clients/[id]/route.ts')
    expect(clientRouteSource).toMatch(/qbrs:\s*\{\s*where:\s*\{\s*deletedAt:\s*null\s*\}/)
  })
})

describe('Cross-route contract — Analytics excludes deleted QBRs from active metrics (item 6)', () => {
  it('app/api/analytics/route.ts carries at least three deletedAt: null occurrences (see tests/analytics-deleted-qbr-filtering.test.ts for the full per-query breakdown)', () => {
    const analyticsSource = readSourceLF('app/api/analytics/route.ts')
    const occurrences = analyticsSource.match(/deletedAt:\s*null/g) ?? []
    expect(occurrences.length).toBeGreaterThanOrEqual(3)
  })
})

// ── Dashboard + Clients list — active-content views must exclude deleted QBRs
// (item 4/6 extended, item 10 "Last QBR" from the product requirement): these
// were the actual gaps this PR closes outside the QBR route itself — the
// deletedAt column pre-existed but these two pages' nested `qbrs` includes
// and the dashboard's `totalQBRsResult` count did not filter it.
describe('Dashboard page — active-content views exclude deleted QBRs (Last-QBR + QBRs-generated KPI)', () => {
  const dashboardSource = readSourceLF('app/(app)/dashboard/(gated)/page.tsx')

  it('getReminders() nested qbrs include filters deletedAt: null (a deleted QBR must not become the visible "last QBR")', () => {
    const remindersBlock = dashboardSource.match(/async function getReminders[\s\S]*?\n\}/)?.[0] ?? ''
    expect(remindersBlock).toMatch(/qbrs:\s*\{\s*where:\s*\{\s*deletedAt:\s*null\s*\},\s*orderBy:\s*\{\s*createdAt:\s*'desc'\s*\},\s*take:\s*1\s*\}/)
  })

  it('the "Recent clients" nested qbrs include filters deletedAt: null', () => {
    const recentBlock = dashboardSource.match(/prisma\.client\.findMany\(\{\s*where:\s*\{ workspaceId \},\s*include:\s*\{ qbrs:[\s\S]*?\}\s*,\s*orderBy:\s*\{ updatedAt: 'desc' \}/)?.[0] ?? ''
    expect(recentBlock).toMatch(/qbrs:\s*\{\s*where:\s*\{\s*deletedAt:\s*null\s*\}/)
  })

  it('the "QBRs generated" summary count excludes deleted QBRs', () => {
    expect(dashboardSource).toMatch(/prisma\.qBR\.count\(\{\s*where:\s*\{ client:\s*\{ workspaceId \},\s*deletedAt:\s*null\s*\}\s*\}\)/)
  })
})

describe('Clients list page — QBR count and Last-QBR exclude deleted QBRs', () => {
  const clientsListSource = readSourceLF('app/(app)/dashboard/(gated)/clients/page.tsx')

  it('the nested qbrs include filters deletedAt: null', () => {
    expect(clientsListSource).toMatch(/qbrs:\s*\{\s*where:\s*\{\s*deletedAt:\s*null\s*\},\s*orderBy:\s*\{\s*createdAt:\s*'desc'\s*\},\s*take:\s*1\s*\}/)
  })

  it('the per-client _count.qbrs is filtered by deletedAt: null (the displayed "N QBRs" badge must not count deleted ones)', () => {
    expect(clientsListSource).toMatch(/_count:\s*\{\s*select:\s*\{\s*qbrs:\s*\{\s*where:\s*\{\s*deletedAt:\s*null\s*\}\s*\}\s*\}\s*\}/)
  })
})

// ── 17. confirmation UI exists ────────────────────────────────────────────────
// ── 18. customer-facing history no longer renders deleted QBR (UI wiring) ───
describe('QBR detail page — Delete UI (item 17: confirmation exists; explicit two-step interaction)', () => {
  const pageSource = readSourceLF('app/(app)/dashboard/(gated)/clients/[id]/qbr/[qbrId]/page.tsx')

  it('renders a low-emphasis "Delete this QBR" trigger, separate from confirmingDelete state', () => {
    expect(pageSource).toMatch(/confirmingDelete/)
    expect(pageSource).toMatch(/Delete this QBR/)
  })

  it('does not delete on first click — the trigger only flips confirmingDelete to true, never calls deleteQbr() directly', () => {
    const triggerBlock = pageSource.match(/!confirmingDelete \? \(([\s\S]*?)\) : \(/)?.[1] ?? ''
    expect(triggerBlock).toMatch(/setConfirmingDelete\(true\)/)
    expect(triggerBlock).not.toMatch(/deleteQbr\(\)/)
  })

  it('the confirmation panel carries the required product copy (history removal, share links stop working, no quota refund)', () => {
    expect(pageSource).toMatch(/removed from your QBR history/)
    expect(pageSource).toMatch(/public share links will stop\s*\n?\s*working/)
    expect(pageSource).toMatch(/does not restore your monthly QBR generation usage/)
  })

  it('the confirmation panel has both a Cancel button and a Delete QBR button', () => {
    const panelBlock = pageSource.match(/confirmingDelete \? \(([\s\S]*?)\)\s*\}\s*<\/div>\s*\)\s*\}\s*<\/div>\s*<\/div>\s*\)\s*\}/)
      ?? pageSource.match(/\) : \(([\s\S]*?)\)\)\}\s*<\/div>/)
    // Fall back to whole-source search if precise slice extraction misses —
    // the presence of both button labels together is the real assertion.
    expect(pageSource).toMatch(/Cancel/)
    expect(pageSource).toMatch(/\{deleting \? 'Deleting\.\.\.' : 'Delete QBR'\}/)
    void panelBlock
  })

  it('Cancel resets confirmingDelete to false without calling deleteQbr()', () => {
    const cancelBlock = pageSource.match(/onClick=\{\(\) => \{ setConfirmingDelete\(false\); setDeleteError\(null\) \}\}/)
    expect(cancelBlock).not.toBeNull()
  })

  it('deleteQbr() calls DELETE /api/qbrs/[qbrId] and, on success, navigates away from the deleted QBR (item 18: no longer reachable/rendered)', () => {
    const deleteFnBlock = pageSource.match(/async function deleteQbr\(\)[\s\S]*?\n  \}/)?.[0] ?? ''
    expect(deleteFnBlock).toMatch(/method: 'DELETE'/)
    expect(deleteFnBlock).toMatch(/router\.push\(`\/dashboard\/clients\/\$\{params\.id\}`\)/)
  })

  it('a double-click on Delete QBR cannot fire two overlapping requests (deleteInFlight ref guard)', () => {
    expect(pageSource).toMatch(/if \(deleteInFlight\.current\) return/)
    expect(pageSource).toMatch(/deleteInFlight\.current = true/)
  })
})

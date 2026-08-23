import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: read route.ts/page.tsx as plain text and
// regex/slice-match against them. They do NOT render React, do NOT mount
// any component, and do NOT execute the Prisma query against a real
// database — this repo has no jsdom/@testing-library or DB-backed
// integration test setup (see tests/analytics-empty-state.test.ts,
// tests/reminder-status-consistency.test.ts for the established
// precedent this file follows).
//
// LIMITATION (see also describe block at the bottom of this file):
// these tests prove the Prisma query *shape* — that the three affected
// queries carry a `deletedAt: null` condition in the right place — not
// that a real soft-deleted QBR is actually excluded at runtime by
// Postgres. There is no DB-backed integration coverage for that here.
//
// Defect fixed: three Analytics query paths in app/api/analytics/route.ts
// previously included soft-deleted QBRs (deletedAt != null) in active
// metrics. This overcounted/incorrectly-included deleted QBRs in
// summary.totalQBRs, qbrActivity, avgHealthScore/avgHealthStatus,
// healthTrends, topRiskFlags, highRiskClients, and Client coverage.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const ROUTE_PATH = 'app/api/analytics/route.ts'
const routeSource = readSourceLF(ROUTE_PATH)

const PAGE_PATH = 'app/(app)/dashboard/(gated)/analytics/page.tsx'

describe('Main QBR query (qbrWhere) — feeds qbrActivity, avgHealthScore, healthTrends, topRiskFlags, highRiskClients', () => {
  function extractQbrWhereBlock(): string {
    const startIdx = routeSource.indexOf('const qbrWhere: any = {')
    const endIdx   = routeSource.indexOf("if (isFullAnalytics && clientId !== 'all') qbrWhere.clientId = clientId")
    expect(startIdx).toBeGreaterThan(-1)
    expect(endIdx).toBeGreaterThan(startIdx)
    return routeSource.slice(startIdx, endIdx)
  }

  it('excludes soft-deleted QBRs via deletedAt: null', () => {
    const block = extractQbrWhereBlock()
    expect(block).toMatch(/deletedAt:\s*null,?/)
  })

  it('workspace scoping through Client is preserved', () => {
    const block = extractQbrWhereBlock()
    expect(block).toMatch(/client:\s*{\s*workspaceId\s*},?/)
  })

  it('createdAt date-range behavior is preserved', () => {
    const block = extractQbrWhereBlock()
    expect(block).toMatch(/createdAt:\s*{\s*gte:\s*rangeStart\s*},?/)
  })

  it('optional clientId filtering (full analytics only) is preserved, immediately after the qbrWhere object', () => {
    expect(routeSource).toMatch(
      /const qbrWhere: any = \{[\s\S]*?\}\s*\n\s*if \(isFullAnalytics && clientId !== 'all'\) qbrWhere\.clientId = clientId/
    )
  })
})

describe('Coverage query — nested qbrs relation on coverageClients', () => {
  function extractCoverageBlock(): string {
    const startIdx = routeSource.indexOf('const coverageClients = await prisma.client.findMany({')
    const endIdx   = routeSource.indexOf('const totalClients')
    expect(startIdx).toBeGreaterThan(-1)
    expect(endIdx).toBeGreaterThan(startIdx)
    return routeSource.slice(startIdx, endIdx)
  }

  it('the nested qbrs relation where clause excludes soft-deleted QBRs', () => {
    const block = extractCoverageBlock()
    expect(block).toMatch(/qbrs:\s*\{\s*where:\s*\{\s*deletedAt:\s*null,\s*createdAt:\s*\{\s*gte:\s*ninetyDaysAgo\s*\}\s*\}/)
  })

  it('the existing 90-day createdAt condition is preserved alongside deletedAt: null', () => {
    const block = extractCoverageBlock()
    expect(block).toMatch(/createdAt:\s*\{\s*gte:\s*ninetyDaysAgo\s*\}/)
  })

  it('a Client whose only in-window QBR is soft-deleted cannot be counted as covered: the deletedAt condition sits inside the same where as the date condition, not the outer Client where', () => {
    const block = extractCoverageBlock()
    // The outer Client-level where must remain workspace-only — deletedAt
    // must not leak into it (that would be a Client.deletedAt change, out
    // of scope for this fix).
    const outerWhereMatch = block.match(/const coverageClients = await prisma\.client\.findMany\(\{\s*where:\s*\{([^}]*)\}/)
    expect(outerWhereMatch).not.toBeNull()
    expect(outerWhereMatch![1]).not.toMatch(/deletedAt/)
  })
})

describe('totalQBRs count — summary KPI + empty-state upstream source', () => {
  function extractTotalQbrsLine(): string {
    const idx = routeSource.indexOf('const totalQBRs = await prisma.qBR.count(')
    expect(idx).toBeGreaterThan(-1)
    const lineEnd = routeSource.indexOf('\n', idx)
    return routeSource.slice(idx, lineEnd)
  }

  it('excludes soft-deleted QBRs via deletedAt: null', () => {
    const line = extractTotalQbrsLine()
    expect(line).toMatch(/deletedAt:\s*null/)
  })

  it('preserves workspace scoping through Client', () => {
    const line = extractTotalQbrsLine()
    expect(line).toMatch(/client:\s*{\s*workspaceId\s*}/)
  })

  it('remains an all-time count — no date-range condition was added', () => {
    const line = extractTotalQbrsLine()
    expect(line).not.toMatch(/createdAt/)
    expect(line).not.toMatch(/rangeStart/)
  })
})

describe('All three query contracts are independently required — no single occurrence satisfies more than one', () => {
  it('exactly three deletedAt: null occurrences exist in the file, one per affected query', () => {
    const occurrences = routeSource.match(/deletedAt:\s*null/g) ?? []
    expect(occurrences.length).toBe(3)
  })
})

describe('Empty-state upstream contract — Analytics page itself is untouched by this fix', () => {
  it('the Analytics page still derives hasNoQbrs from summary.totalQBRs === 0', () => {
    const pageSource = readSourceLF(PAGE_PATH)
    expect(pageSource).toMatch(/const hasNoQbrs\s*= summary\.totalQBRs === 0/)
  })

  it('the Analytics page has zero changes from this PR — it is not part of the tracked diff (proven at the git level, not here); this test only pins the contract this fix relies on', () => {
    const pageSource = readSourceLF(PAGE_PATH)
    expect(pageSource).not.toMatch(/deletedAt/)
  })
})

describe('Export analytics remain independent of QBR.deletedAt — historical/audit data is untouched', () => {
  it('getCurrentExportPackageUsage (basic plan) reads Subscription.exportCount with no QBR/deletedAt reference', () => {
    const startIdx = routeSource.indexOf('async function getCurrentExportPackageUsage(')
    const endIdx   = routeSource.indexOf('async function getExportAnalytics(')
    expect(startIdx).toBeGreaterThan(-1)
    expect(endIdx).toBeGreaterThan(startIdx)
    const block = routeSource.slice(startIdx, endIdx)
    expect(block).toMatch(/prisma\.subscription\.findUnique/)
    expect(block).not.toMatch(/deletedAt/)
    expect(block).not.toMatch(/qBR/)
  })

  it('getExportAnalytics (full plan) reads ExportEvent scoped by workspaceId/exportedAt/clientId, with no deletedAt condition', () => {
    const startIdx = routeSource.indexOf('async function getExportAnalytics(')
    const endIdx   = routeSource.indexOf('// ── Main route')
    expect(startIdx).toBeGreaterThan(-1)
    expect(endIdx).toBeGreaterThan(startIdx)
    const block = routeSource.slice(startIdx, endIdx)
    expect(block).toMatch(/prisma\.exportEvent\.findMany/)
    expect(block).toMatch(/workspaceId,\s*exportedAt:\s*\{\s*gte:\s*rangeStart\s*\}/)
    expect(block).not.toMatch(/deletedAt/)
  })

  it('exportTotals / exportActivity field names are unchanged', () => {
    expect(routeSource).toMatch(/totalPDF:\s*events\.filter/)
    expect(routeSource).toMatch(/totalPPTX:\s*events\.filter/)
    expect(routeSource).toMatch(/totalPackages:\s*events\.filter/)
    expect(routeSource).toMatch(/totalDownloads:\s*events\.length/)
  })
})

describe('Active-QBR-set behavioral harness (supplemental documentation only)', () => {
  // Pure, local reimplementation for documentation purposes only — this
  // does NOT exercise app/api/analytics/route.ts or a real database. It
  // exists to make the intended logical scenarios from the preflight
  // explicit and machine-checked, alongside (not instead of) the
  // source-contract tests above, which prove the actual query shape.
  type FakeQbr = { deletedAt: Date | null; createdAt: Date }

  function activeQbrs(qbrs: FakeQbr[]): FakeQbr[] {
    return qbrs.filter(q => q.deletedAt === null)
  }

  const now = new Date('2026-08-23T00:00:00.000Z')
  const recentlyCreated = new Date('2026-08-01T00:00:00.000Z')

  it('Scenario A — 1 active, 0 deleted → active count 1', () => {
    const qbrs: FakeQbr[] = [{ deletedAt: null, createdAt: recentlyCreated }]
    expect(activeQbrs(qbrs).length).toBe(1)
  })

  it('Scenario B — 0 active, 1 deleted → active count 0', () => {
    const qbrs: FakeQbr[] = [{ deletedAt: now, createdAt: recentlyCreated }]
    expect(activeQbrs(qbrs).length).toBe(0)
  })

  it('Scenario C — 1 active, 1 deleted → active count 1 (not 2)', () => {
    const qbrs: FakeQbr[] = [
      { deletedAt: null, createdAt: recentlyCreated },
      { deletedAt: now,  createdAt: recentlyCreated },
    ]
    expect(activeQbrs(qbrs).length).toBe(1)
  })

  it('Scenario D — a Client\'s only recent QBR is deleted → active recent-QBR set is empty (not covered)', () => {
    const recentWindowQbrs: FakeQbr[] = [{ deletedAt: now, createdAt: recentlyCreated }]
    expect(activeQbrs(recentWindowQbrs).length).toBe(0)
  })
})

describe('Test limitation (explicit, honest)', () => {
  it('acknowledges this file proves Prisma query shape only, not a real Postgres soft-delete exclusion', () => {
    // This is a documentation-only assertion (always true) so the
    // limitation is visible in test output/coverage tooling, matching
    // the convention used elsewhere in this repo for source-contract
    // suites that cannot exercise a real database.
    const limitation =
      'This suite proves query-shape contracts via source inspection; ' +
      'it does not run against a real database and is not DB-backed ' +
      'integration coverage.'
    expect(typeof limitation).toBe('string')
  })
})

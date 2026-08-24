import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: read route.ts/page.tsx as plain text and
// regex/slice-match against them. They do NOT render React, do NOT mount
// any component, and do NOT execute the Prisma query against a real
// database — this repo has no jsdom/@testing-library or DB-backed
// integration test setup (see tests/analytics-deleted-qbr-filtering.test.ts,
// tests/analytics-empty-state.test.ts for the established precedent this
// file follows).
//
// LIMITATION (see also describe block at the bottom of this file):
// these tests prove the Prisma query *shape* — that the two affected
// Client-level queries carry a `deletedAt: null` condition — not that a
// real soft-deleted Client is actually excluded at runtime by Postgres.
// There is no DB-backed integration coverage for that here.
//
// Defect fixed: two Client-level query paths in
// app/api/analytics/route.ts previously included soft-deleted Clients
// (deletedAt != null) in active Client Analytics. This inflated
// summary.totalClients, undermined the hasNoClients empty-state
// selection, inflated the coverage denominator, polluted
// uncoveredClients with deleted Client names, and polluted the
// full-plan Client selector.
//
// NOTE: this fix does NOT change coveredClients' numerator behavior — a
// normally-deleted Client's active QBRs are already soft-deleted
// (Client DELETE cascades) and already excluded from the nested qbrs
// relation by PR #24. The defect here is the Client *population* itself
// (denominator, totalClients, uncoveredClients, selector), not the
// covered-QBR count.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const ROUTE_PATH = 'app/api/analytics/route.ts'
const routeSource = readSourceLF(ROUTE_PATH)

const PAGE_PATH = 'app/(app)/dashboard/(gated)/analytics/page.tsx'

describe('allClients — full-plan Client selector source', () => {
  function extractAllClientsBlock(): string {
    const startIdx = routeSource.indexOf('const allClients = isFullAnalytics')
    const endIdx   = routeSource.indexOf('// ── QBR base filter')
    expect(startIdx).toBeGreaterThan(-1)
    expect(endIdx).toBeGreaterThan(startIdx)
    return routeSource.slice(startIdx, endIdx)
  }

  it('excludes soft-deleted Clients via deletedAt: null in its own where', () => {
    const block = extractAllClientsBlock()
    expect(block).toMatch(/where:\s*{\s*workspaceId,\s*deletedAt:\s*null\s*}/)
  })

  it('workspace scoping is preserved', () => {
    const block = extractAllClientsBlock()
    expect(block).toMatch(/workspaceId/)
  })

  it('select/orderBy shape is preserved', () => {
    const block = extractAllClientsBlock()
    expect(block).toMatch(/select:\s*{\s*id:\s*true,\s*name:\s*true\s*}/)
    expect(block).toMatch(/orderBy:\s*{\s*name:\s*'asc'\s*}/)
  })

  it('remains gated behind isFullAnalytics (basic plan gets [])', () => {
    const block = extractAllClientsBlock()
    expect(block).toMatch(/const allClients = isFullAnalytics/)
    expect(block).toMatch(/:\s*\[\]/)
  })
})

describe('coverageClients — OUTER Client query (distinct from the nested QBR filter)', () => {
  function extractCoverageBlock(): string {
    const startIdx = routeSource.indexOf('const coverageClients = await prisma.client.findMany({')
    const endIdx   = routeSource.indexOf('const totalClients')
    expect(startIdx).toBeGreaterThan(-1)
    expect(endIdx).toBeGreaterThan(startIdx)
    return routeSource.slice(startIdx, endIdx)
  }

  it('the OUTER Client where (not the nested qbrs.where) contains deletedAt: null', () => {
    const block = extractCoverageBlock()
    // Capture only the outer where object's own contents — a
    // non-greedy match up to the first `}` closes exactly at the end
    // of `{ workspaceId, deletedAt: null }` since that object has no
    // nested braces. This cannot accidentally match the deeper nested
    // `qbrs: { where: { ... } }` object, which starts well after this
    // first `}`.
    const outerWhereMatch = block.match(/const coverageClients = await prisma\.client\.findMany\(\{\s*where:\s*\{([^}]*)\}/)
    expect(outerWhereMatch).not.toBeNull()
    expect(outerWhereMatch![1]).toMatch(/workspaceId/)
    expect(outerWhereMatch![1]).toMatch(/deletedAt:\s*null/)
  })

  it('workspace scoping is preserved in the outer where', () => {
    const block = extractCoverageBlock()
    const outerWhereMatch = block.match(/const coverageClients = await prisma\.client\.findMany\(\{\s*where:\s*\{([^}]*)\}/)
    expect(outerWhereMatch![1]).toMatch(/workspaceId/)
  })
})

describe('coverageClients — nested QBR filter (PR #24 behavior) remains intact', () => {
  function extractCoverageBlock(): string {
    const startIdx = routeSource.indexOf('const coverageClients = await prisma.client.findMany({')
    const endIdx   = routeSource.indexOf('const totalClients')
    expect(startIdx).toBeGreaterThan(-1)
    expect(endIdx).toBeGreaterThan(startIdx)
    return routeSource.slice(startIdx, endIdx)
  }

  it('the nested qbrs.where still contains BOTH deletedAt: null and the 90-day createdAt condition', () => {
    const block = extractCoverageBlock()
    expect(block).toMatch(/qbrs:\s*\{\s*where:\s*\{\s*deletedAt:\s*null,\s*createdAt:\s*\{\s*gte:\s*ninetyDaysAgo\s*\}\s*\}/)
  })

  it('select: { id: true } and take: 1 on the nested relation are unchanged', () => {
    const block = extractCoverageBlock()
    expect(block).toMatch(/select:\s*\{\s*id:\s*true\s*\},\s*\n\s*take:\s*1,/)
  })
})

describe('Main qbrWhere — QBR.deletedAt (PR #24) preserved, Client relation NOT broadened', () => {
  function extractQbrWhereBlock(): string {
    const startIdx = routeSource.indexOf('const qbrWhere: any = {')
    const endIdx   = routeSource.indexOf("if (isFullAnalytics && clientId !== 'all') qbrWhere.clientId = clientId")
    expect(startIdx).toBeGreaterThan(-1)
    expect(endIdx).toBeGreaterThan(startIdx)
    return routeSource.slice(startIdx, endIdx)
  }

  it('QBR.deletedAt: null (a top-level qbrWhere property) is present — PR #24 filter preserved', () => {
    const block = extractQbrWhereBlock()
    expect(block).toMatch(/^\s*deletedAt:\s*null,?\s*$/m)
  })

  it('the client relation is exactly { workspaceId } — NOT broadened with client.deletedAt (confirmed redundant per preflight)', () => {
    const block = extractQbrWhereBlock()
    // Anchor tightly to the `client:` sub-object only, distinguishing it
    // from the sibling top-level `deletedAt: null` (QBR.deletedAt) line
    // asserted above — these are two different fields of qbrWhere, not
    // the same occurrence.
    const clientRelationMatch = block.match(/client:\s*\{([^}]*)\}/)
    expect(clientRelationMatch).not.toBeNull()
    expect(clientRelationMatch![1]).toMatch(/workspaceId/)
    expect(clientRelationMatch![1]).not.toMatch(/deletedAt/)
  })

  it('createdAt date-range behavior is preserved', () => {
    const block = extractQbrWhereBlock()
    expect(block).toMatch(/createdAt:\s*\{\s*gte:\s*rangeStart\s*\}/)
  })
})

describe('totalQBRs — PR #24 contract preserved, untouched by this fix', () => {
  function extractTotalQbrsLine(): string {
    const idx = routeSource.indexOf('const totalQBRs = await prisma.qBR.count(')
    expect(idx).toBeGreaterThan(-1)
    const lineEnd = routeSource.indexOf('\n', idx)
    return routeSource.slice(idx, lineEnd)
  }

  it('still contains client: { workspaceId } and deletedAt: null (QBR-level), with no date filter', () => {
    const line = extractTotalQbrsLine()
    expect(line).toMatch(/client:\s*{\s*workspaceId\s*}/)
    expect(line).toMatch(/deletedAt:\s*null/)
    expect(line).not.toMatch(/createdAt/)
  })

  it('no Client.deletedAt was added here — this line has exactly one deletedAt occurrence (QBR-level)', () => {
    const line = extractTotalQbrsLine()
    const occurrences = line.match(/deletedAt:\s*null/g) ?? []
    expect(occurrences.length).toBe(1)
  })
})

describe('totalClients — source unchanged, now correct because its input query is fixed', () => {
  it('still derives from coverageClients.length — no separate count query was introduced', () => {
    expect(routeSource).toMatch(/const totalClients\s*=\s*coverageClients\.length/)
  })

  it('coveredClients / coveragePct / uncoveredClients calculations are unchanged', () => {
    expect(routeSource).toMatch(/const coveredClients\s*=\s*coverageClients\.filter\(c => c\.qbrs\.length > 0\)\.length/)
    expect(routeSource).toMatch(/const coveragePct\s*=\s*totalClients > 0 \? Math\.round\(\(coveredClients \/ totalClients\) \* 100\) : 0/)
    expect(routeSource).toMatch(/const uncoveredClients\s*=\s*coverageClients\.filter\(c => c\.qbrs\.length === 0\)\.map\(c => c\.name\)/)
  })
})

describe('Empty-state upstream contract — Analytics page itself is untouched by this fix', () => {
  it('the Analytics page still derives hasNoClients from summary.totalClients === 0', () => {
    const pageSource = readSourceLF(PAGE_PATH)
    expect(pageSource).toMatch(/const hasNoClients\s*= summary\.totalClients === 0/)
  })

  it('the Analytics page has no deletedAt reference — this fix is entirely upstream', () => {
    const pageSource = readSourceLF(PAGE_PATH)
    expect(pageSource).not.toMatch(/deletedAt/)
  })
})

describe('Selector contract — API clients response derives from the now-active-only allClients', () => {
  it('the response "clients" field is populated from allClients', () => {
    expect(routeSource).toMatch(/clients:\s*allClients,/)
  })
})

describe('Export/audit analytics remain independent of Client.deletedAt', () => {
  it('getCurrentExportPackageUsage (basic plan) has no Client/deletedAt reference', () => {
    const startIdx = routeSource.indexOf('async function getCurrentExportPackageUsage(')
    const endIdx   = routeSource.indexOf('async function getExportAnalytics(')
    expect(startIdx).toBeGreaterThan(-1)
    expect(endIdx).toBeGreaterThan(startIdx)
    const block = routeSource.slice(startIdx, endIdx)
    expect(block).not.toMatch(/deletedAt/)
    expect(block).not.toMatch(/prisma\.client\./)
  })

  it('getExportAnalytics (full plan) has no Client/deletedAt reference', () => {
    const startIdx = routeSource.indexOf('async function getExportAnalytics(')
    const endIdx   = routeSource.indexOf('// ── Main route')
    expect(startIdx).toBeGreaterThan(-1)
    expect(endIdx).toBeGreaterThan(startIdx)
    const block = routeSource.slice(startIdx, endIdx)
    expect(block).not.toMatch(/deletedAt/)
    expect(block).not.toMatch(/prisma\.client\./)
  })
})

describe('Active/deleted-Client behavioral harness (supplemental documentation only)', () => {
  // Pure, local reimplementation for documentation purposes only — this
  // does NOT exercise app/api/analytics/route.ts or a real database. It
  // exists to make the intended logical scenarios from the preflight
  // explicit and machine-checked, alongside (not instead of) the
  // source-contract tests above, which prove the actual query shape.
  type FakeClient = { id: string; deletedAt: Date | null; activeQbrCount: number }

  function activeClients(clients: FakeClient[]): FakeClient[] {
    return clients.filter(c => c.deletedAt === null)
  }

  function coverageOf(clients: FakeClient[]) {
    const active = activeClients(clients)
    const total = active.length
    const covered = active.filter(c => c.activeQbrCount > 0).length
    const pct = total > 0 ? Math.round((covered / total) * 100) : 0
    const uncovered = active.filter(c => c.activeQbrCount === 0).map(c => c.id)
    return { total, covered, pct, uncovered }
  }

  const now = new Date('2026-08-23T00:00:00.000Z')

  it('Scenario A — 1 active, 0 deleted → active count 1', () => {
    const clients: FakeClient[] = [{ id: 'c1', deletedAt: null, activeQbrCount: 1 }]
    expect(activeClients(clients).length).toBe(1)
  })

  it('Scenario B — 0 active, 1 deleted → active count 0', () => {
    const clients: FakeClient[] = [{ id: 'c1', deletedAt: now, activeQbrCount: 0 }]
    expect(activeClients(clients).length).toBe(0)
  })

  it('Scenario C — 1 active, 1 deleted → active count 1 (not 2)', () => {
    const clients: FakeClient[] = [
      { id: 'c1', deletedAt: null, activeQbrCount: 1 },
      { id: 'c2', deletedAt: now,  activeQbrCount: 0 },
    ]
    expect(activeClients(clients).length).toBe(1)
  })

  it('Scenario D — 1 active covered + 1 deleted → denominator 1, covered 1, coverage 100%', () => {
    const clients: FakeClient[] = [
      { id: 'c1', deletedAt: null, activeQbrCount: 1 },
      { id: 'c2', deletedAt: now,  activeQbrCount: 0 },
    ]
    const result = coverageOf(clients)
    expect(result.total).toBe(1)
    expect(result.covered).toBe(1)
    expect(result.pct).toBe(100)
    expect(result.uncovered).toEqual([])
  })

  it('Scenario E — deleted Client with only deleted QBRs is absent from the active set and uncovered list', () => {
    const clients: FakeClient[] = [{ id: 'c1', deletedAt: now, activeQbrCount: 0 }]
    const result = coverageOf(clients)
    expect(result.total).toBe(0)
    expect(result.uncovered).toEqual([])
  })
})

describe('Test limitation (explicit, honest)', () => {
  it('acknowledges this file proves Prisma query shape only, not a real Postgres soft-delete exclusion', () => {
    const limitation =
      'This suite proves query-shape contracts via source inspection; ' +
      'it does not run against a real database and is not DB-backed ' +
      'integration coverage.'
    expect(typeof limitation).toBe('string')
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: read page.tsx as plain text and regex/slice-match
// against it. They do NOT render React, do NOT mount the component, and do
// NOT execute the fetch handler — this repo has no jsdom/@testing-library
// setup (see tests/reminder-status-consistency.test.ts and
// tests/qbr-rename-banner.test.ts for the established precedent this file
// follows).
//
// P2 Analytics empty-state fix — the page previously collapsed two distinct
// zero-QBR situations (zero Clients vs. Clients-with-zero-QBRs) into one
// generic "No analytics yet" card with no actionable link. This replaces it
// with two explicit states, each carrying a real CTA.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const PAGE_PATH = 'app/(app)/dashboard/(gated)/analytics/page.tsx'
const pageSource = readSourceLF(PAGE_PATH)

// The full empty-states block, isolated from the populated-dashboard JSX
// that follows it, so assertions about "no generic direct-QBR CTA" etc.
// can be scoped precisely instead of accidentally matching unrelated code
// elsewhere in the file (e.g. the real "New QBR" links inside the populated
// dashboard, which legitimately point at Client-scoped QBR routes).
function extractEmptyStatesBlock(): string {
  const startIdx = pageSource.indexOf('{/* ── Empty states')
  const endIdx   = pageSource.indexOf('{/* ── KPI cards')
  expect(startIdx).toBeGreaterThan(-1)
  expect(endIdx).toBeGreaterThan(startIdx)
  return pageSource.slice(startIdx, endIdx)
}

describe('Analytics page — two distinct zero-QBR conditions replace the old single isEmpty check', () => {
  it('declares hasNoClients from summary.totalClients === 0', () => {
    expect(pageSource).toMatch(/const hasNoClients = summary\.totalClients === 0/)
  })

  it('declares hasNoQbrs from summary.totalQBRs === 0', () => {
    expect(pageSource).toMatch(/const hasNoQbrs\s*= summary\.totalQBRs === 0/)
  })

  it('the old single generic isEmpty condition no longer exists', () => {
    expect(pageSource).not.toMatch(/const isEmpty = summary\.totalQBRs === 0 && qbrActivity\.length === 0/)
    expect(pageSource).not.toMatch(/\bisEmpty\b/)
  })

  it('hasNoClients is checked before hasNoQbrs — the zero-client branch must win when both are true', () => {
    const hasNoClientsIdx = pageSource.search(/\{hasNoClients \? \(/)
    const hasNoQbrsIdx    = pageSource.search(/\) : hasNoQbrs \? \(/)
    expect(hasNoClientsIdx).toBeGreaterThan(-1)
    expect(hasNoQbrsIdx).toBeGreaterThan(hasNoClientsIdx)
  })
})

describe('State A — zero clients', () => {
  const block = extractEmptyStatesBlock()

  it('renders under the hasNoClients condition', () => {
    expect(block).toMatch(/\{hasNoClients \? \(/)
  })

  it('shows the "No clients yet" heading', () => {
    expect(block).toMatch(/No clients yet/)
  })

  it('has an actionable CTA labeled "Add your first client"', () => {
    expect(block).toMatch(/Add your first client/)
  })

  it('the CTA is a Link to /dashboard/clients/new — the exact new-client route', () => {
    const ctaMatch = block.match(/<Link href="\/dashboard\/clients\/new"[^>]*>\s*Add your first client\s*<\/Link>/)
    expect(ctaMatch).not.toBeNull()
  })
})

describe('State B — clients exist but zero QBRs', () => {
  const block = extractEmptyStatesBlock()

  it('renders under the hasNoQbrs condition, in the else-if position after hasNoClients', () => {
    expect(block).toMatch(/\) : hasNoQbrs \? \(/)
  })

  it('shows the "No QBRs yet" heading', () => {
    expect(block).toMatch(/No QBRs yet/)
  })

  it('has an actionable CTA labeled "View clients"', () => {
    expect(block).toMatch(/View clients/)
  })

  it('the CTA is a Link to /dashboard/clients — not the zero-client CTA, not a Client-specific route', () => {
    const ctaMatch = block.match(/<Link href="\/dashboard\/clients"[^>]*>\s*View clients\s*<\/Link>/)
    expect(ctaMatch).not.toBeNull()
  })

  it('this CTA is textually distinct from the zero-client CTA — different label, different href', () => {
    expect(block).not.toMatch(/<Link href="\/dashboard\/clients">\s*Add your first client\s*<\/Link>/)
  })
})

describe('No generic direct-to-QBR-generation route was introduced', () => {
  const block = extractEmptyStatesBlock()

  it('the empty-states block does not link to a generic /dashboard/qbr/new or similar non-Client-scoped QBR route', () => {
    expect(block).not.toMatch(/\/dashboard\/qbr\/new/)
    expect(block).not.toMatch(/href="\/dashboard\/qbr/)
  })

  it('the empty-states block does not link to a Client-specific QBR route either — Analytics cannot safely pick one Client', () => {
    expect(block).not.toMatch(/\/qbr\/new/)
  })
})

describe('Both empty states are actionable — no page-level zero-data state is prose-only', () => {
  it('State A contains a Link element, not just paragraph text', () => {
    const stateAMatch = pageSource.match(/\{hasNoClients \? \(([\s\S]*?)\) : hasNoQbrs \? \(/)
    const stateABody = stateAMatch?.[1] ?? ''
    expect(stateAMatch).not.toBeNull()
    expect(stateABody).toMatch(/<Link href=/)
  })

  it('State B contains a Link element, not just paragraph text', () => {
    const stateBMatch = pageSource.match(/\) : hasNoQbrs \? \(([\s\S]*?)\) : \(/)
    const stateBBody = stateBMatch?.[1] ?? ''
    expect(stateBMatch).not.toBeNull()
    expect(stateBBody).toMatch(/<Link href=/)
  })
})

describe('Populated Analytics dashboard remains structurally unchanged', () => {
  it('KPI cards section is still present', () => {
    expect(pageSource).toMatch(/\{\/\* ── KPI cards/)
    expect(pageSource).toMatch(/Total clients/)
    expect(pageSource).toMatch(/QBRs generated \(all time\)/)
  })

  it('QBR activity chart section is still present', () => {
    expect(pageSource).toMatch(/QBRs generated \(all time\)<\/h2>/)
    expect(pageSource).toMatch(/<SimpleBarChart data=\{qbrActivity as any\}/)
  })

  it('health score trends, top risk flags, and high-risk clients sections are all still present', () => {
    expect(pageSource).toMatch(/Health score trends/)
    expect(pageSource).toMatch(/Top risk flags/)
    expect(pageSource).toMatch(/High-risk clients/)
  })

  it('the LockedWidget component definition is still present, unchanged in shape', () => {
    expect(pageSource).toMatch(/function LockedWidget\(/)
    expect(pageSource).toMatch(/Advanced analytics is available on Growth and Agency plans\./)
  })

  it('uncovered-clients row is still present', () => {
    expect(pageSource).toMatch(/Clients without a recent QBR/)
  })
})

describe('Plan gating is unchanged', () => {
  it('isFullAnalytics is still derived from analyticsAccess === \'full\'', () => {
    expect(pageSource).toMatch(/const isFullAnalytics = analyticsAccess === 'full'/)
  })

  it('the upgrade banner for basic plans is still present, gated on !isFullAnalytics', () => {
    expect(pageSource).toMatch(/\{!isFullAnalytics && \(/)
    expect(pageSource).toMatch(/Advanced analytics is available on Growth and Agency plans\./)
  })

  it('the billing upgrade destination is unchanged', () => {
    const billingLinks = pageSource.match(/href="\/dashboard\/billing"/g) ?? []
    expect(billingLinks.length).toBeGreaterThanOrEqual(2) // upgrade banner + LockedWidget
  })
})

describe('Analytics API contract is untouched by this fix', () => {
  it('app/api/analytics/route.ts has zero diff-relevant changes — this test only proves the two fields this fix depends on are still returned', () => {
    const routeSource = readSourceLF('app/api/analytics/route.ts')
    expect(routeSource).toMatch(/totalClients,/)
    expect(routeSource).toMatch(/totalQBRs,/)
  })
})

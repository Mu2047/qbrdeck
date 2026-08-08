import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'

// This repo has no jsdom/@testing-library/react (see tests/qbr-autosave-
// failure-handling.test.ts for the established precedent this file follows).
// Two kinds of tests appear below, clearly separated by describe block:
//
//  - "source contract" tests read page.tsx as plain text and regex/slice-match
//    against it. They do NOT render React, do NOT exercise the real DOM, and
//    do NOT run the actual page module — they prove the source contains the
//    expected code shape (which JSX element wraps which field, which handler
//    is wired to which onSave/onChange), nothing more.
//  - "behavioral harness" tests reimplement the three new/changed updaters
//    (updatePriority, updateRecommendation, and the metric-value read-only
//    ruling) as small, pure, in-memory mirrors driven with plain object
//    fixtures, and assert on their actual output — not on regex matches. The
//    mirrors' shape is pinned back to the real source by the source-contract
//    tests in the same file, so the two cannot silently drift apart.

const PAGE_PATH = join(
  process.cwd(),
  'app/(app)/dashboard/clients/[id]/qbr/[qbrId]/page.tsx'
)
// Normalized to LF regardless of the checked-out line-ending style.
const pageSource = readFileSync(PAGE_PATH, 'utf-8').replace(/\r\n/g, '\n')

function extractFunctionSource(name: string, nextSiblingName: string): string {
  const pattern = new RegExp(
    `function ${name}\\([^)]*\\)[\\s\\S]*?(?=\\n\\s*(?:type |(?:async )?function )${nextSiblingName}\\b)`
  )
  const match = pageSource.match(pattern)
  if (!match) throw new Error(`could not locate function ${name}() in page.tsx source`)
  return match[0]
}

function extractJsxBlock(commentAnchor: string, windowSize = 2000): string {
  const idx = pageSource.indexOf(commentAnchor)
  if (idx === -1) throw new Error(`could not locate JSX block anchored at: ${commentAnchor}`)
  return pageSource.slice(idx, idx + windowSize)
}

const updateMetricSource         = extractFunctionSource('updateMetric', 'updatePriority')
const updatePrioritySource       = extractFunctionSource('updatePriority', 'updateRecommendation')
const updateRecommendationSource = extractFunctionSource('updateRecommendation', 'sendToClient')

const metricsBlock         = extractJsxBlock('{/* Metrics */}', 4200)
const prioritiesBlock      = extractJsxBlock('{/* Roadmap')
const recommendationsBlock = extractJsxBlock('{/* Recommendations')

// ─────────────────────────────────────────────────────────────────────────
// A. Priorities — source contract
// ─────────────────────────────────────────────────────────────────────────

describe('page.tsx — priorities updater source contract', () => {
  it('declares a typed PriorityCategory union, not arbitrary string indexing', () => {
    expect(pageSource).toMatch(/type PriorityCategory = 'critical' \| 'important' \| 'strategic'/)
  })

  it('updatePriority takes (slideIdx, category: PriorityCategory, itemIdx, value)', () => {
    expect(pageSource).toMatch(
      /function updatePriority\(slideIdx: number, category: PriorityCategory, itemIdx: number, value: string\)/
    )
  })

  it('builds nextRaw and nextResolved immutably (map + spread), never mutates in place', () => {
    expect(updatePrioritySource).toMatch(/const nextRaw\s*=\s*rawSlides\.map\(/)
    expect(updatePrioritySource).toMatch(/const nextResolved\s*=\s*resolvedSlides\.map\(/)
    expect(updatePrioritySource).not.toMatch(/\.push\(/)
    expect(updatePrioritySource).not.toMatch(/\.splice\(/)
    expect(updatePrioritySource).not.toMatch(/\[category\]\[itemIdx\]\s*=/) // no direct index assignment
  })

  it('spreads slide and priorities rather than mutating the original objects', () => {
    expect(updatePrioritySource).toMatch(/\{ \.\.\.s, priorities: \{ \.\.\.s\.priorities, \[category\]: items \} \}/)
  })

  it('calls setRawSlides, setResolvedSlides, then saveSlides(nextRaw) — the same pattern as updateBullet/updateMetric', () => {
    expect(updatePrioritySource).toMatch(/setRawSlides\(nextRaw\)/)
    expect(updatePrioritySource).toMatch(/setResolvedSlides\(nextResolved\)/)
    expect(updatePrioritySource).toMatch(/saveSlides\(nextRaw\)/)
  })

  it('never calls fetch/requestJson directly — persistence only via saveSlides', () => {
    expect(updatePrioritySource).not.toMatch(/fetch\(/)
    expect(updatePrioritySource).not.toMatch(/requestJson/)
  })
})

describe('page.tsx — priorities UI wiring', () => {
  it('preserves the Critical / Important / Strategic column definitions unchanged', () => {
    expect(prioritiesBlock).toContain("{ key: 'critical',  label: 'Critical',  color: 'bg-red-50 border-red-200 text-red-700'    }")
    expect(prioritiesBlock).toContain("{ key: 'important', label: 'Important', color: 'bg-amber-50 border-amber-200 text-amber-700' }")
    expect(prioritiesBlock).toContain("{ key: 'strategic', label: 'Strategic', color: 'bg-blue-50 border-blue-200 text-blue-700'  }")
  })

  it('still maps over exactly slide.priorities[col.key] with no add/remove/reorder helpers nearby', () => {
    expect(prioritiesBlock).toMatch(/\(slide\.priorities\[col\.key\] \?\? \[\]\)\.map\(\(item: string, k: number\) =>/)
    expect(prioritiesBlock).not.toMatch(/onClick=\{.*(add|remove|delete|reorder|move)/i)
  })

  it('each priority item is wired to EditableText, calling updatePriority with the column key cast to PriorityCategory', () => {
    expect(prioritiesBlock).toMatch(
      /<EditableText\s*\n\s*value=\{item\}\s*\n\s*onSave=\{val => updatePriority\(i, col\.key as PriorityCategory, k, val\)\}/
    )
  })

  it('the item count per column is unchanged — one <li> per array item, one EditableText per <li>', () => {
    const liCount = (prioritiesBlock.match(/<li key=\{k\}/g) ?? []).length
    const editableCount = (prioritiesBlock.match(/<EditableText/g) ?? []).length
    expect(liCount).toBe(1)
    expect(editableCount).toBe(1)
  })

  it('the dash marker remains a fixed, non-editable prefix', () => {
    expect(prioritiesBlock).toMatch(/<span className="flex-shrink-0">—<\/span>/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// B. Recommendations — source contract
// ─────────────────────────────────────────────────────────────────────────

describe('page.tsx — recommendations updater source contract', () => {
  it('declares a typed RecommendationField union, not arbitrary string indexing', () => {
    expect(pageSource).toMatch(/type RecommendationField = 'title' \| 'why' \| 'risk' \| 'benefit'/)
  })

  it('updateRecommendation takes (slideIdx, recIdx, field: RecommendationField, value)', () => {
    expect(pageSource).toMatch(
      /function updateRecommendation\(slideIdx: number, recIdx: number, field: RecommendationField, value: string\)/
    )
  })

  it('builds nextRaw and nextResolved immutably (map + spread), never mutates in place', () => {
    expect(updateRecommendationSource).toMatch(/const nextRaw\s*=\s*rawSlides\.map\(/)
    expect(updateRecommendationSource).toMatch(/const nextResolved\s*=\s*resolvedSlides\.map\(/)
    expect(updateRecommendationSource).not.toMatch(/\.push\(/)
    expect(updateRecommendationSource).not.toMatch(/\.splice\(/)
  })

  it('spreads the recommendation object rather than mutating it, keyed by the typed field union', () => {
    expect(updateRecommendationSource).toMatch(/\{ \.\.\.r, \[field\]: value \} : r/)
  })

  it('calls setRawSlides, setResolvedSlides, then saveSlides(nextRaw)', () => {
    expect(updateRecommendationSource).toMatch(/setRawSlides\(nextRaw\)/)
    expect(updateRecommendationSource).toMatch(/setResolvedSlides\(nextResolved\)/)
    expect(updateRecommendationSource).toMatch(/saveSlides\(nextRaw\)/)
  })

  it('never calls fetch/requestJson directly', () => {
    expect(updateRecommendationSource).not.toMatch(/fetch\(/)
    expect(updateRecommendationSource).not.toMatch(/requestJson/)
  })
})

describe('page.tsx — recommendations UI wiring', () => {
  it('title/why/risk/benefit are each wired to EditableText via updateRecommendation', () => {
    expect(recommendationsBlock).toMatch(/onSave=\{val => updateRecommendation\(i, j, 'title', val\)\}/)
    expect(recommendationsBlock).toMatch(/onSave=\{val => updateRecommendation\(i, j, 'why', val\)\}/)
    expect(recommendationsBlock).toMatch(/onSave=\{val => updateRecommendation\(i, j, 'risk', val\)\}/)
    expect(recommendationsBlock).toMatch(/onSave=\{val => updateRecommendation\(i, j, 'benefit', val\)\}/)
  })

  it('the numbering prefix and fixed labels remain literal text, not wrapped in EditableText', () => {
    expect(recommendationsBlock).toContain('{j + 1}. <EditableText')
    expect(recommendationsBlock).toContain('<span className="font-medium text-gray-700">Why it matters:</span>')
    expect(recommendationsBlock).toContain('<span className="font-medium text-gray-700">Risk if ignored:</span>')
    expect(recommendationsBlock).toContain('<span className="font-medium text-gray-700">Expected benefit:</span>')
  })

  it('exactly four EditableText fields per recommendation card, no add/remove/reorder controls', () => {
    const editableCount = (recommendationsBlock.match(/<EditableText/g) ?? []).length
    expect(editableCount).toBe(4)
    expect(recommendationsBlock).not.toMatch(/onClick=\{.*(add|remove|delete|reorder|move)/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// C. Metrics — source contract
// ─────────────────────────────────────────────────────────────────────────

describe('page.tsx — metric truth-protection source contract', () => {
  it('the health-score card label is plain text, not EditableText — gated on healthClasses', () => {
    expect(metricsBlock).toMatch(/\{healthClasses \? \(\s*<p className="text-xs text-gray-500 mb-1">\{m\.label\}<\/p>/)
  })

  it('the non-health card label remains EditableText, wired to updateMetric(...,\'label\',...)', () => {
    expect(metricsBlock).toMatch(
      /<EditableText\s*\n\s*value=\{m\.label\}\s*\n\s*onSave=\{val => updateMetric\(i, j, 'label', val\)\}/
    )
  })

  it('the metric value is plain read-only text for every card — no EditableText, no updateMetric(...,\'value\',...) call site remains', () => {
    expect(metricsBlock).toMatch(/<p className="text-xl font-bold text-navy-800 mb-1">\{m\.value\}<\/p>/)
    expect(metricsBlock).not.toMatch(/updateMetric\(i, j, 'value', val\)/)
  })

  it('the health-score status stays deterministic (healthCardLabel), not the editable select', () => {
    expect(metricsBlock).toMatch(/\{healthCardLabel\(m, qbr\.healthStatus\)\}/)
  })

  it('the non-health status select is unchanged — still wired to updateMetric(...,\'status\',...)', () => {
    expect(metricsBlock).toMatch(/onChange=\{e => updateMetric\(i, j, 'status', e\.target\.value\)\}/)
  })

  it('updateMetric itself is untouched — still a generic (slideIdx, metricIdx, field, value) updater; the read-only ruling lives in the JSX, not the updater', () => {
    expect(updateMetricSource).toMatch(/function updateMetric\(slideIdx: number, metricIdx: number, field: string, value: string\)/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// D. Structural / derived fields stay read-only
// ─────────────────────────────────────────────────────────────────────────

describe('page.tsx — structural/derived fields remain read-only', () => {
  it('slide.title is rendered as plain text, never wrapped in EditableText', () => {
    expect(pageSource).toMatch(/<p className="text-white text-sm font-medium">\{slide\.title\}<\/p>/)
    // No EditableText call site references slide.title anywhere.
    expect(pageSource).not.toMatch(/EditableText[\s\S]{0,80}slide\.title/)
  })

  it('the cover client name / quarter / year are plain text, never wrapped in EditableText', () => {
    expect(pageSource).toMatch(/<p className="text-white text-2xl font-bold mb-1">\{qbr\.client\.name\}<\/p>/)
    expect(pageSource).toMatch(/<p className="text-gold-300 text-lg">Q\{qbr\.quarter\} \{qbr\.year\}<\/p>/)
  })

  it('the cover health score / status are plain text, never wrapped in EditableText', () => {
    expect(pageSource).toMatch(/\{qbr\.healthScore != null \? qbr\.healthScore : 'N\/A'\}/)
    expect(pageSource).toMatch(/\{qbr\.healthStatus \?\? 'Not assessed'\}/)
  })

  it('no updater anywhere writes to qbr.tickets/uptimePct/avgResolutionHrs/patchCompliance*/securityIncidents/healthScore/healthStatus', () => {
    expect(pageSource).not.toMatch(/setQbr\(.*health/i)
    expect(pageSource).not.toMatch(/qbr\.(tickets|uptimePct|avgResolutionHrs|patchCompliancePct|securityIncidents|healthScore|healthStatus)\s*=/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// E. Scope — no API/schema changes required
// ─────────────────────────────────────────────────────────────────────────

describe('page.tsx — scope: autosave PATCH remains the only persistence mechanism', () => {
  it('there is still exactly one PATCH call site, reused by every updater (content/bullet/metric/priority/recommendation) via saveSlides', () => {
    const patchCalls = pageSource.match(/method:\s*'PATCH'/g) ?? []
    expect(patchCalls.length).toBe(1)
  })

  it('every updater — old and new — funnels through saveSlides(nextRaw), never a separate request path', () => {
    const calls = pageSource.match(/saveSlides\(nextRaw\)/g) ?? []
    // updateContent, updateBullet, updateMetric, updatePriority, updateRecommendation
    expect(calls.length).toBe(5)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Behavioral harness — real logic, in-memory fixtures, no regex involved.
// Mirrors updatePriority/updateRecommendation exactly (pinned to the real
// source by the source-contract tests above) and exercises them against
// actual slide-shaped data, asserting on the resulting arrays.
// ─────────────────────────────────────────────────────────────────────────

type PriorityCategory = 'critical' | 'important' | 'strategic'
type RecommendationField = 'title' | 'why' | 'risk' | 'benefit'

function mirrorUpdatePriority(
  rawSlides: any[],
  resolvedSlides: any[],
  slideIdx: number,
  category: PriorityCategory,
  itemIdx: number,
  value: string
) {
  const nextRaw = rawSlides.map((s, i) => {
    if (i !== slideIdx) return s
    const items = s.priorities[category].map((item: string, k: number) => k === itemIdx ? value : item)
    return { ...s, priorities: { ...s.priorities, [category]: items } }
  })
  const nextResolved = resolvedSlides.map((s, i) => {
    if (i !== slideIdx) return s
    const items = s.priorities[category].map((item: string, k: number) => k === itemIdx ? value : item)
    return { ...s, priorities: { ...s.priorities, [category]: items } }
  })
  return { nextRaw, nextResolved }
}

function mirrorUpdateRecommendation(
  rawSlides: any[],
  resolvedSlides: any[],
  slideIdx: number,
  recIdx: number,
  field: RecommendationField,
  value: string
) {
  const nextRaw = rawSlides.map((s, i) => {
    if (i !== slideIdx) return s
    const recommendations = s.recommendations.map((r: any, j: number) =>
      j === recIdx ? { ...r, [field]: value } : r
    )
    return { ...s, recommendations }
  })
  const nextResolved = resolvedSlides.map((s, i) => {
    if (i !== slideIdx) return s
    const recommendations = s.recommendations.map((r: any, j: number) =>
      j === recIdx ? { ...r, [field]: value } : r
    )
    return { ...s, recommendations }
  })
  return { nextRaw, nextResolved }
}

function makeRoadmapFixture() {
  return [
    {
      title: 'Q4 2026 Strategic Roadmap',
      type: 'roadmap',
      content: 'Priorities for next quarter.',
      priorities: {
        critical:  ['Replace end-of-life server', 'Finish MFA rollout'],
        important: ['Evaluate SIEM consolidation'],
        strategic: ['Plan network segmentation'],
      },
    },
  ]
}

function makeRecommendationsFixture() {
  return [
    {
      title: 'Strategic Recommendations',
      type: 'recommendations',
      content: 'Top recommendations.',
      recommendations: [
        { title: 'Modernize backups', why: 'Untested backups.', risk: 'downtime', benefit: 'faster recovery' },
        { title: 'Adopt MFA', why: 'Credential theft.', risk: 'account takeover', benefit: 'reduced breach risk' },
      ],
    },
  ]
}

describe('updatePriority — behavioral harness', () => {
  it('changes only the targeted item, leaving every other item and category untouched', () => {
    const raw = makeRoadmapFixture()
    const resolved = makeRoadmapFixture()
    const { nextRaw, nextResolved } = mirrorUpdatePriority(raw, resolved, 0, 'critical', 1, 'Finish MFA rollout for contractors')

    expect(nextRaw[0].priorities.critical).toEqual([
      'Replace end-of-life server',
      'Finish MFA rollout for contractors',
    ])
    expect(nextRaw[0].priorities.important).toEqual(['Evaluate SIEM consolidation'])
    expect(nextRaw[0].priorities.strategic).toEqual(['Plan network segmentation'])
    expect(nextResolved[0].priorities).toEqual(nextRaw[0].priorities)
  })

  it('does not mutate the original input arrays/objects (immutability)', () => {
    const raw = makeRoadmapFixture()
    const resolved = makeRoadmapFixture()
    const originalCriticalRef = raw[0].priorities.critical
    const originalPrioritiesRef = raw[0].priorities
    const originalSlideRef = raw[0]

    mirrorUpdatePriority(raw, resolved, 0, 'critical', 0, 'changed')

    expect(raw[0].priorities.critical).toBe(originalCriticalRef) // untouched original ref
    expect(raw[0].priorities.critical[0]).toBe('Replace end-of-life server') // original value unchanged
    expect(raw[0].priorities).toBe(originalPrioritiesRef)
    expect(raw[0]).toBe(originalSlideRef)
  })

  it('rawSlides and resolvedSlides receive the identical edited value', () => {
    const raw = makeRoadmapFixture()
    const resolved = makeRoadmapFixture()
    const { nextRaw, nextResolved } = mirrorUpdatePriority(raw, resolved, 0, 'strategic', 0, 'Plan Q1 segmentation rollout')

    expect(nextRaw[0].priorities.strategic[0]).toBe('Plan Q1 segmentation rollout')
    expect(nextResolved[0].priorities.strategic[0]).toBe('Plan Q1 segmentation rollout')
  })

  it('the array length never changes — no add/remove capability exists in the updater', () => {
    const raw = makeRoadmapFixture()
    const resolved = makeRoadmapFixture()
    const { nextRaw } = mirrorUpdatePriority(raw, resolved, 0, 'critical', 0, 'edited')
    expect(nextRaw[0].priorities.critical.length).toBe(2)
  })

  it('leaves other slides in the array untouched by reference', () => {
    const raw = [{ type: 'wins', bullets: ['a'] }, ...makeRoadmapFixture()]
    const resolved = [{ type: 'wins', bullets: ['a'] }, ...makeRoadmapFixture()]
    const otherSlideRef = raw[0]
    const { nextRaw } = mirrorUpdatePriority(raw, resolved, 1, 'critical', 0, 'edited')
    expect(nextRaw[0]).toBe(otherSlideRef)
  })
})

describe('updateRecommendation — behavioral harness', () => {
  it('changes only the targeted recommendation and field', () => {
    const raw = makeRecommendationsFixture()
    const resolved = makeRecommendationsFixture()
    const { nextRaw } = mirrorUpdateRecommendation(raw, resolved, 0, 0, 'risk', 'can lead to significant recovery costs')

    expect(nextRaw[0].recommendations[0]).toEqual({
      title: 'Modernize backups',
      why: 'Untested backups.',
      risk: 'can lead to significant recovery costs',
      benefit: 'faster recovery',
    })
    // Second recommendation is completely untouched.
    expect(nextRaw[0].recommendations[1]).toEqual(raw[0].recommendations[1])
  })

  it('each of the four fields can be targeted independently', () => {
    const raw = makeRecommendationsFixture()
    const resolved = makeRecommendationsFixture()
    const fields: RecommendationField[] = ['title', 'why', 'risk', 'benefit']
    for (const field of fields) {
      const { nextRaw } = mirrorUpdateRecommendation(raw, resolved, 0, 1, field, `edited-${field}`)
      expect(nextRaw[0].recommendations[1][field]).toBe(`edited-${field}`)
      // Every other field on that same recommendation is untouched.
      for (const other of fields.filter(f => f !== field)) {
        expect(nextRaw[0].recommendations[1][other]).toBe(raw[0].recommendations[1][other])
      }
    }
  })

  it('does not mutate the original recommendation objects (immutability)', () => {
    const raw = makeRecommendationsFixture()
    const resolved = makeRecommendationsFixture()
    const originalRecRef = raw[0].recommendations[0]

    mirrorUpdateRecommendation(raw, resolved, 0, 0, 'why', 'changed')

    expect(raw[0].recommendations[0]).toBe(originalRecRef)
    expect(raw[0].recommendations[0].why).toBe('Untested backups.')
  })

  it('rawSlides and resolvedSlides receive the identical edited value', () => {
    const raw = makeRecommendationsFixture()
    const resolved = makeRecommendationsFixture()
    const { nextRaw, nextResolved } = mirrorUpdateRecommendation(raw, resolved, 0, 0, 'benefit', 'materially reduces risk')

    expect(nextRaw[0].recommendations[0].benefit).toBe('materially reduces risk')
    expect(nextResolved[0].recommendations[0].benefit).toBe('materially reduces risk')
  })

  it('the recommendations array length never changes — no add/remove capability exists', () => {
    const raw = makeRecommendationsFixture()
    const resolved = makeRecommendationsFixture()
    const { nextRaw } = mirrorUpdateRecommendation(raw, resolved, 0, 0, 'title', 'edited')
    expect(nextRaw[0].recommendations.length).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Placeholder-freezing behavior note (documented per task §9 — not redesigned)
// ─────────────────────────────────────────────────────────────────────────

describe('editing a resolved field freezes it into rawSlides, exactly like existing content/bullet behavior', () => {
  it('the mirror writes the same already-resolved display value into both rawSlides and resolvedSlides, so a field that started as a {{placeholder}} loses that placeholder the moment it is edited — this is pre-existing behavior (see updateContent/updateBullet) and is not changed or redesigned by this branch', () => {
    const raw = [{
      title: 'Recs',
      type: 'recommendations',
      recommendations: [{ title: 'x', why: 'x', risk: 'x', benefit: 'Report prepared for {{clientName}}.' }],
    }]
    const resolved = [{
      title: 'Recs',
      type: 'recommendations',
      recommendations: [{ title: 'x', why: 'x', risk: 'x', benefit: 'Report prepared for Acme Corp.' }],
    }]

    // The user edits the RESOLVED (on-screen) text, e.g. fixing a typo.
    const editedValue = 'Report prepared for Acme Corp, reviewed quarterly.'
    const { nextRaw, nextResolved } = mirrorUpdateRecommendation(raw, resolved, 0, 0, 'benefit', editedValue)

    // rawSlides now holds the literal resolved text, not the original {{clientName}} template.
    expect(nextRaw[0].recommendations[0].benefit).toBe(editedValue)
    expect(nextRaw[0].recommendations[0].benefit).not.toContain('{{clientName}}')
    expect(nextResolved[0].recommendations[0].benefit).toBe(editedValue)
  })
})

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// ── Source-contract tests ─────────────────────────────────────────────────────
// These do not execute the route/page handlers (that would require mocking
// Prisma, Clerk, and the rest of the request pipeline). Instead they read the
// five authorized server files as text and verify, by inspecting the source
// directly, that each contains exactly its approved fixed-context logging
// call and nothing else on that call — i.e. that the Requirement-7 hardening
// logging contract (lib/placeholders.ts sanitizeResolvedSlides() + the
// per-boundary console.error calls) was implemented as specified and hasn't
// silently drifted.

const ROOT = path.resolve(__dirname, '..')

// export-pdf/export-pptx are no longer their own boundary: PR 7 extracted
// their shared business logic (quota, generation, ExportEvent, and this
// sanitize/log call) into lib/qbr-export.ts, so both routes now reach a
// single parameterized boundary instead of duplicating it — see the
// dedicated describe block below for that boundary's coverage.
const BOUNDARIES: Array<{ file: string; tag: string }> = [
  { file: 'app/api/qbrs/[qbrId]/route.ts', tag: 'saved-qbr-get' },
  { file: 'app/api/generate-qbr/route.ts', tag: 'generate-qbr' },
  { file: 'app/portal/[token]/page.tsx',   tag: 'portal' },
]

const ALL_TAGS = [...BOUNDARIES.map(b => b.tag), 'export-pdf', 'export-pptx', 'onboarding-review']

// Identifiers that must never appear on a line logging an unresolved
// placeholder detection — these would indicate private QBR content leaking
// into the log line instead of just the QBR id.
const FORBIDDEN_TERMS = [
  'clientname',
  'client.name',
  'slide',
  'placeholder]', // matches only if followed unexpectedly; see note below
  'metric',
  'priorit',
  'recommendation',
  'healthstatus',
  'healthscore',
  'title',
  'content',
  'bullet',
]

describe.each(BOUNDARIES)('unresolved-placeholder logging — source contract: $file', ({ file, tag }) => {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8')

  it(`contains exactly its approved fixed context log call [unresolved-placeholder][${tag}]`, () => {
    const expectedCall = `console.error('[unresolved-placeholder][${tag}]', qbr.id)`
    expect(source).toContain(expectedCall)
  })

  it('has exactly one unresolved-placeholder console.error call, with exactly two arguments: the fixed literal tag and qbr.id', () => {
    const allConsoleErrorCalls = [...source.matchAll(/console\.error\(([^)]*)\)/g)]
    const unresolvedCalls = allConsoleErrorCalls.filter(m => m[0].includes('[unresolved-placeholder]'))

    expect(unresolvedCalls).toHaveLength(1)

    const args = unresolvedCalls[0][1].split(',').map(s => s.trim())
    expect(args).toHaveLength(2)
    expect(args[0]).toBe(`'[unresolved-placeholder][${tag}]'`)
    expect(args[1]).toBe('qbr.id')
  })

  it('does not contain any other boundary\'s fixed context tag', () => {
    const otherTags = ALL_TAGS.filter(t => t !== tag)
    for (const other of otherTags) {
      expect(source).not.toContain(`[unresolved-placeholder][${other}]`)
    }
  })

  it('logs no client names, slide content, placeholder contents, metrics, priorities, or recommendations on the logging line', () => {
    const loggingLines = source.split('\n').filter(l => l.includes('[unresolved-placeholder]'))
    expect(loggingLines.length).toBeGreaterThan(0)

    for (const line of loggingLines) {
      // The only dynamic value on the line must be qbr.id.
      expect(line).toContain('qbr.id')

      const lower = line.toLowerCase()
      for (const term of FORBIDDEN_TERMS) {
        if (term === 'placeholder]') continue // part of the approved tag itself, not a forbidden term
        expect(lower).not.toContain(term)
      }
    }
  })

  it('the log call is gated behind the sanitizer\'s hadUnresolvedTokens flag, not unconditional', () => {
    const idx = source.indexOf(`console.error('[unresolved-placeholder][${tag}]', qbr.id)`)
    expect(idx).toBeGreaterThan(-1)
    // Look at a small window of source immediately preceding the call for an
    // `if (...hadUnresolvedTokens...)` guard, confirming this is not logged
    // on every request.
    const preceding = source.slice(Math.max(0, idx - 200), idx)
    expect(preceding).toMatch(/if\s*\([^)]*hadUnresolvedTokens[^)]*\)/)
  })
})

describe('sanitizeResolvedSlides usage — the three standalone boundaries call it after resolveSlides()', () => {
  for (const { file } of BOUNDARIES) {
    it(`${file} imports sanitizeResolvedSlides from lib/placeholders`, () => {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
      expect(source).toMatch(/import\s*\{[^}]*sanitizeResolvedSlides[^}]*\}\s*from\s*['"]@\/lib\/placeholders['"]/)
      expect(source).toContain('sanitizeResolvedSlides(')
    })
  }
})

describe('unresolved-placeholder logging — export-pdf/export-pptx share one gated boundary in lib/qbr-export.ts', () => {
  const helperSource = fs.readFileSync(path.join(ROOT, 'lib/qbr-export.ts'), 'utf8')

  it('contains one console.error call using a template-literal tag parameterized by format, covering both pdf and pptx', () => {
    expect(helperSource).toContain('console.error(`[unresolved-placeholder][export-${format}]`, qbr.id)')
  })

  it('is gated behind hadUnresolvedTokens, not unconditional', () => {
    const idx = helperSource.indexOf('console.error(`[unresolved-placeholder][export-${format}]`, qbr.id)')
    expect(idx).toBeGreaterThan(-1)
    const preceding = helperSource.slice(Math.max(0, idx - 200), idx)
    expect(preceding).toMatch(/if\s*\([^)]*hadUnresolvedTokens[^)]*\)/)
  })

  it('logs no client names, slide content, metrics, priorities, or recommendations on the logging line', () => {
    const loggingLines = helperSource.split('\n').filter(l => l.includes('[unresolved-placeholder]'))
    expect(loggingLines.length).toBeGreaterThan(0)
    for (const line of loggingLines) {
      expect(line).toContain('qbr.id')
      const lower = line.toLowerCase()
      for (const term of FORBIDDEN_TERMS) {
        if (term === 'placeholder]') continue
        expect(lower).not.toContain(term)
      }
    }
  })

  it('imports sanitizeResolvedSlides from lib/placeholders and calls it after resolveSlides()', () => {
    expect(helperSource).toMatch(/import\s*\{[^}]*sanitizeResolvedSlides[^}]*\}\s*from\s*['"]@\/lib\/placeholders['"]/)
    const resolveIdx = helperSource.indexOf('resolveSlides(')
    const sanitizeIdx = helperSource.indexOf('sanitizeResolvedSlides(')
    expect(resolveIdx).toBeGreaterThan(-1)
    expect(sanitizeIdx).toBeGreaterThan(resolveIdx)
  })

  it('neither export-pdf nor export-pptx routes duplicate this logging call themselves (single source of truth, never double-logged)', () => {
    const pdfSource = fs.readFileSync(path.join(ROOT, 'app/api/export-pdf/route.ts'), 'utf8')
    const pptxSource = fs.readFileSync(path.join(ROOT, 'app/api/export-pptx/route.ts'), 'utf8')
    expect(pdfSource).not.toContain('[unresolved-placeholder]')
    expect(pptxSource).not.toContain('[unresolved-placeholder]')
  })
})

// Hotfix: the onboarding Review screen (Screen 5) was the one boundary that
// rendered anchoredQbr.slides/summary raw, skipping resolveSlides/
// sanitizeResolvedSlides entirely — the exact defect that leaked literal
// {{healthScore}}/{{healthStatus}} tokens into Production. This boundary uses
// `anchoredQbr` (not `qbr`) as its local variable name, so it gets its own
// block rather than joining the generic describe.each(BOUNDARIES) above,
// which hardcodes `qbr.id`.
describe('unresolved-placeholder logging — onboarding Review screen (app/onboarding/[step]/page.tsx)', () => {
  const pageSource = fs.readFileSync(path.join(ROOT, 'app/onboarding/[step]/page.tsx'), 'utf8')

  it('contains its approved fixed context log call [unresolved-placeholder][onboarding-review]', () => {
    expect(pageSource).toContain("console.error('[unresolved-placeholder][onboarding-review]', anchoredQbr.id)")
  })

  it('is gated behind hadUnresolvedTokens, not unconditional', () => {
    const idx = pageSource.indexOf("console.error('[unresolved-placeholder][onboarding-review]', anchoredQbr.id)")
    expect(idx).toBeGreaterThan(-1)
    const preceding = pageSource.slice(Math.max(0, idx - 200), idx)
    expect(preceding).toMatch(/if\s*\([^)]*hadUnresolvedTokens[^)]*\)/)
  })

  it('does not contain any other boundary\'s fixed context tag', () => {
    for (const tag of BOUNDARIES.map(b => b.tag).concat(['export-pdf', 'export-pptx'])) {
      expect(pageSource).not.toContain(`[unresolved-placeholder][${tag}]`)
    }
  })

  it('logs no client names, slide content, metrics, priorities, or recommendations on the logging line', () => {
    const loggingLines = pageSource.split('\n').filter(l => l.includes('[unresolved-placeholder]'))
    expect(loggingLines.length).toBeGreaterThan(0)
    for (const line of loggingLines) {
      expect(line).toContain('anchoredQbr.id')
      const lower = line.toLowerCase()
      for (const term of FORBIDDEN_TERMS) {
        if (term === 'placeholder]') continue
        expect(lower).not.toContain(term)
      }
    }
  })

  it('imports buildPlaceholderContext/resolveSlides/sanitizeResolvedSlides from lib/placeholders, and resolves before sanitizing', () => {
    expect(pageSource).toMatch(/import\s*\{[^}]*buildPlaceholderContext[^}]*resolveSlides[^}]*sanitizeResolvedSlides[^}]*\}\s*from\s*['"]@\/lib\/placeholders['"]/)
    const resolveIdx = pageSource.indexOf('resolveSlides(')
    const sanitizeIdx = pageSource.indexOf('sanitizeResolvedSlides(')
    expect(resolveIdx).toBeGreaterThan(-1)
    expect(sanitizeIdx).toBeGreaterThan(resolveIdx)
  })

  it('never passes anchoredQbr.slides or anchoredQbr.summary directly to ReviewQbrScreen', () => {
    const reviewJsxMatch = pageSource.match(/<ReviewQbrScreen[\s\S]*?\/>/)
    expect(reviewJsxMatch).not.toBeNull()
    const jsx = reviewJsxMatch?.[0] ?? ''
    expect(jsx).not.toMatch(/slides=\{\s*\(?anchoredQbr\.slides/)
    expect(jsx).not.toMatch(/summary=\{anchoredQbr\.summary\}/)
    expect(jsx).not.toMatch(/summary=/)
    expect(jsx).toMatch(/slides=\{safeResolvedSlides\}/)
  })
})

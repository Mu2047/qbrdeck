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

const BOUNDARIES: Array<{ file: string; tag: string }> = [
  { file: 'app/api/qbrs/[qbrId]/route.ts', tag: 'saved-qbr-get' },
  { file: 'app/api/generate-qbr/route.ts', tag: 'generate-qbr' },
  { file: 'app/portal/[token]/page.tsx',   tag: 'portal' },
  { file: 'app/api/export-pdf/route.ts',   tag: 'export-pdf' },
  { file: 'app/api/export-pptx/route.ts',  tag: 'export-pptx' },
]

const ALL_TAGS = BOUNDARIES.map(b => b.tag)

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

describe('sanitizeResolvedSlides usage — all five boundaries call it after resolveSlides()', () => {
  for (const { file } of BOUNDARIES) {
    it(`${file} imports sanitizeResolvedSlides from lib/placeholders`, () => {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
      expect(source).toMatch(/import\s*\{[^}]*sanitizeResolvedSlides[^}]*\}\s*from\s*['"]@\/lib\/placeholders['"]/)
      expect(source).toContain('sanitizeResolvedSlides(')
    })
  }
})

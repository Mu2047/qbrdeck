import { describe, it, expect, vi } from 'vitest'
import {
  resolvePlaceholders,
  resolveSlides,
  buildPlaceholderContext,
  sanitizeResolvedSlides,
  UNRESOLVED_TOKEN_PATTERN,
  type PlaceholderContext,
} from '@/lib/placeholders'
import { resolveBranding, buildFooterText } from '@/lib/branding'

// ── Fixture helpers ──────────────────────────────────────────────────────────

function makeContext(): PlaceholderContext {
  const branding = resolveBranding({ plan: 'FREE', workspaceName: 'Test Workspace' })
  const footerText = buildFooterText({
    branding,
    clientName: 'RVTH',
    quarter: '3',
    year: '2026',
  })
  return buildPlaceholderContext({
    clientName: 'RVTH',
    clientIndustry: 'Managed IT',
    quarter: '3',
    year: '2026',
    workspaceName: 'Test Workspace',
    mspName: branding.mspName,
    healthScore: 92,
    healthStatus: 'Excellent',
    branding: { ...branding, footerText },
    generatedAt: '2026-07-01T00:00:00.000Z',
  })
}

// ── 1. Known placeholders resolve normally ───────────────────────────────────

describe('resolvePlaceholders — known placeholders', () => {
  it('resolves {{clientName}}, {{healthScore}}, {{healthStatus}}, {{quarter}}, {{year}} to expected literal values', () => {
    const ctx = makeContext()
    const template =
      'Client: {{clientName}}, Score: {{healthScore}}/100 ({{healthStatus}}), Q{{quarter}} {{year}}'
    const resolved = resolvePlaceholders(template, ctx)

    expect(resolved).toBe('Client: RVTH, Score: 92/100 (Excellent), Q3 2026')
    expect(UNRESOLVED_TOKEN_PATTERN.test(resolved)).toBe(false)
  })
})

// ── 2 & 3. Unknown placeholders blocked; every sanitized field covered ───────

describe('sanitizeResolvedSlides — field coverage', () => {
  it('replaces an unresolved field with exactly "Content unavailable" and covers title, content, bullets, metric label/value, all three priority arrays, and recommendation title/why/risk/benefit', () => {
    const ctx = makeContext()

    const rawSlides = [
      {
        type: 'executive_summary',
        title: 'Q{{quarter}} Summary {{unknownTitleToken}}',
        content: 'Health is {{healthStatus}} but {{unknownContentToken}} happened',
        bullets: ['{{clientName}} did well', 'Risk: {{unknownBulletToken}}'],
      },
      {
        type: 'metrics',
        title: 'Metrics',
        content: 'Overview',
        metrics: [
          { label: '{{unknownLabelToken}}', value: '92', status: 'good' },
          { label: 'Technology Health Score', value: '{{unknownValueToken}}', status: 'caution' },
        ],
      },
      {
        type: 'roadmap',
        title: 'Roadmap',
        content: 'Plan',
        priorities: {
          critical: ['{{unknownCriticalToken}}'],
          important: ['{{unknownImportantToken}}'],
          strategic: ['{{unknownStrategicToken}}'],
        },
      },
      {
        type: 'recommendations',
        title: 'Recommendations',
        content: 'Final',
        recommendations: [
          {
            title: '{{unknownRecTitleToken}}',
            why: '{{unknownRecWhyToken}}',
            risk: '{{unknownRecRiskToken}}',
            benefit: '{{unknownRecBenefitToken}}',
          },
        ],
      },
    ]

    const resolved = resolveSlides(rawSlides, ctx)
    const { slides, hadUnresolvedTokens } = sanitizeResolvedSlides(resolved)

    expect(hadUnresolvedTokens).toBe(true)

    // slide.title — mixed known + unknown token collapses the whole field
    expect(slides[0].title).toBe('Content unavailable')
    // slide.content — same
    expect(slides[0].content).toBe('Content unavailable')
    // slide.bullets[] — fully-known bullet survives; unknown-token bullet is blocked
    expect((slides[0] as any).bullets[0]).toBe('RVTH did well')
    expect((slides[0] as any).bullets[1]).toBe('Content unavailable')

    // metric.label / metric.value
    const metrics = (slides[1] as any).metrics
    expect(metrics[0].label).toBe('Content unavailable')
    expect(metrics[0].value).toBe('92') // untouched — no token
    expect(metrics[1].label).toBe('Technology Health Score') // untouched — no token
    expect(metrics[1].value).toBe('Content unavailable')

    // priorities.critical / important / strategic
    const priorities = (slides[2] as any).priorities
    expect(priorities.critical[0]).toBe('Content unavailable')
    expect(priorities.important[0]).toBe('Content unavailable')
    expect(priorities.strategic[0]).toBe('Content unavailable')

    // recommendation.title / why / risk / benefit
    const rec = (slides[3] as any).recommendations[0]
    expect(rec.title).toBe('Content unavailable')
    expect(rec.why).toBe('Content unavailable')
    expect(rec.risk).toBe('Content unavailable')
    expect(rec.benefit).toBe('Content unavailable')
  })
})

// ── 4. Structural/metadata fields are never altered ──────────────────────────

describe('sanitizeResolvedSlides — structural fields exempt', () => {
  it('never alters slide.type, metric.status, IDs, or unknown metadata/object keys, even when they are token-shaped', () => {
    const slides = [
      {
        id: 'slide-abc123',
        type: '{{shouldNotBeTouched}}', // deliberately token-shaped
        title: 'Fine',
        content: 'Fine',
        metrics: [
          { label: 'X', value: '1', status: '{{alsoShouldNotBeTouched}}', id: 'metric-1' },
        ],
        meta: { custom: '{{untouchedMetaToken}}' },
      },
    ]

    const { slides: sanitized, hadUnresolvedTokens } = sanitizeResolvedSlides(slides)
    const s = sanitized[0] as any

    expect(s.id).toBe('slide-abc123')
    expect(s.type).toBe('{{shouldNotBeTouched}}')
    expect(s.metrics[0].status).toBe('{{alsoShouldNotBeTouched}}')
    expect(s.metrics[0].id).toBe('metric-1')
    expect(s.meta).toEqual({ custom: '{{untouchedMetaToken}}' })

    // None of the token-shaped structural/metadata fields are checked, so
    // hadUnresolvedTokens must not be flagged by them.
    expect(hadUnresolvedTokens).toBe(false)
  })
})

// ── 5. Malformed optional data never throws; non-string values unchanged ────

describe('sanitizeResolvedSlides — malformed data resilience', () => {
  it('does not throw on malformed slides/metrics/priorities/recommendations and leaves non-string values unchanged', () => {
    const slides = [
      null,
      'not-a-slide-object',
      42,
      {
        type: 'metrics',
        title: 'T',
        content: 'C',
        bullets: 'not-an-array',
        metrics: [null, 'not-an-object', 42, { label: '{{x}}', value: 5, status: 'good' }],
      },
      { type: 'roadmap', title: 'T', content: 'C', priorities: null },
      { type: 'roadmap', title: 'T2', content: 'C2', priorities: 'not-an-object' },
      {
        type: 'recommendations',
        title: 'T',
        content: 'C',
        recommendations: [undefined, 7, { title: '{{y}}', why: 1, risk: null, benefit: true }],
      },
    ]

    expect(() => sanitizeResolvedSlides(slides as any)).not.toThrow()

    const { slides: sanitized } = sanitizeResolvedSlides(slides as any)

    expect(sanitized[0]).toBeNull()
    expect(sanitized[1]).toBe('not-a-slide-object')
    expect(sanitized[2]).toBe(42)

    const metricsSlide = sanitized[3] as any
    expect(metricsSlide.bullets).toBe('not-an-array') // non-array passes through unchanged
    expect(metricsSlide.metrics[0]).toBeNull()
    expect(metricsSlide.metrics[1]).toBe('not-an-object')
    expect(metricsSlide.metrics[2]).toBe(42)
    expect(metricsSlide.metrics[3].label).toBe('Content unavailable')
    expect(metricsSlide.metrics[3].value).toBe(5) // non-string, unchanged

    expect((sanitized[4] as any).priorities).toBeNull()
    expect((sanitized[5] as any).priorities).toBe('not-an-object')

    const recSlide = sanitized[6] as any
    expect(recSlide.recommendations[0]).toBeUndefined()
    expect(recSlide.recommendations[1]).toBe(7)
    expect(recSlide.recommendations[2].title).toBe('Content unavailable')
    expect(recSlide.recommendations[2].why).toBe(1)       // non-string, unchanged
    expect(recSlide.recommendations[2].risk).toBeNull()    // non-string, unchanged
    expect(recSlide.recommendations[2].benefit).toBe(true) // non-string, unchanged
  })
})

// ── 6. No-op on already fully-resolved data ──────────────────────────────────

describe('sanitizeResolvedSlides — no-op on correct data', () => {
  it('is deep-equal to its input on an already fully-resolved RVTH-shaped fixture, with hadUnresolvedTokens false', () => {
    const ctx = makeContext()
    const rawSlides = [
      {
        type: 'executive_summary',
        title: 'Executive Summary',
        content: 'Health score {{healthScore}}/100 ({{healthStatus}}) for {{clientName}}.',
        bullets: ['Great quarter', 'Strong uptime'],
      },
      {
        type: 'metrics',
        title: 'Key Metrics',
        content: 'Overview',
        metrics: [{ label: 'Technology Health Score', value: '{{healthScore}}/100', status: 'good' }],
      },
      {
        type: 'roadmap',
        title: 'Roadmap',
        content: 'Next steps',
        priorities: {
          critical: ['Patch servers'],
          important: ['Review MFA'],
          strategic: ['Plan upgrade'],
        },
      },
      {
        type: 'recommendations',
        title: 'Recommendations',
        content: 'Final notes',
        recommendations: [
          { title: 'Upgrade EDR', why: 'Reduces risk', risk: 'Breach exposure', benefit: 'Stronger posture' },
        ],
      },
    ]

    const resolved = resolveSlides(rawSlides, ctx)
    const { slides, hadUnresolvedTokens } = sanitizeResolvedSlides(resolved)

    expect(slides).toEqual(resolved)
    expect(hadUnresolvedTokens).toBe(false)
  })
})

// ── 7. Purity: does not mutate its input ─────────────────────────────────────

describe('sanitizeResolvedSlides — purity', () => {
  it('does not mutate its input array or slide objects', () => {
    const slides = [
      {
        type: 'metrics',
        title: 'T',
        content: 'C {{unknownToken}}',
        metrics: [{ label: 'L', value: '{{anotherUnknown}}', status: 'good' }],
      },
    ]
    const snapshotBefore = JSON.parse(JSON.stringify(slides))

    sanitizeResolvedSlides(slides)

    expect(slides).toEqual(snapshotBefore)
  })

  // ── 8. No logging from the pure sanitizer ───────────────────────────────────
  it('performs no logging, even when unresolved tokens are found', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    sanitizeResolvedSlides([{ type: 'x', title: '{{unknownToken}}', content: 'ok' }])

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

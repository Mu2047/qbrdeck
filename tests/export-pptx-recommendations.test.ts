import { describe, it, expect, vi } from 'vitest'
import type pptxgen from 'pptxgenjs'
import {
  addRecommendationsSlide,
  ACCENT_BAR_Y,
  REC_CARD_FIRST_Y,
  REC_CARD_HEIGHT,
  REC_CARD_STRIDE,
  REC_CARD_TITLE_Y_OFFSET,
  REC_CARD_TITLE_HEIGHT,
  REC_CARD_DETAIL_Y_OFFSET,
  REC_CARD_DETAIL_REGION_HEIGHT,
  REC_CARD_DETAIL_FONT_SIZE,
  REC_CARD_MIN_BOTTOM_CLEARANCE,
} from '@/lib/export-pptx'
import { sanitizeResolvedSlides } from '@/lib/placeholders'
import type { QBRSlide } from '@/lib/anthropic'

// A fake pptxgenjs Slide/Presentation pair — records every addText/addShape
// call instead of touching the real pptxgenjs rendering pipeline. This lets
// the tests inspect exactly what content and geometry reach the "renderer"
// without generating/parsing a real .pptx binary.
function createFakePptx() {
  const addTextCalls: Array<{ text: string | Array<{ text?: string; options?: any }>; options: any }> = []
  const addShapeCalls: Array<{ shapeName: string; options: any }> = []

  const fakeSlide: any = {
    addText: vi.fn((text: any, options: any) => {
      addTextCalls.push({ text, options })
      return fakeSlide
    }),
    addShape: vi.fn((shapeName: string, options: any) => {
      addShapeCalls.push({ shapeName, options })
      return fakeSlide
    }),
    addImage: vi.fn(() => fakeSlide),
  }

  const fakePptx: any = {
    ShapeType: { rect: 'rect', roundRect: 'roundRect' },
    addSlide: vi.fn(() => fakeSlide),
  }

  return { fakePptx, fakeSlide, addTextCalls, addShapeCalls }
}

// Flattens every string of text a single addText() call could put on the
// slide, whether it was called with a plain string or a TextProps[] array of
// runs (the multiline-region shape).
function textStringsOf(call: { text: string | Array<{ text?: string }> }): string[] {
  return Array.isArray(call.text) ? call.text.map(run => run.text ?? '') : [call.text]
}

function isDetailRegionCall(call: { text: string | Array<{ text?: string }> }): boolean {
  return Array.isArray(call.text) && call.text.length === 3
}

function makeRecommendationsSlide(overrides?: Partial<QBRSlide>): QBRSlide {
  return {
    title: 'Strategic Recommendations',
    type: 'recommendations',
    content: 'Recommendations intro.',
    recommendations: [
      { title: 'Modernize backup strategy', why: 'Current backups are untested.', risk: 'can lead to significant recovery costs and downtime', benefit: 'Faster, verified recovery.' },
      { title: 'Adopt MFA everywhere', why: 'Credential theft is the top attack vector.', risk: 'may result in unauthorized account access', benefit: 'Substantially reduced breach risk.' },
      { title: 'Refresh aging endpoints', why: 'Hardware is past its useful life.', risk: 'may result in unplanned downtime and higher support costs', benefit: 'Improved reliability and performance.' },
    ],
    ...overrides,
  } as QBRSlide
}

describe('addRecommendationsSlide — field parity with PDF', () => {
  it('draws exactly three recommendation cards', () => {
    const { fakePptx, addShapeCalls } = createFakePptx()
    addRecommendationsSlide(fakePptx as unknown as pptxgen, makeRecommendationsSlide(), 'Test MSP', null, false)

    const cardShapes = addShapeCalls.filter(c => c.shapeName === 'roundRect')
    expect(cardShapes).toHaveLength(3)
  })

  it('renders all three recommendation titles in their own text box', () => {
    const { fakePptx, addTextCalls } = createFakePptx()
    const slide = makeRecommendationsSlide()
    addRecommendationsSlide(fakePptx as unknown as pptxgen, slide, 'Test MSP', null, false)

    slide.recommendations!.forEach((rec, i) => {
      const found = addTextCalls.some(c => typeof c.text === 'string' && c.text === `${i + 1}. ${rec.title}`)
      expect(found).toBe(true)
    })
  })

  it('creates exactly one bounded multiline detail region per card', () => {
    const { fakePptx, addTextCalls } = createFakePptx()
    addRecommendationsSlide(fakePptx as unknown as pptxgen, makeRecommendationsSlide(), 'Test MSP', null, false)

    const detailRegionCalls = addTextCalls.filter(isDetailRegionCall)
    expect(detailRegionCalls).toHaveLength(3)
  })

  it('includes all three labeled fields — why, risk, and benefit — inside that one region', () => {
    const { fakePptx, addTextCalls } = createFakePptx()
    const slide = makeRecommendationsSlide()
    addRecommendationsSlide(fakePptx as unknown as pptxgen, slide, 'Test MSP', null, false)

    const detailRegionCalls = addTextCalls.filter(isDetailRegionCall)
    slide.recommendations!.forEach((rec, i) => {
      const strings = textStringsOf(detailRegionCalls[i])
      expect(strings).toContain(`Why it matters: ${rec.why}`)
      expect(strings).toContain(`Risk if ignored: ${rec.risk}`)
      expect(strings).toContain(`Expected benefit: ${rec.benefit}`)
    })
  })

  it('renders each distinct risk value exactly once', () => {
    const { fakePptx, addTextCalls } = createFakePptx()
    const slide = makeRecommendationsSlide()
    addRecommendationsSlide(fakePptx as unknown as pptxgen, slide, 'Test MSP', null, false)

    const allStrings = addTextCalls.flatMap(textStringsOf)
    slide.recommendations!.forEach(rec => {
      const matches = allStrings.filter(s => s === `Risk if ignored: ${rec.risk}`)
      expect(matches).toHaveLength(1)
    })
  })

  it('uses a detail font size of at least 8.5pt', () => {
    const { fakePptx, addTextCalls } = createFakePptx()
    addRecommendationsSlide(fakePptx as unknown as pptxgen, makeRecommendationsSlide(), 'Test MSP', null, false)

    const detailRegionCalls = addTextCalls.filter(isDetailRegionCall)
    expect(detailRegionCalls).toHaveLength(3)
    detailRegionCalls.forEach(c => {
      expect(c.options.fontSize).toBeGreaterThanOrEqual(8.5)
    })
    expect(REC_CARD_DETAIL_FONT_SIZE).toBeGreaterThanOrEqual(8.5)
  })

  it('keeps each detail region inside its own card, below the title', () => {
    const { fakePptx, addTextCalls, addShapeCalls } = createFakePptx()
    addRecommendationsSlide(fakePptx as unknown as pptxgen, makeRecommendationsSlide(), 'Test MSP', null, false)

    const cardShapes = addShapeCalls.filter(c => c.shapeName === 'roundRect')
    const titleCalls = addTextCalls.filter(c => typeof c.text === 'string' && /^\d\. /.test(c.text))
    const detailRegionCalls = addTextCalls.filter(isDetailRegionCall)

    cardShapes.forEach((card, i) => {
      const cardTop = card.options.y
      const cardBottom = card.options.y + card.options.h
      const title = titleCalls[i]
      const detail = detailRegionCalls[i]

      // Title starts inside the card and ends before the detail region starts.
      expect(title.options.y).toBeGreaterThanOrEqual(cardTop)
      expect(title.options.y + title.options.h).toBeLessThanOrEqual(detail.options.y)

      // Detail region starts inside the card and ends at or before its bottom.
      expect(detail.options.y).toBeGreaterThanOrEqual(cardTop)
      expect(detail.options.y + detail.options.h).toBeLessThanOrEqual(cardBottom)
    })
  })

  it('never lets two card rectangles overlap', () => {
    const { fakePptx, addShapeCalls } = createFakePptx()
    addRecommendationsSlide(fakePptx as unknown as pptxgen, makeRecommendationsSlide(), 'Test MSP', null, false)

    const cardShapes = addShapeCalls.filter(c => c.shapeName === 'roundRect')
    for (let i = 0; i < cardShapes.length - 1; i++) {
      const thisBottom = cardShapes[i].options.y + cardShapes[i].options.h
      const nextTop = cardShapes[i + 1].options.y
      expect(thisBottom).toBeLessThanOrEqual(nextTop)
    }

    // Also true of the geometry constants directly (stride strictly exceeds height).
    expect(REC_CARD_STRIDE).toBeGreaterThan(REC_CARD_HEIGHT)
  })

  it('preserves the existing red, amber, and blue card styling by index', () => {
    const { fakePptx, addShapeCalls } = createFakePptx()
    addRecommendationsSlide(fakePptx as unknown as pptxgen, makeRecommendationsSlide(), 'Test MSP', null, false)

    const cardShapes = addShapeCalls.filter(c => c.shapeName === 'roundRect')
    expect(cardShapes[0].options.fill.color).toBe('FEF2F2')
    expect(cardShapes[0].options.line.color).toBe('DC2626')
    expect(cardShapes[1].options.fill.color).toBe('FFFBEB')
    expect(cardShapes[1].options.line.color).toBe('D97706')
    expect(cardShapes[2].options.fill.color).toBe('EFF6FF')
    expect(cardShapes[2].options.line.color).toBe('2563EB')
  })

  it('keeps the third card at least 0.15 inches clear of the footer accent bar', () => {
    const thirdCardBottom = REC_CARD_FIRST_Y + 2 * REC_CARD_STRIDE + REC_CARD_HEIGHT
    const clearance = ACCENT_BAR_Y - thirdCardBottom
    expect(clearance).toBeGreaterThanOrEqual(REC_CARD_MIN_BOTTOM_CLEARANCE)
  })

  it('sanity-checks the internal per-card offsets are self-consistent (no internal overlap)', () => {
    // Title must end before the detail region begins.
    expect(REC_CARD_TITLE_Y_OFFSET + REC_CARD_TITLE_HEIGHT).toBeLessThanOrEqual(REC_CARD_DETAIL_Y_OFFSET)
    // Detail region must end at or before the card's own bottom edge.
    expect(REC_CARD_DETAIL_Y_OFFSET + REC_CARD_DETAIL_REGION_HEIGHT).toBeLessThanOrEqual(REC_CARD_HEIGHT)
  })
})

describe('addRecommendationsSlide — unresolved placeholder regression', () => {
  it('renders "Content unavailable" for an unresolved risk token, with no raw {{...}} reaching added slide text', () => {
    const rawSlide = {
      title: 'Strategic Recommendations',
      type: 'recommendations',
      content: 'Recommendations intro.',
      recommendations: [
        { title: 'Rec A', why: 'why A', risk: '{{unresolvedToken}}', benefit: 'benefit A' },
        { title: 'Rec B', why: 'why B', risk: 'risk B', benefit: 'benefit B' },
        { title: 'Rec C', why: 'why C', risk: 'risk C', benefit: 'benefit C' },
      ],
    }

    const { slides: sanitizedSlides, hadUnresolvedTokens } = sanitizeResolvedSlides([rawSlide])
    expect(hadUnresolvedTokens).toBe(true)

    const { fakePptx, addTextCalls } = createFakePptx()
    addRecommendationsSlide(
      fakePptx as unknown as pptxgen,
      sanitizedSlides[0] as unknown as QBRSlide,
      'Test MSP',
      null,
      false
    )

    const allStrings = addTextCalls.flatMap(textStringsOf)
    expect(allStrings).toContain('Risk if ignored: Content unavailable')

    const anyUnresolvedTokenReachedSlide = allStrings.some(s => /\{\{[^}]+\}\}/.test(s))
    expect(anyUnresolvedTokenReachedSlide).toBe(false)
  })
})

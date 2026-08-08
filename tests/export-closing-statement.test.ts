import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { CONFIDENTIALITY_STATEMENT } from '@/lib/export-constants'

// ── Fake pptxgenjs module (top level — vi.mock is hoisted above all imports,
// so its factory and the buffers it closes over must live at module scope,
// following the fake-pptxgen precedent from tests/export-pptx-recommendations.test.ts) ──
let recordedAddTextCalls: Array<{ text: string; options: any }> = []
let recordedAddShapeCalls: Array<{ shapeName: string; options: any }> = []
let recordedAddImageCalls: Array<any> = []

vi.mock('pptxgenjs', () => {
  const ShapeType = { rect: 'rect', roundRect: 'roundRect' }
  function makeFakeSlide() {
    const slide: any = {}
    slide.addText = vi.fn((text: any, options: any) => {
      recordedAddTextCalls.push({ text, options })
      return slide
    })
    slide.addShape = vi.fn((shapeName: string, options: any) => {
      recordedAddShapeCalls.push({ shapeName, options })
      return slide
    })
    slide.addImage = vi.fn((options: any) => {
      recordedAddImageCalls.push(options)
      return slide
    })
    return slide
  }
  function FakePptx(this: any) {
    this.ShapeType = ShapeType
    this.addSlide = vi.fn(() => makeFakeSlide())
    this.write = vi.fn(async () => Buffer.from(''))
  }
  return { default: FakePptx }
})

// ── Source-contract checks ──────────────────────────────────────────────────
// These read the exporter source files directly rather than executing a full
// PDF/PPTX render. They are static assertions about imports and literals, not
// runtime rendering tests.

const pdfSource = readFileSync(path.resolve(__dirname, '../lib/export-pdf.tsx'), 'utf8')
const pptxSource = readFileSync(path.resolve(__dirname, '../lib/export-pptx.ts'), 'utf8')

describe('shared source of truth', () => {
  it('lib/export-pdf.tsx imports CONFIDENTIALITY_STATEMENT from export-constants', () => {
    expect(pdfSource).toMatch(/import\s*\{\s*CONFIDENTIALITY_STATEMENT\s*\}\s*from\s*['"]@\/lib\/export-constants['"]/)
  })

  it('lib/export-pptx.ts imports CONFIDENTIALITY_STATEMENT from export-constants', () => {
    expect(pptxSource).toMatch(/import\s*\{\s*CONFIDENTIALITY_STATEMENT\s*\}\s*from\s*['"]@\/lib\/export-constants['"]/)
  })

  it('the PDF exporter no longer contains its own independent confidentiality literal', () => {
    expect(pdfSource).not.toMatch(/and is confidential\.?"/)
  })

  it('the PPTX exporter no longer contains an abbreviated/independent confidentiality literal', () => {
    // The old closing slide never mentioned "confidential" at all; it must now
    // only reach that word via the shared constant, not a re-typed literal.
    expect(pptxSource).not.toMatch(/prepared exclusively for.*and is confidential/)
  })
})

describe('CONFIDENTIALITY_STATEMENT exact value', () => {
  it('produces the known full PDF confidentiality sentence verbatim, given a client name', () => {
    expect(CONFIDENTIALITY_STATEMENT('Acme Corp')).toBe(
      'This report was prepared exclusively for Acme Corp and is confidential.'
    )
  })

  it('preserves punctuation and whitespace exactly, including no leading/trailing padding', () => {
    const value = CONFIDENTIALITY_STATEMENT('Acme Corp')
    expect(value).toBe(value.trim())
    expect(value.startsWith('This report was prepared exclusively for ')).toBe(true)
    expect(value.endsWith(' and is confidential.')).toBe(true)
  })
})

describe('PDF closing confidentiality text — regression (source/contract assertion, not a rendered-PDF test)', () => {
  // This does not render an actual PDF. It reconstructs the exact expression
  // string from export-pdf.tsx's ClosingPage body and checks it against the
  // known pre-extraction full string, proving the visible text is unchanged.
  it('resolves to the exact same known full string as before extraction', () => {
    const quarter = '3'
    const clientName = 'Acme Corp'
    const sanitize = (s: string) => s // no special characters in this fixture; sanitize is identity here
    const nextQuarter = Number(quarter) === 4 ? 1 : Number(quarter) + 1

    const preExtractionString =
      "Let's schedule your Q" + nextQuarter + " planning session to build on this quarter's progress.\n\nThis report was prepared exclusively for " + sanitize(clientName) + " and is confidential."

    const postExtractionString =
      "Let's schedule your Q" + nextQuarter + " planning session to build on this quarter's progress.\n\n" + CONFIDENTIALITY_STATEMENT(sanitize(clientName))

    expect(postExtractionString).toBe(preExtractionString)
  })
})

describe('PPTX closing slide — fake-pptxgen harness', () => {
  // Following the fake-pptxgen precedent from tests/export-pptx-recommendations.test.ts:
  // pptxgenjs is mocked so generatePPTX runs its real, unmodified logic (including
  // the new closing-slide confidentiality line) against a recording fake instead of
  // the real rendering/zip pipeline. This exercises the actual generatePPTX code path,
  // not a re-implementation of it — but it is still not a real .pptx file being parsed.
  let addTextCalls: Array<{ text: string; options: any }>
  let addShapeCalls: Array<{ shapeName: string; options: any }>

  beforeEach(() => {
    recordedAddTextCalls = []
    recordedAddShapeCalls = []
    recordedAddImageCalls = []
    addTextCalls = recordedAddTextCalls
    addShapeCalls = recordedAddShapeCalls
  })

  it('receives the full CONFIDENTIALITY_STATEMENT on the closing slide, not the prior abbreviated text', async () => {
    const { generatePPTX } = await import('@/lib/export-pptx')
    await generatePPTX(
      [{ title: 'Executive Summary', type: 'executive_summary', content: 'All good.' } as any],
      'Acme Corp',
      '3',
      2026,
      'Test MSP',
      undefined,
      undefined,
      false
    )

    const expected = CONFIDENTIALITY_STATEMENT('Acme Corp')
    const found = addTextCalls.find(c => c.text === expected)
    expect(found).toBeDefined()

    // Prior abbreviated closing slide had no confidentiality mention at all.
    const anyOldAbbreviatedOnly = addTextCalls.some(
      c => typeof c.text === 'string' && /^Let's schedule your Q\d planning session\.$/.test(c.text)
    )
    expect(anyOldAbbreviatedOnly).toBe(true) // scheduling line still present, unchanged
    expect(addTextCalls.some(c => c.text.includes('confidential'))).toBe(true)
  })

  it('keeps the confidentiality text box geometry fixed and does not move the scheduling line, title, subtitle, or gold bar', async () => {
    const { generatePPTX } = await import('@/lib/export-pptx')
    await generatePPTX(
      [{ title: 'Executive Summary', type: 'executive_summary', content: 'All good.' } as any],
      'Acme Corp',
      '3',
      2026,
      'Test MSP',
      undefined,
      undefined,
      false
    )

    const expected = CONFIDENTIALITY_STATEMENT('Acme Corp')
    const confidentialityCall = addTextCalls.find(c => c.text === expected)
    expect(confidentialityCall?.options).toMatchObject({
      x: 0.8, y: 4.0, w: 8.4, h: 0.4, color: '666666', fontSize: 10, charSpacing: 1, fontFace: 'Calibri',
    })

    const schedulingCall = addTextCalls.find(
      c => typeof c.text === 'string' && /^Let's schedule your Q\d planning session\.$/.test(c.text)
    )
    expect(schedulingCall?.options).toMatchObject({ x: 0.8, y: 3.6, w: 8.4, h: 0.4, color: 'AAAAAA', fontSize: 13, fontFace: 'Calibri' })

    const titleCall = addTextCalls.find(c => c.text === 'Thank you for your partnership.')
    expect(titleCall?.options).toMatchObject({ x: 0.8, y: 1.6, w: 8.4, h: 1.2, color: 'FFFFFF', fontSize: 34, bold: true, fontFace: 'Calibri' })

    const goldBarCall = addShapeCalls.find(c => c.shapeName === 'rect' && c.options.y === 4.8)
    expect(goldBarCall?.options).toMatchObject({ x: 0, y: 4.8, w: '100%', h: 0.08 })
  })
})

describe('placeholder safety', () => {
  it('CONFIDENTIALITY_STATEMENT contains no unresolved {{...}} token', () => {
    expect(CONFIDENTIALITY_STATEMENT('Acme Corp')).not.toMatch(/\{\{[^}]+\}\}/)
  })
})

describe('newline shape', () => {
  it('CONFIDENTIALITY_STATEMENT is a single paragraph with no internal newlines or carriage returns', () => {
    const value = CONFIDENTIALITY_STATEMENT('Acme Corp')
    expect(value).not.toContain('\n')
    expect(value).not.toContain('\r')
  })
})

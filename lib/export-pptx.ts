import pptxgen from 'pptxgenjs'
import type { QBRSlide, QBRInput } from '@/lib/anthropic'
import { computeHealthScore } from '@/lib/anthropic'

const NAVY  = '0a1634'
const GOLD  = 'c9a02a'
const WHITE = 'FFFFFF'
const MID_GRAY = '6B7280'
const SUCCESS = '16A34A'
const WARNING = 'D97706'
const DANGER  = 'DC2626'
const LIGHT_GRAY = 'F4F5F7'

// ── Logo fetcher ─────────────────────────────────────────────────────────────
interface LogoData { base64: string; extension: string }

async function fetchLogo(url: string): Promise<LogoData | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buffer = await res.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')
    const contentType = res.headers.get('content-type') ?? 'image/png'
    const extension = contentType.split('/')[1]?.split(';')[0] ?? 'png'
    return { base64, extension }
  } catch { return null }
}

// ── Header bar ───────────────────────────────────────────────────────────────
function addHeaderBar(slide: pptxgen.Slide, title: string, mspName: string, pptx: pptxgen, logo: LogoData | null, isWhiteLabel = false) {
  slide.background = { color: WHITE }
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.9, fill: { color: NAVY }, line: { color: NAVY } })
  slide.addText(title.toUpperCase(), { x: 0.5, y: 0.15, w: 7, h: 0.6, color: WHITE, fontSize: 18, bold: true, charSpacing: 1, fontFace: 'Calibri' })
  if (logo) {
    slide.addShape(pptx.ShapeType.roundRect, { x: 7.6, y: 0.12, w: 2.0, h: 0.66, fill: { color: WHITE }, line: { color: WHITE }, rectRadius: 0.04 })
    slide.addImage({ data: `image/${logo.extension};base64,${logo.base64}`, x: 7.68, y: 0.15, w: 1.84, h: 0.6, sizing: { type: 'contain', w: 1.84, h: 0.6 } })
  } else if (isWhiteLabel) {
    slide.addText(mspName, { x: 7.5, y: 0.28, w: 2.2, h: 0.35, color: GOLD, fontSize: 9, align: 'right', fontFace: 'Calibri' })
  }
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 5.1, w: '100%', h: 0.04, fill: { color: GOLD }, line: { color: GOLD } })
}

// ── Main export ──────────────────────────────────────────────────────────────
export async function generatePPTX(
  slides: QBRSlide[],
  clientName: string,
  quarter: string,
  year: number,
  mspName = 'QBR Deck',
  logoUrl?: string,
  input?: QBRInput,
  isWhiteLabel = false
): Promise<Buffer> {

  // Normalize client name in all slide text — catches any stored typos from original generation
  const normalize = (text: string) => text.replace(/\{\{clientName\}\}/g, clientName)
  slides = slides.map(slide => ({
    ...slide,
    content: slide.content ? normalize(slide.content) : slide.content,
    bullets: slide.bullets?.map(normalize),
    recommendations: slide.recommendations?.map(rec => ({
      ...rec,
      why:     normalize(rec.why     ?? ''),
      risk:    normalize(rec.risk    ?? ''),
      benefit: normalize(rec.benefit ?? ''),
      title:   normalize(rec.title   ?? ''),
    })),
    priorities: slide.priorities ? {
      critical:  slide.priorities.critical?.map(normalize)  ?? [],
      important: slide.priorities.important?.map(normalize) ?? [],
      strategic: slide.priorities.strategic?.map(normalize) ?? [],
    } : undefined,
  }))
  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_16x9'
  pptx.title  = `${clientName} QBR Q${quarter} ${year}`
  pptx.author = mspName

  const logo   = logoUrl ? await fetchLogo(logoUrl) : null
  const health = input ? computeHealthScore(input) : null

  // ── Cover ──────────────────────────────────────────────────────────────────
  const cover = pptx.addSlide()
  cover.background = { color: NAVY }
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 4.8, w: '100%', h: 0.08, fill: { color: GOLD }, line: { color: GOLD } })
  if (logo) {
    cover.addImage({ data: `image/${logo.extension};base64,${logo.base64}`, x: 7.8, y: 0.35, w: 1.8, h: 0.7, sizing: { type: 'contain', w: 1.8, h: 0.7 } })
  }
  cover.addText('QUARTERLY BUSINESS REVIEW', { x: 0.8, y: 1.2, w: 8.4, h: 0.5, color: GOLD, fontSize: 11, charSpacing: 4, fontFace: 'Calibri' })
  cover.addText(clientName, { x: 0.8, y: 1.8, w: 8.4, h: 1.4, color: WHITE, fontSize: 48, bold: true, fontFace: 'Calibri' })
  cover.addText(`Q${quarter} ${year}`, { x: 0.8, y: 3.3, w: 4, h: 0.6, color: GOLD, fontSize: 22, fontFace: 'Calibri' })

  // Health score on cover
  if (health) {
    const scoreColor = health.score >= 90 ? SUCCESS : health.score >= 70 ? WARNING : DANGER
    cover.addShape(pptx.ShapeType.roundRect, { x: 7.2, y: 2.8, w: 2.2, h: 1.2, fill: { color: '0d1f3c' }, line: { color: GOLD, pt: 1 }, rectRadius: 0.08 })
    cover.addText('TECH HEALTH', { x: 7.2, y: 2.85, w: 2.2, h: 0.3, color: GOLD, fontSize: 8, align: 'center', charSpacing: 1, fontFace: 'Calibri' })
    cover.addText(`${health.score}`, { x: 7.2, y: 3.1, w: 2.2, h: 0.55, color: WHITE, fontSize: 32, bold: true, align: 'center', fontFace: 'Calibri' })
    cover.addText(`/ 100  ${health.status}`, { x: 7.2, y: 3.62, w: 2.2, h: 0.25, color: scoreColor, fontSize: 9, align: 'center', fontFace: 'Calibri' })
  }

  cover.addText(isWhiteLabel ? `Prepared by ${mspName}` : 'Prepared with QBR Deck', { x: 0.8, y: 5.1, w: 8.4, h: 0.4, color: 'AAAAAA', fontSize: 13, fontFace: 'Calibri' })
  cover.addText(`CONFIDENTIAL  |  FOR ${clientName.toUpperCase()} USE ONLY`, { x: 0.8, y: 5.6, w: 8.4, h: 0.3, color: '666666', fontSize: 10, charSpacing: 1, fontFace: 'Calibri' })

  // ── Content slides ─────────────────────────────────────────────────────────
  for (const slide of slides) {
    switch (slide.type) {
      case 'metrics':       addMetricsSlide(pptx, slide, mspName, logo, isWhiteLabel); break
      case 'roadmap':       addRoadmapSlide(pptx, slide, mspName, logo, isWhiteLabel); break
      case 'recommendations': addRecommendationsSlide(pptx, slide, mspName, logo, isWhiteLabel); break
      case 'business_impact': addBulletSlide(pptx, slide, mspName, logo, true, isWhiteLabel); break
      default:              addBulletSlide(pptx, slide, mspName, logo, false, isWhiteLabel); break
    }
  }

  // ── Closing slide ──────────────────────────────────────────────────────────
  const ty = pptx.addSlide()
  ty.background = { color: NAVY }
  ty.addShape(pptx.ShapeType.rect, { x: 0, y: 4.8, w: '100%', h: 0.08, fill: { color: GOLD }, line: { color: GOLD } })
  if (logo) {
    ty.addImage({ data: `image/${logo.extension};base64,${logo.base64}`, x: 7.8, y: 0.35, w: 1.8, h: 0.7, sizing: { type: 'contain', w: 1.8, h: 0.7 } })
  }
  ty.addText('Thank you for your partnership.', { x: 0.8, y: 1.6, w: 8.4, h: 1.2, color: WHITE, fontSize: 34, bold: true, fontFace: 'Calibri' })
  ty.addText(isWhiteLabel ? `${mspName} — Your Strategic IT Partner` : 'Generated with QBR Deck', { x: 0.8, y: 3.0, w: 8.4, h: 0.5, color: GOLD, fontSize: 16, fontFace: 'Calibri' })
  ty.addText(`Let's schedule your Q${Number(quarter) === 4 ? 1 : Number(quarter) + 1} planning session.`, { x: 0.8, y: 3.6, w: 8.4, h: 0.4, color: 'AAAAAA', fontSize: 13, fontFace: 'Calibri' })
  const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer
  return buffer
}

// ── Bullet slide (executive summary, wins, risks, business impact) ────────────
function addBulletSlide(pptx: pptxgen, slide: QBRSlide, mspName: string, logo: LogoData | null, highlight: boolean, isWhiteLabel = false) {
  const s = pptx.addSlide()
  addHeaderBar(s, slide.title, mspName, pptx, logo, isWhiteLabel)

  s.addText(slide.content, { x: 0.5, y: 1.0, w: 9, h: 0.8, color: '374151', fontSize: 13, fontFace: 'Calibri', breakLine: true })

  if (slide.bullets && slide.bullets.length > 0) {
    const bulletY = 1.95
    const bulletH = (4.9 - bulletY) / slide.bullets.length

    slide.bullets.forEach((bullet, i) => {
      const cardBg = highlight ? (i % 2 === 0 ? 'EFF6FF' : 'F0FDF4') : WHITE
      if (highlight) {
        s.addShape(pptx.ShapeType.roundRect, { x: 0.4, y: bulletY + i * bulletH, w: 9.2, h: bulletH * 0.82, fill: { color: cardBg }, line: { color: 'E5E7EB', pt: 0.5 }, rectRadius: 0.05 })
      }
      s.addShape(pptx.ShapeType.rect, { x: 0.5, y: bulletY + i * bulletH + 0.05, w: 0.04, h: bulletH * 0.55, fill: { color: GOLD }, line: { color: GOLD } })
      s.addText(bullet, { x: 0.75, y: bulletY + i * bulletH, w: 8.8, h: bulletH * 0.75, color: '111827', fontSize: 12, fontFace: 'Calibri', breakLine: true, valign: 'middle' })
    })
  }
}

// ── Metrics slide ─────────────────────────────────────────────────────────────
function addMetricsSlide(pptx: pptxgen, slide: QBRSlide, mspName: string, logo: LogoData | null, isWhiteLabel = false) {
  const s = pptx.addSlide()
  addHeaderBar(s, slide.title, mspName, pptx, logo, isWhiteLabel)
  s.addText(slide.content, { x: 0.5, y: 1.0, w: 9, h: 0.45, color: MID_GRAY, fontSize: 12, fontFace: 'Calibri' })

  const metrics = slide.metrics ?? []
  const cols = 3
  const cardW = 2.9
  const cardH = 1.15
  const startX = 0.4
  const startY = 1.55
  const gapX = 0.15
  const gapY = 0.15

 metrics.forEach((m, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = startX + col * (cardW + gapX)
    const y = startY + row * (cardH + gapY)
    const statusColor = m.status === 'good' ? SUCCESS : m.status === 'caution' ? WARNING : DANGER
    const bgColor     = m.status === 'good' ? 'F0FDF4' : m.status === 'caution' ? 'FFFBEB' : 'FEF2F2'

    // For the health score card, derive the label from the score value, not m.status
    const isHealthScore = m.label?.toLowerCase().includes('health')
    const scoreVal = isHealthScore ? parseInt(m.value) : NaN
    const statusLabel = isHealthScore
      ? (scoreVal >= 90 ? '✓ Excellent' : scoreVal >= 80 ? '✓ Strong' : scoreVal >= 70 ? '● Stable with Improvement Needed' : scoreVal >= 60 ? '⚠ Needs Attention' : '● High Risk')
      : m.status === 'good' ? '✓ On track' : m.status === 'caution' ? '⚠ Monitor' : '● Needs attention'

    s.addShape(pptx.ShapeType.roundRect, { x, y, w: cardW, h: cardH, fill: { color: bgColor }, line: { color: statusColor, pt: 1 }, rectRadius: 0.06 })
    s.addText(m.label, { x: x + 0.12, y: y + 0.08, w: cardW - 0.24, h: 0.24, color: MID_GRAY, fontSize: 9, fontFace: 'Calibri' })
    s.addText(m.value, { x: x + 0.12, y: y + 0.3, w: cardW - 0.24, h: 0.38, color: '111827', fontSize: 20, bold: true, fontFace: 'Calibri' })
    s.addText(statusLabel, { x: x + 0.12, y: y + 0.66, w: cardW - 0.24, h: 0.18, color: statusColor, fontSize: 8, fontFace: 'Calibri' })
  })
}

// ── Roadmap slide ─────────────────────────────────────────────────────────────
function addRoadmapSlide(pptx: pptxgen, slide: QBRSlide, mspName: string, logo: LogoData | null, isWhiteLabel = false) {
  const s = pptx.addSlide()
  addHeaderBar(s, slide.title, mspName, pptx, logo, isWhiteLabel)
  s.addText(slide.content, { x: 0.5, y: 1.0, w: 9, h: 0.45, color: MID_GRAY, fontSize: 12, fontFace: 'Calibri' })

  const priorities = slide.priorities ?? { critical: [], important: [], strategic: [] }
  const cols = [
    { key: 'critical' as const,  label: 'CRITICAL',  color: DANGER,   bg: 'FEF2F2', x: 0.3  },
    { key: 'important' as const, label: 'IMPORTANT', color: WARNING,  bg: 'FFFBEB', x: 3.45 },
    { key: 'strategic' as const, label: 'STRATEGIC', color: '2563EB', bg: 'EFF6FF', x: 6.6  },
  ]

  cols.forEach(col => {
    s.addShape(pptx.ShapeType.roundRect, { x: col.x, y: 1.55, w: 2.9, h: 3.45, fill: { color: col.bg }, line: { color: col.color, pt: 1 }, rectRadius: 0.06 })
    s.addText(col.label, { x: col.x, y: 1.6, w: 2.9, h: 0.35, color: col.color, fontSize: 10, bold: true, align: 'center', charSpacing: 1, fontFace: 'Calibri' })
    s.addShape(pptx.ShapeType.rect, { x: col.x + 0.15, y: 1.92, w: 2.6, h: 0.02, fill: { color: col.color }, line: { color: col.color } })

    const items = priorities[col.key] ?? []
    items.forEach((item, i) => {
      s.addShape(pptx.ShapeType.rect, { x: col.x + 0.15, y: 2.05 + i * 1.0, w: 0.03, h: 0.5, fill: { color: col.color }, line: { color: col.color } })
      s.addText(item, { x: col.x + 0.28, y: 2.02 + i * 1.0, w: 2.5, h: 0.65, color: '111827', fontSize: 10, fontFace: 'Calibri', breakLine: true })
    })
  })
}

// ── Recommendations slide ─────────────────────────────────────────────────────
function addRecommendationsSlide(pptx: pptxgen, slide: QBRSlide, mspName: string, logo: LogoData | null, isWhiteLabel = false) {
  const s = pptx.addSlide()
  addHeaderBar(s, slide.title, mspName, pptx, logo, isWhiteLabel)
  s.addText(slide.content, { x: 0.5, y: 1.0, w: 9, h: 0.45, color: MID_GRAY, fontSize: 12, fontFace: 'Calibri' })

  const recs = slide.recommendations ?? []
  recs.forEach((rec, i) => {
    const y = 1.55 + i * 1.2
    s.addShape(pptx.ShapeType.roundRect, { x: 0.3, y, w: 9.4, h: 1.05, fill: { color: i === 0 ? 'FEF2F2' : i === 1 ? 'FFFBEB' : 'EFF6FF' }, line: { color: i === 0 ? DANGER : i === 1 ? WARNING : '2563EB', pt: 0.8 }, rectRadius: 0.05 })
    s.addShape(pptx.ShapeType.rect, { x: 0.3, y, w: 0.06, h: 1.05, fill: { color: i === 0 ? DANGER : i === 1 ? WARNING : '2563EB' }, line: { color: i === 0 ? DANGER : i === 1 ? WARNING : '2563EB' } })
    s.addText(`${i + 1}. ${rec.title}`, { x: 0.5, y: y + 0.08, w: 9, h: 0.28, color: '111827', fontSize: 12, bold: true, fontFace: 'Calibri' })
    s.addText(`Why: ${rec.why}  ·  Benefit: ${rec.benefit}`, { x: 0.5, y: y + 0.38, w: 9, h: 0.5, color: '374151', fontSize: 9.5, fontFace: 'Calibri', breakLine: true })
  })
}
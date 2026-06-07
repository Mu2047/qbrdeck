import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export interface QBRInput {
  clientName: string
  quarter: string
  year: number
  tickets?: number
  avgResolutionHrs?: number
  uptimePct?: number
  patchCompliancePct?: number
  securityIncidents?: number
  usersSupported?: number
  ticketCategories?: string
  wins?: string
  upsellOpportunities?: string
  mspName?: string
}

export interface QBRSlide {
  title: string
  type: 'cover' | 'executive_summary' | 'business_impact' | 'metrics' | 'wins' | 'risks' | 'roadmap' | 'recommendations'
  content: string
  bullets?: string[]
  metrics?: Array<{
    label: string
    value: string
    status: 'good' | 'caution' | 'risk'
    interpretation?: string
  }>
  priorities?: {
    critical: string[]
    important: string[]
    strategic: string[]
  }
  recommendations?: Array<{
    title: string
    why: string
    risk: string
    benefit: string
  }>
}

// ── Health score computation ─────────────────────────────────────────────────
export function computeHealthScore(input: QBRInput): { score: number; status: string; summary: string } {
  let score = 100
  const issues: string[] = []

  // Uptime (max deduction: 25) — unchanged
  if (input.uptimePct !== undefined) {
    if (input.uptimePct >= 99.9) score -= 0
    else if (input.uptimePct >= 99.5) { score -= 5 }
    else if (input.uptimePct >= 99.0) { score -= 10; issues.push('uptime below 99.9%') }
    else if (input.uptimePct >= 98.0) { score -= 18; issues.push('uptime needs attention') }
    else { score -= 25; issues.push('critical uptime issues') }
  }

  // Patch compliance (max deduction: 25) — unchanged
  if (input.patchCompliancePct !== undefined) {
    if (input.patchCompliancePct >= 98) score -= 0
    else if (input.patchCompliancePct >= 95) { score -= 5 }
    else if (input.patchCompliancePct >= 90) { score -= 10; issues.push('patch compliance below 95%') }
    else if (input.patchCompliancePct >= 85) { score -= 18; issues.push('patch compliance needs improvement') }
    else { score -= 25; issues.push('critical patch compliance gap') }
  }

  // Security incidents (max deduction: 25) — UPDATED
  // 3 contained incidents ≠ 5 uncontained ones. Tier shift reduces overpenalization.
  if (input.securityIncidents !== undefined) {
    if (input.securityIncidents === 0) score -= 0
    else if (input.securityIncidents <= 3) { score -= 8; issues.push('security incidents require monitoring') }
    else if (input.securityIncidents <= 6) { score -= 15; issues.push('elevated security incidents') }
    else { score -= 25; issues.push('high security incident count') }
  }

  // Avg resolution time (max deduction: 15) — UPDATED
  // MSP industry standard is ≤8 hrs for normal tickets. 4.6 hrs is strong, not mediocre.
  if (input.avgResolutionHrs !== undefined) {
    if (input.avgResolutionHrs <= 4) score -= 0
    else if (input.avgResolutionHrs <= 8) { score -= 3 }
    else if (input.avgResolutionHrs <= 16) { score -= 8; issues.push('resolution time above target') }
    else { score -= 15; issues.push('slow ticket resolution') }
  }

  // Tickets per user (max deduction: 10) — unchanged
  if (input.tickets !== undefined && input.usersSupported) {
    const ratio = input.tickets / input.usersSupported
    if (ratio <= 1.5) score -= 0
    else if (ratio <= 2.5) { score -= 3 }
    else if (ratio <= 4) { score -= 6; issues.push('high ticket volume per user') }
    else { score -= 10; issues.push('very high ticket volume') }
  }

  score = Math.max(0, Math.min(100, score))

  // UPDATED status labels — reflect business reality, not just raw deductions
  const status =
    score >= 90 ? 'Excellent' :
    score >= 80 ? 'Strong' :
    score >= 70 ? 'Stable with Improvement Needed' :
    score >= 60 ? 'Needs Attention' :
    'High Risk'

  const summary =
    issues.length === 0
      ? 'Strong overall performance across all measured areas.'
      : `Strong overall performance with improvement needed in: ${issues.join(', ')}.`

  return { score, status, summary }
}

export async function generateQBRSlides(input: QBRInput): Promise<QBRSlide[]> {
  const health = computeHealthScore(input)

  const prompt = `You are an expert MSP business consultant writing a Quarterly Business Review for a client.
Write in clear, executive-friendly language. No technical jargon. Be specific, positive, and forward-looking.
Always position the MSP as a strategic partner, not just a vendor.

MSP Name: ${input.mspName ?? 'Your MSP'}
Client: {{clientName}}
Quarter: Q${input.quarter} ${input.year}

Metrics this quarter:
- Tickets resolved: ${input.tickets ?? 'N/A'}
- Avg resolution time: ${input.avgResolutionHrs ?? 'N/A'} hours
- Infrastructure uptime: ${input.uptimePct ?? 'N/A'}%
- Patch compliance: ${input.patchCompliancePct ?? 'N/A'}%
- Security incidents: ${input.securityIncidents ?? 0}
- Users supported: ${input.usersSupported ?? 'N/A'}
- Top ticket categories: ${input.ticketCategories ?? 'Not specified'}
- Notable wins & projects: ${input.wins ?? 'None specified'}
- Upsell/risk opportunities: ${input.upsellOpportunities ?? 'None specified'}
- Technology Health Score: ${health.score}/100 (${health.status})

Generate exactly 7 slides as a JSON array. Return ONLY valid JSON, nothing else.

Slide requirements:

1. "executive_summary" — 2-3 sentence overview. "bullets" array of 3 key highlights.

2. "business_impact" — Translate IT metrics into business value. 2 sentence intro focused on business outcomes, not technical numbers. "bullets" array of 4 items covering: productivity protected, downtime minimized, security posture, support responsiveness. Frame everything from the client's business perspective.

3. "metrics" — One sentence summary. "metrics" array of 6 items each with label, value (formatted nicely), status ("good"|"caution"|"risk"), and interpretation (one short sentence explaining what the number means for the business).

4. "wins" — Celebrate achievements. 2 sentence intro + "bullets" array of 3-4 specific wins derived from the metrics.

5. "risks" — Frame as opportunities. 2 sentence intro + "bullets" array of 2-3 items. Weave in upsell opportunities naturally. Do NOT use specific statistics or percentages (e.g. "99.9%", "$150,000", "70-80% reduction") unless they come directly from the client metrics provided. Use language like "significantly reduces", "can materially lower", "may lead to substantial recovery costs" instead.

6. "roadmap" — Title this slide "Q${Number(input.quarter) === 4 ? 1 : Number(input.quarter) + 1} ${Number(input.quarter) === 4 ? input.year + 1 : input.year} Strategic Roadmap". Include a "priorities" object containing three arrays:
   - "critical": 1-2 must-do items
   - "important": 1-2 should-do items  
   - "strategic": 1-2 forward-looking items

7. "recommendations" — Final recommendations. 2 sentence intro. "recommendations" array of 3 items, each with:
   - title: short name
   - why: one sentence explaining why it matters
   - risk: one sentence on business risk if ignored. Use general language only — no invented dollar amounts (e.g. "$50,000-$200,000"), no invented percentages (e.g. "70-80% reduction", "60% fewer incidents"). Say things like "can lead to significant recovery costs and downtime" or "may result in permanent data loss".
   - benefit: one sentence on expected benefit. Use language like "can materially reduce risk", "significantly strengthens your security posture", "provides reliable recovery options" — never invented statistics.

JSON format:
[
  {"title":"...","type":"executive_summary","content":"...","bullets":["...","...","..."]},
  {"title":"...","type":"business_impact","content":"...","bullets":["...","...","...","..."]},
  {"title":"...","type":"metrics","content":"...","metrics":[{"label":"...","value":"...","status":"good","interpretation":"..."}]},
  {"title":"...","type":"wins","content":"...","bullets":["..."]},
  {"title":"...","type":"risks","content":"...","bullets":["..."]},
  {"title":"...","type":"roadmap","content":"...","priorities":{"critical":["..."],"important":["..."],"strategic":["..."]}},
  {"title":"...","type":"recommendations","content":"...","recommendations":[{"title":"...","why":"...","risk":"...","benefit":"..."}]}
]

IMPORTANT: In all slide content, refer to the next planning session as Q${Number(input.quarter) === 4 ? 1 : Number(input.quarter) + 1}. Do not reference any other quarter as the next session.

BRANDING RULE: Never refer to "QBR Deck" anywhere in the generated slide content. QBR Deck is the software platform used to generate this report, not the MSP delivering the service. All service delivery language must refer to the MSP by name (${input.mspName ?? 'Your MSP'}) or use neutral phrasing such as "our team", "your IT partner", or "this quarter's work". Do not write phrases like "QBR Deck completed", "QBR Deck partnered", or "QBR Deck delivered".`

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = message.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .replace(/```json|```/g, '')
    .trim()

  const slides: QBRSlide[] = JSON.parse(raw)
  return slides
}

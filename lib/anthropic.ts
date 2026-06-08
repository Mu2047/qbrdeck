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

// ── REMOVED: computeHealthScore ───────────────────────────────────────────────
// This function has been removed from lib/anthropic.ts.
// The single source of truth is lib/health-score.ts → computeHealthScore().
// The generator receives pre-computed score values and writes them as
// {{healthScore}} and {{healthStatus}} placeholders — never hardcoded numbers.
// Export routes resolve placeholders from the stored QBR record at render time.
// This ensures DB, PDF, PPTX, preview, and ExportEvent always agree.
// ─────────────────────────────────────────────────────────────────────────────

export async function generateQBRSlides(
  input: QBRInput,
  healthScore: number,
  healthStatus: string,
  healthSummary: string,
): Promise<QBRSlide[]> {

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
- Technology Health Score: {{healthScore}}/100 ({{healthStatus}})
- Health summary: ${healthSummary}

CRITICAL INSTRUCTION — SCORE PLACEHOLDERS:
You MUST write {{healthScore}} and {{healthStatus}} wherever you reference the Technology Health Score.
NEVER write the actual number (e.g. do not write "60" or "42" or "High Risk" as a literal string).
The placeholders will be replaced with the correct values at export time.
Example correct usage: "Your Technology Health Score of {{healthScore}}/100 ({{healthStatus}}) indicates..."
Example wrong usage: "Your Technology Health Score of 60/100 (Needs Attention) indicates..."

Generate exactly 7 slides as a JSON array. Return ONLY valid JSON, nothing else.

Slide requirements:

1. "executive_summary" — 2-3 sentence overview referencing {{healthScore}} and {{healthStatus}}. "bullets" array of 3 key highlights.

2. "business_impact" — Translate IT metrics into business value. 2 sentence intro focused on business outcomes, not technical numbers. "bullets" array of 4 items covering: productivity protected, downtime minimized, security posture, support responsiveness. Frame everything from the client's business perspective.

3. "metrics" — One sentence summary. "metrics" array of 6 items each with label, value (formatted nicely), status ("good"|"caution"|"risk"), and interpretation (one short sentence explaining what the number means for the business).
The 6th metric must always be:
{
  "label": "Technology Health Score",
  "value": "{{healthScore}}/100",
  "status": <"good" if healthStatus is Excellent or Strong, "caution" if Stable or Needs Attention, "risk" if High Risk>,
  "interpretation": "{{healthStatus}} — your overall technology environment health this quarter."
}

4. "wins" — Celebrate achievements. 2 sentence intro + "bullets" array of 3-4 specific wins derived from the metrics.

5. "risks" — Frame as opportunities. 2 sentence intro + "bullets" array of 2-3 items. Weave in upsell opportunities naturally. Do NOT use specific statistics or percentages (e.g. "99.9%", "$150,000", "70-80% reduction") unless they come directly from the client metrics provided. Use language like "significantly reduces", "can materially lower", "may lead to substantial recovery costs" instead.

6. "roadmap" — Title this slide "Q${Number(input.quarter) === 4 ? 1 : Number(input.quarter) + 1} ${Number(input.quarter) === 4 ? input.year + 1 : input.year} Strategic Roadmap". Include a "priorities" object containing three arrays:
   - "critical": 1-2 must-do items
   - "important": 1-2 should-do items
   - "strategic": 1-2 forward-looking items

7. "recommendations" — Final recommendations. 2 sentence intro. "recommendations" array of 3 items, each with:
   - title: short name
   - why: one sentence explaining why it matters
   - risk: one sentence on business risk if ignored. Use general language only — no invented dollar amounts, no invented percentages. Say things like "can lead to significant recovery costs and downtime" or "may result in permanent data loss".
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

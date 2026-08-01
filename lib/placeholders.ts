// lib/placeholders.ts
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for all placeholder resolution.
//
// RULES:
//   - This is the ONLY place placeholders are resolved.
//   - PDF export, PPTX export, and browser preview must all use
//     resolvePlaceholders() from here — never resolve inline.
//   - The QBR generator should write placeholders into slide content
//     instead of hardcoding mutable metadata like client name.
//   - When adding new placeholders, add them here and bump
//     PLACEHOLDER_VERSION in lib/versions.ts.
//
// SUPPORTED PLACEHOLDERS:
//   {{clientName}}           Current client name (from live DB record)
//   {{quarter}}              Quarter number e.g. "3"
//   {{year}}                 Year e.g. "2026"
//   {{currentQuarter}}       e.g. "Q3 2026"
//   {{nextQuarter}}          e.g. "Q4 2026"
//   {{nextPlanningQuarter}}  e.g. "Q4 2026" (alias, used in closing copy)
//   {{workspaceName}}        MSP workspace name
//   {{mspName}}              MSP workspace name (alias for white-label copy)
//   {{preparedBy}}           Branding-aware: "QBR Deck" or MSP name
//   {{clientIndustry}}       Client industry if set
//   {{healthScore}}          Numeric score e.g. "87"
//   {{healthStatus}}         Status label e.g. "Strong"
//   {{generatedBy}}          Same as preparedBy
//   {{generatedDate}}        e.g. "June 7, 2026"
//   {{brandingFooter}}       Full footer line (from branding resolver)
//   {{brandingCoverLine}}    Cover attribution line
//   {{brandingClosingLine}}  Closing attribution line
// ─────────────────────────────────────────────────────────────────────────────

export interface PlaceholderContext {
  // Client
  clientName:      string
  clientIndustry?: string | null

  // Quarter / Year
  quarter:         string   // "3"
  year:            string   // "2026"

  // Workspace / MSP
  workspaceName:   string
  mspName?:        string | null   // only set for white-label plans

  // Health score
  healthScore?:    number | null
  healthStatus?:   string | null

  // Branding (from lib/branding.ts resolveBranding())
  brandingCoverLine:   string
  brandingFooter:      string
  brandingClosingLine: string

  // Meta
  generatedDate?:  string   // defaults to today if not provided
}

// ── Quarter helpers ────────────────────────────────────────────────────────────

function nextQuarterLabel(quarter: string, year: string): string {
  const q = parseInt(quarter, 10)
  const y = parseInt(year, 10)
  if (q === 4) return `Q1 ${y + 1}`
  return `Q${q + 1} ${y}`
}

function currentQuarterLabel(quarter: string, year: string): string {
  return `Q${quarter} ${year}`
}

function formatGeneratedDate(dateStr?: string): string {
  const date = dateStr ? new Date(dateStr) : new Date()
  return date.toLocaleDateString('en-US', {
    year:  'numeric',
    month: 'long',
    day:   'numeric',
  })
}

// ── Main resolver ──────────────────────────────────────────────────────────────

export function resolvePlaceholders(
  template: string,
  ctx: PlaceholderContext
): string {
  const currentQuarter = currentQuarterLabel(ctx.quarter, ctx.year)
  const nextQuarter    = nextQuarterLabel(ctx.quarter, ctx.year)
  const preparedBy     = ctx.mspName ?? 'QBR Deck'
  const generatedDate  = formatGeneratedDate(ctx.generatedDate)

  const map: Record<string, string> = {
    '{{clientName}}':           ctx.clientName,
    '{{quarter}}':              ctx.quarter,
    '{{year}}':                 ctx.year,
    '{{currentQuarter}}':       currentQuarter,
    '{{nextQuarter}}':          nextQuarter,
    '{{nextPlanningQuarter}}':  nextQuarter,
    '{{workspaceName}}':        ctx.workspaceName,
    '{{mspName}}':              ctx.mspName ?? ctx.workspaceName,
    '{{preparedBy}}':           preparedBy,
    '{{generatedBy}}':          preparedBy,
    '{{clientIndustry}}':       ctx.clientIndustry ?? 'your industry',
    '{{healthScore}}':          ctx.healthScore != null ? String(ctx.healthScore) : 'N/A',
    '{{healthStatus}}':         ctx.healthStatus ?? 'Not assessed',
    '{{generatedDate}}':        generatedDate,
    '{{brandingCoverLine}}':    ctx.brandingCoverLine,
    '{{brandingFooter}}':       ctx.brandingFooter,
    '{{brandingClosingLine}}':  ctx.brandingClosingLine,
  }

  let result = template
  for (const [placeholder, value] of Object.entries(map)) {
    // Replace all occurrences — use split/join for global replace without regex
    result = result.split(placeholder).join(value)
  }

  return result
}

// ── Resolve an array of slide objects ─────────────────────────────────────────
// Convenience wrapper — resolves placeholders in all text fields of each slide

export function resolveSlides(
  slides: Array<Record<string, unknown>>,
  ctx: PlaceholderContext
): Array<Record<string, unknown>> {
  return slides.map(slide => resolveSlide(slide, ctx))
}

function resolveSlide(
  slide: Record<string, unknown>,
  ctx: PlaceholderContext
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(slide)) {
    if (typeof value === 'string') {
      resolved[key] = resolvePlaceholders(value, ctx)
    } else if (Array.isArray(value)) {
      resolved[key] = value.map(item => {
        if (typeof item === 'string') return resolvePlaceholders(item, ctx)
        if (typeof item === 'object' && item !== null) return resolveSlide(item as Record<string, unknown>, ctx)
        return item
      })
    } else if (typeof value === 'object' && value !== null) {
      resolved[key] = resolveSlide(value as Record<string, unknown>, ctx)
    } else {
      resolved[key] = value
    }
  }

  return resolved
}

// ── Build placeholder context from DB records ──────────────────────────────────
// Call this in export routes after loading QBR + client + workspace + branding

import type { BrandingResult } from '@/lib/branding'

export function buildPlaceholderContext(params: {
  clientName:      string
  clientIndustry?: string | null
  quarter:         string
  year:            number | string
  workspaceName:   string
  mspName?:        string | null
  healthScore?:    number | null
  healthStatus?:   string | null
  branding:        BrandingResult
  generatedAt?:    Date | string | null
}): PlaceholderContext {
  return {
    clientName:         params.clientName,
    clientIndustry:     params.clientIndustry,
    quarter:            String(params.quarter),
    year:               String(params.year),
    workspaceName:      params.workspaceName,
    mspName:            params.mspName,
    healthScore:        params.healthScore,
    healthStatus:       params.healthStatus,
    brandingCoverLine:  params.branding.coverPreparedLine,
    brandingFooter:     params.branding.footerText,
    brandingClosingLine: params.branding.closingLine,
    generatedDate:      params.generatedAt
      ? new Date(params.generatedAt).toISOString()
      : undefined,
  }
}

// ── Defensive display-time guard against unresolved placeholders ───────────────
// resolveSlides() above only ever replaces the fixed set of known placeholder
// keys in SUPPORTED_PLACEHOLDERS. Any {{...}}-shaped token NOT in that set —
// e.g. a hallucinated or misspelled AI-authored token — survives resolution
// completely untouched. sanitizeResolvedSlides() is a last-line-of-defense
// pass applied to an ALREADY-RESOLVED slide array, immediately before it
// reaches any user-facing surface (a JSON response, the portal render, PDF,
// or PPTX generation). It never runs against raw, unresolved slides and never
// writes anything back to the database — callers are responsible for that.
//
// RULES:
//   - Pure. No logging, no side effects. Callers log (QBR id only) when
//     hadUnresolvedTokens is true.
//   - Only sanitizes user-visible text: slide.title, slide.content,
//     slide.bullets[], metric.label, metric.value, priorities.critical/
//     important/strategic[], and recommendation.title/why/risk/benefit.
//   - Never alters slide.type, metric.status, object keys, ids, or any other
//     structural/metadata field — every object is rebuilt via `...spread`
//     with only the listed fields overwritten.
//   - Defensive against malformed optional data (missing or non-object
//     metrics/priorities/recommendations entries) — never throws.

export const UNRESOLVED_TOKEN_PATTERN = /\{\{[^}]+\}\}/

// Standalone, stateless, pure helper — the "defensive helper accepting
// unknown": non-string values pass through unchanged; a string containing a
// surviving token becomes exactly "Content unavailable"; every other string
// is unchanged.
function sanitizeText(value: unknown): unknown {
  if (typeof value !== 'string') return value
  return UNRESOLVED_TOKEN_PATTERN.test(value) ? 'Content unavailable' : value
}

export function sanitizeResolvedSlides(
  slides: Array<Record<string, unknown>>
): { slides: Array<Record<string, unknown>>; hadUnresolvedTokens: boolean } {
  let hadUnresolvedTokens = false

  // Wraps sanitizeText() to also flag when a value was actually replaced,
  // without making sanitizeText() itself stateful.
  const check = (value: unknown): unknown => {
    const sanitized = sanitizeText(value)
    if (sanitized !== value) hadUnresolvedTokens = true
    return sanitized
  }

  const checkStringArray = (value: unknown): unknown =>
    Array.isArray(value) ? value.map(check) : value

  const checkMetric = (metric: unknown): unknown => {
    if (typeof metric !== 'object' || metric === null) return metric
    const m = metric as Record<string, unknown>
    return {
      ...m, // preserves metric.status and any other field untouched
      label: check(m.label),
      value: check(m.value),
    }
  }

  const checkPriorities = (priorities: unknown): unknown => {
    if (typeof priorities !== 'object' || priorities === null) return priorities
    const p = priorities as Record<string, unknown>
    return {
      ...p, // preserves any other key untouched
      critical:  checkStringArray(p.critical),
      important: checkStringArray(p.important),
      strategic: checkStringArray(p.strategic),
    }
  }

  const checkRecommendation = (rec: unknown): unknown => {
    if (typeof rec !== 'object' || rec === null) return rec
    const r = rec as Record<string, unknown>
    return {
      ...r, // preserves any other field untouched
      title:   check(r.title),
      why:     check(r.why),
      risk:    check(r.risk),
      benefit: check(r.benefit),
    }
  }

  const sanitizedSlides = slides.map(slide => {
    if (typeof slide !== 'object' || slide === null) return slide
    const s = slide as Record<string, unknown>
    return {
      ...s, // preserves slide.type and any other field untouched
      title:   check(s.title),
      content: check(s.content),
      bullets: checkStringArray(s.bullets),
      metrics: Array.isArray(s.metrics) ? s.metrics.map(checkMetric) : s.metrics,
      priorities: checkPriorities(s.priorities),
      recommendations: Array.isArray(s.recommendations)
        ? s.recommendations.map(checkRecommendation)
        : s.recommendations,
    }
  })

  return { slides: sanitizedSlides, hadUnresolvedTokens }
}

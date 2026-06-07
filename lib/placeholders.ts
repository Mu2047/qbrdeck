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

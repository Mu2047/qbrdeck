// lib/branding.ts
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for all branding decisions.
//
// RULES:
//   - This is the ONLY place branding rules are decided.
//   - PDF export, PPTX export, and browser preview must all call
//     resolveBranding() from here — never decide branding inline.
//   - Free/Solo always gets PLATFORM_BRANDED output.
//   - Growth/Agency gets WHITE_LABEL output using workspace name.
//   - When branding rules change, bump BRANDING_RULE_VERSION in lib/versions.ts.
//
// BRANDING MATRIX:
//
//   FREE / SOLO (PLATFORM_BRANDED):
//     Cover:   "Prepared with QBR Deck"
//     Footer:  "[Client] | Q[N] [YYYY] | Confidential | Powered by QBR Deck"
//     Closing: "Generated with QBR Deck"
//
//   GROWTH / AGENCY (WHITE_LABEL):
//     Cover:   "Prepared by [MSP Company Name]"
//     Footer:  "[MSP Company Name] | [Client] | Q[N] [YYYY] | Confidential"
//     Closing: "[MSP Company Name] — Your Strategic IT Partner"
// ─────────────────────────────────────────────────────────────────────────────

import { BRANDING_RULE_VERSION } from '@/lib/versions'

// ── Types ──────────────────────────────────────────────────────────────────────

export type BrandingMode = 'PLATFORM_BRANDED' | 'WHITE_LABEL'

export interface BrandingResult {
  brandingMode:      BrandingMode
  coverPreparedLine: string   // shown on cover slide/page
  footerText:        string   // shown on every slide footer
  closingLine:       string   // shown on final slide/page
  mspName:           string | null   // null for PLATFORM_BRANDED
  showPoweredBy:     boolean  // true for PLATFORM_BRANDED
  isWhiteLabel:      boolean  // true for WHITE_LABEL
  brandingVersion:   string   // from BRANDING_RULE_VERSION constant
}

export interface ResolveBrandingParams {
  plan:          string   // 'FREE' | 'SOLO' | 'GROWTH' | 'AGENCY'
  workspaceName: string   // MSP company name from Workspace record
  // Optional: override workspace name for white-label (future: per-workspace brand name)
  brandName?:    string | null
}

// ── Main resolver ──────────────────────────────────────────────────────────────

export function resolveBranding(params: ResolveBrandingParams): BrandingResult {
  const { plan, workspaceName, brandName } = params
  const isWhiteLabel = plan === 'GROWTH' || plan === 'AGENCY'
  const mspName      = isWhiteLabel ? (brandName ?? workspaceName) : null

  if (isWhiteLabel && mspName) {
    return {
      brandingMode:      'WHITE_LABEL',
      coverPreparedLine: `Prepared by ${mspName}`,
      footerText:        `${mspName} | Confidential`,
      closingLine:       `${mspName} — Your Strategic IT Partner`,
      mspName,
      showPoweredBy:     false,
      isWhiteLabel:      true,
      brandingVersion:   BRANDING_RULE_VERSION,
    }
  }

  // FREE and SOLO — platform branded
  return {
    brandingMode:      'PLATFORM_BRANDED',
    coverPreparedLine: 'Prepared with QBR Deck',
    footerText:        'Powered by QBR Deck | Confidential',
    closingLine:       'Generated with QBR Deck',
    mspName:           null,
    showPoweredBy:     true,
    isWhiteLabel:      false,
    brandingVersion:   BRANDING_RULE_VERSION,
  }
}

// ── Footer builder ─────────────────────────────────────────────────────────────
// Builds the full footer string with client name and quarter injected.
// Called by export routes after placeholder context is known.
//
// FREE/SOLO:  "Acme Corp | Q3 2026 | Confidential | Powered by QBR Deck"
// GROWTH/AGENCY: "MI Secure Tech Solutions | Acme Corp | Q3 2026 | Confidential"

export function buildFooterText(params: {
  branding:    BrandingResult
  clientName:  string
  quarter:     string
  year:        string | number
}): string {
  const { branding, clientName, quarter, year } = params
  const quarterLabel = `Q${quarter} ${year}`

  if (branding.isWhiteLabel && branding.mspName) {
    return `${branding.mspName} | ${clientName} | ${quarterLabel} | Confidential`
  }

  return `${clientName} | ${quarterLabel} | Confidential | Powered by QBR Deck`
}

// ── Branding mode from stored ExportEvent ─────────────────────────────────────
// Convert DB enum string back to typed BrandingMode

export function parseBrandingMode(value: string): BrandingMode {
  if (value === 'WHITE_LABEL') return 'WHITE_LABEL'
  return 'PLATFORM_BRANDED'
}

// ── Plan check helpers ─────────────────────────────────────────────────────────

export function isWhiteLabelPlan(plan: string): boolean {
  return plan === 'GROWTH' || plan === 'AGENCY'
}

export function isPlatformBrandedPlan(plan: string): boolean {
  return plan === 'FREE' || plan === 'SOLO'
}

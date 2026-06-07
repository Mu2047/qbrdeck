// lib/versions.ts
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for all version stamps used across QBR generation,
// export rendering, and analytics.
//
// HOW TO USE:
//   Import the constant you need and stamp it onto QBR records / ExportEvents.
//
// HOW TO BUMP:
//   When logic changes, increment the version string here.
//   Old records retain their original version stamp — never overwrite silently.
//   Analytics can filter/label by version to keep trend charts honest.
//
// BUMP GUIDE:
//   HEALTH_SCORE_VERSION   → bump when scoring formula, weights, or thresholds change
//   GENERATOR_VERSION      → bump when Claude prompt structure or slide schema changes
//   EXPORT_TEMPLATE_VERSION → bump when PDF/PPTX layout, fonts, or slide order changes
//   PLACEHOLDER_VERSION    → bump when placeholder set or resolver logic changes
//   BRANDING_RULE_VERSION  → bump when Free/Solo vs Growth/Agency branding rules change
// ─────────────────────────────────────────────────────────────────────────────

export const HEALTH_SCORE_VERSION    = 'v2' as const
export const GENERATOR_VERSION       = 'v1' as const
export const EXPORT_TEMPLATE_VERSION = 'v1' as const
export const PLACEHOLDER_VERSION     = 'v1' as const
export const BRANDING_RULE_VERSION   = 'v1' as const

// Convenience object — use when you need to stamp all versions at once
// e.g. snapshot.generatorVersion = VERSIONS.generator
export const VERSIONS = {
  healthScore:     HEALTH_SCORE_VERSION,
  generator:       GENERATOR_VERSION,
  exportTemplate:  EXPORT_TEMPLATE_VERSION,
  placeholder:     PLACEHOLDER_VERSION,
  brandingRule:    BRANDING_RULE_VERSION,
} as const

export type VersionMap = typeof VERSIONS
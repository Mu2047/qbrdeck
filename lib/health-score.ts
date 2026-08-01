// lib/health-score.ts
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for all health score logic.
//
// RULES:
//   - This is the ONLY place health score is calculated.
//   - QBR generator, PDF export, PPTX export, browser preview, and analytics
//     must ALL import computeHealthScore() from here.
//   - Never calculate score inline in any route or component.
//   - When the formula changes, bump HEALTH_SCORE_VERSION in lib/versions.ts
//     and update the logic here. Old QBR records keep their original version.
// ─────────────────────────────────────────────────────────────────────────────

import { HEALTH_SCORE_VERSION } from '@/lib/versions'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HealthScoreMetrics {
  uptimePct?:          number | null
  avgResolutionHrs?:   number | null
  patchCompliancePct?: number | null
  securityIncidents?:  number | null
  tickets?:            number | null
  usersSupported?:     number | null
}

export interface ScoreDeduction {
  metric:    string
  value:     number | string
  deduction: number
  reason:    string
}

export interface HealthScoreResult {
  score:        number   // 0–100
  status:       HealthStatus
  scoreVersion: string
  deductions:   ScoreDeduction[]
  // Convenience flag — true if any metrics were provided to base scoring on
  hasMetrics:   boolean
}

export type HealthStatus =
  | 'Excellent'
  | 'Strong'
  | 'Stable with Improvement Needed'
  | 'Needs Attention'
  | 'High Risk'

// ── Status mapping ─────────────────────────────────────────────────────────────
// Agreed ranges — do not change without bumping HEALTH_SCORE_VERSION

export function scoreToStatus(score: number): HealthStatus {
  if (score >= 90) return 'Excellent'
  if (score >= 80) return 'Strong'
  if (score >= 70) return 'Stable with Improvement Needed'
  if (score >= 60) return 'Needs Attention'
  return 'High Risk'
}

// ── Main function ──────────────────────────────────────────────────────────────

export function computeHealthScore(metrics: HealthScoreMetrics): HealthScoreResult {
  let score = 100
  const deductions: ScoreDeduction[] = []

  const hasMetrics = Object.values(metrics).some(v => v !== null && v !== undefined)

  // ── 1. Infrastructure Uptime ────────────────────────────────────────────────
  if (metrics.uptimePct !== null && metrics.uptimePct !== undefined) {
    const uptime = metrics.uptimePct
    if (uptime < 95) {
      const deduction = 25
      score -= deduction
      deductions.push({
        metric:    'Infrastructure Uptime',
        value:     `${uptime}%`,
        deduction,
        reason:    'Uptime critically below 95% threshold — significant business disruption risk',
      })
    } else if (uptime < 98) {
      const deduction = 15
      score -= deduction
      deductions.push({
        metric:    'Infrastructure Uptime',
        value:     `${uptime}%`,
        deduction,
        reason:    'Uptime below 98% target — worth monitoring and addressing',
      })
    } else if (uptime < 99.5) {
      const deduction = 5
      score -= deduction
      deductions.push({
        metric:    'Infrastructure Uptime',
        value:     `${uptime}%`,
        deduction,
        reason:    'Minor uptime gap below 99.5% — low impact but worth tracking',
      })
    }
    // 99.5%+ = no deduction
  }

  // ── 2. Average Resolution Time ──────────────────────────────────────────────
  if (metrics.avgResolutionHrs !== null && metrics.avgResolutionHrs !== undefined) {
    const hrs = metrics.avgResolutionHrs
    if (hrs > 24) {
      const deduction = 20
      score -= deduction
      deductions.push({
        metric:    'Average Resolution Time',
        value:     `${hrs}hrs`,
        deduction,
        reason:    'Resolution time exceeds 24 hours — significant impact on client productivity',
      })
    } else if (hrs > 12) {
      const deduction = 12
      score -= deduction
      deductions.push({
        metric:    'Average Resolution Time',
        value:     `${hrs}hrs`,
        deduction,
        reason:    'Resolution time exceeds 12 hours — noticeable productivity impact',
      })
    } else if (hrs > 8) {
      // Contained: minor deduction per agreed formula (v2)
      const deduction = 5
      score -= deduction
      deductions.push({
        metric:    'Average Resolution Time',
        value:     `${hrs}hrs`,
        deduction,
        reason:    'Resolution time slightly above 8-hour same-business-day target',
      })
    }
    // 8hrs or under = no deduction
  }

  // ── 3. Patch Compliance ──────────────────────────────────────────────────────
  if (metrics.patchCompliancePct !== null && metrics.patchCompliancePct !== undefined) {
    const patch = metrics.patchCompliancePct
    if (patch < 80) {
      const deduction = 20
      score -= deduction
      deductions.push({
        metric:    'Patch Compliance',
        value:     `${patch}%`,
        deduction,
        reason:    'Patch compliance critically low — high vulnerability exposure',
      })
    } else if (patch < 90) {
      const deduction = 10
      score -= deduction
      deductions.push({
        metric:    'Patch Compliance',
        value:     `${patch}%`,
        deduction,
        reason:    'Patch compliance below 90% target — remediation recommended',
      })
    } else if (patch < 95) {
      const deduction = 5
      score -= deduction
      deductions.push({
        metric:    'Patch Compliance',
        value:     `${patch}%`,
        deduction,
        reason:    'Patch compliance slightly below best-practice 95% threshold',
      })
    }
    // 95%+ = no deduction
  }

  // ── 4. Security Incidents ────────────────────────────────────────────────────
  // v2: contained/minor incidents scored more leniently than active breaches
  if (metrics.securityIncidents !== null && metrics.securityIncidents !== undefined) {
    const incidents = metrics.securityIncidents
    if (incidents >= 10) {
      const deduction = 25
      score -= deduction
      deductions.push({
        metric:    'Security Incidents',
        value:     incidents,
        deduction,
        reason:    'Very high incident volume — critical security posture review required',
      })
    } else if (incidents >= 5) {
      const deduction = 15
      score -= deduction
      deductions.push({
        metric:    'Security Incidents',
        value:     incidents,
        deduction,
        reason:    'Elevated incident count — enhanced security controls recommended',
      })
    } else if (incidents >= 2) {
      const deduction = 8
      score -= deduction
      deductions.push({
        metric:    'Security Incidents',
        value:     incidents,
        deduction,
        reason:    'Low-to-moderate incident count — monitor and review root causes',
      })
    } else if (incidents === 1) {
      const deduction = 3
      score -= deduction
      deductions.push({
        metric:    'Security Incidents',
        value:     incidents,
        deduction,
        reason:    'Single contained incident — minor deduction, review recommended',
      })
    }
    // 0 incidents = no deduction
  }

  // ── Clamp score to 0–100 ────────────────────────────────────────────────────
  score = Math.max(0, Math.min(100, score))

  return {
    score:        Math.round(score),
    status:       scoreToStatus(score),
    scoreVersion: HEALTH_SCORE_VERSION,
    deductions,
    hasMetrics,
  }
}

// ── Helpers used by export routes and preview ──────────────────────────────────

// Returns the CSS/display color class for a given status
export function statusToColor(status: HealthStatus): 'green' | 'blue' | 'yellow' | 'orange' | 'red' {
  switch (status) {
    case 'Excellent':                    return 'green'
    case 'Strong':                       return 'blue'
    case 'Stable with Improvement Needed': return 'yellow'
    case 'Needs Attention':              return 'orange'
    case 'High Risk':                    return 'red'
  }
}

// ── Deterministic health-card label ─────────────────────────────────────────
// The Technology Health Score metric card is identified by its label (same
// heuristic already used independently in lib/export-pdf.tsx / lib/export-pptx.ts).
// Every other metric's label continues to come from the AI-authored good/caution/risk
// 3-tier status — this only overrides the one card whose label should reflect the
// deterministic, stored healthStatus instead of the model's free-form status field.

// Identifies whether a given metric label refers to the Technology Health Score card.
export function isHealthScoreMetric(label: string | null | undefined): boolean {
  return label?.toLowerCase().includes('health') ?? false
}

// Returns the label text a metric card should display. For the health-score card,
// returns the deterministic healthStatus verbatim (e.g. "Excellent") instead of the
// AI-authored good/caution/risk label. For every other metric, falls back to the
// existing 3-tier mapping, unchanged.
export function healthCardLabel(
  m: { label?: string | null; status?: string | null },
  healthStatus: string | null | undefined
): string {
  if (isHealthScoreMetric(m.label) && healthStatus) return healthStatus
  return m.status === 'good'    ? 'On track' :
         m.status === 'caution' ? 'Monitor'  :
                                   'Needs attention'
}

// Reconstructs a HealthScoreResult from stored QBR fields (for old records or re-exports)
// Falls back to computing from rawMetrics if stored score is missing
export function resolveHealthScore(qbr: {
  healthScore?:        number | null
  healthStatus?:       string | null
  healthScoreVersion?: string | null
  scoreBreakdown?:     unknown
  rawMetrics?:         unknown
  uptimePct?:          number | null
  avgResolutionHrs?:   number | null
  patchCompliancePct?: number | null
  securityIncidents?:  number | null
  tickets?:            number | null
  usersSupported?:     number | null
}): HealthScoreResult | null {
  // Prefer stored score — it's the authoritative record of what was computed at generation
  if (
    qbr.healthScore !== null &&
    qbr.healthScore !== undefined &&
    qbr.healthStatus
  ) {
    return {
      score:        qbr.healthScore,
      status:       qbr.healthStatus as HealthStatus,
      scoreVersion: qbr.healthScoreVersion ?? 'unknown',
      deductions:   Array.isArray(qbr.scoreBreakdown) ? qbr.scoreBreakdown as ScoreDeduction[] : [],
      hasMetrics:   true,
    }
  }

  // Fall back: compute from raw metrics on the QBR record (covers older records)
  const metrics: HealthScoreMetrics = {
    uptimePct:          qbr.uptimePct,
    avgResolutionHrs:   qbr.avgResolutionHrs,
    patchCompliancePct: qbr.patchCompliancePct,
    securityIncidents:  qbr.securityIncidents,
    tickets:            qbr.tickets,
    usersSupported:     qbr.usersSupported,
  }

  if (!Object.values(metrics).some(v => v !== null && v !== undefined)) {
    return null // No metrics available at all
  }

  return computeHealthScore(metrics)
}

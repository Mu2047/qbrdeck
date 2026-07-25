// components/qbr/SlideBody.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Shared, read-only slide-body renderer.
//
// Extracted verbatim from the public portal (app/portal/[token]/page.tsx) as a
// pure refactor — zero intended behavior change. Renders a single, already
// RESOLVED QBR slide (placeholders already substituted by the caller before
// this component ever sees the data). This component performs no placeholder
// resolution itself.
//
// Commit 3 addition: the Technology Health Score metric card's label and color
// are derived from the deterministic, stored `healthStatus` (passed in as a
// prop) instead of the AI-authored good/caution/risk 3-tier status. Every other
// metric card's label and color are unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { healthCardLabel, isHealthScoreMetric, statusToColor, type HealthStatus } from '@/lib/health-score'

const statusColor = (s: string) =>
  s === 'good'    ? 'bg-green-50 border-green-200' :
  s === 'caution' ? 'bg-amber-50 border-amber-200' :
                    'bg-red-50 border-red-200'

const statusText = (s: string) =>
  s === 'good'    ? 'text-green-600' :
  s === 'caution' ? 'text-amber-600' :
                    'text-red-600'

// Tailwind classes for each deterministic health-status color family
// (statusToColor() already exists in lib/health-score.ts and was previously
// unused anywhere in the app). Same bg-50/border-200/text-600 shape as the
// existing good/caution/risk classes above, just with two extra families
// (blue, yellow) to cover all five HealthStatus values instead of three.
const HEALTH_STATUS_CLASSES: Record<ReturnType<typeof statusToColor>, { card: string; text: string }> = {
  green:  { card: 'bg-green-50 border-green-200',   text: 'text-green-600'  },
  blue:   { card: 'bg-blue-50 border-blue-200',     text: 'text-blue-600'   },
  yellow: { card: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-600' },
  orange: { card: 'bg-orange-50 border-orange-200', text: 'text-orange-600' },
  red:    { card: 'bg-red-50 border-red-200',       text: 'text-red-600'   },
}

export function SlideBody({
  slide,
  index,
  healthStatus,
}: {
  slide: any
  index: number
  healthStatus?: string | null
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="bg-[#0a1634] px-6 py-3 flex items-center justify-between">
        <p className="text-white text-sm font-medium">{slide.title}</p>
        <span className="text-white/40 text-xs">Slide {index + 2}</span>
      </div>
      <div className="p-6">
        <p className="text-gray-600 text-sm leading-relaxed mb-4">{slide.content}</p>

        {/* Metrics slide */}
        {slide.type === 'metrics' && slide.metrics && (
          <div className="grid grid-cols-3 gap-3">
            {slide.metrics.map((m: any, j: number) => {
              // Health-score card: deterministic label + color from stored healthStatus.
              // Falls back to the standard good/caution/risk styling below if
              // healthStatus is unavailable or unrecognized (e.g. older records),
              // so this never breaks rendering — it only improves it when the data
              // is present.
              const isHealthCard = isHealthScoreMetric(m.label)
              const healthColorFamily = isHealthCard && healthStatus
                ? statusToColor(healthStatus as HealthStatus)
                : undefined
              const healthClasses = healthColorFamily ? HEALTH_STATUS_CLASSES[healthColorFamily] : undefined

              const cardClasses = healthClasses ? healthClasses.card : statusColor(m.status)
              const textClasses = healthClasses ? healthClasses.text : statusText(m.status)
              const label       = healthCardLabel(m, healthStatus)

              return (
                <div key={j} className={`rounded-lg p-3.5 border ${cardClasses}`}>
                  <p className="text-xs text-gray-500 mb-1">{m.label}</p>
                  <p className="text-xl font-bold text-[#0a1634] mb-1">{m.value}</p>
                  <p className={`text-xs font-medium ${textClasses}`}>
                    {label}
                  </p>
                </div>
              )
            })}
          </div>
        )}

        {/* Bullet slides */}
        {slide.bullets && (
          <div className="space-y-2.5">
            {slide.bullets.map((b: string, j: number) => (
              <div key={j} className="flex items-start gap-2.5">
                <div className="w-0.5 h-5 bg-[#c9a02a] flex-shrink-0 mt-1 rounded-full" />
                <p className="text-sm text-gray-700">{b}</p>
              </div>
            ))}
          </div>
        )}

        {/* Roadmap slide */}
        {slide.priorities && (
          <div className="grid grid-cols-3 gap-4">
            {[
              { key: 'critical',  label: 'Critical',  color: 'bg-red-50 border-red-200 text-red-700'    },
              { key: 'important', label: 'Important', color: 'bg-amber-50 border-amber-200 text-amber-700' },
              { key: 'strategic', label: 'Strategic', color: 'bg-blue-50 border-blue-200 text-blue-700'  },
            ].map(col => (
              <div key={col.key} className={`rounded-lg border p-3 ${col.color}`}>
                <p className="text-xs font-bold uppercase tracking-wide mb-2">{col.label}</p>
                <ul className="space-y-1.5">
                  {(slide.priorities[col.key] ?? []).map((item: string, k: number) => (
                    <li key={k} className="text-xs leading-snug">— {item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {/* Recommendations slide */}
        {slide.recommendations && (
          <div className="space-y-4">
            {slide.recommendations.map((rec: any, j: number) => (
              <div key={j} className="border border-gray-100 rounded-lg p-4">
                <p className="text-sm font-semibold text-[#0a1634] mb-2">{j + 1}. {rec.title}</p>
                <div className="space-y-1 text-xs text-gray-600">
                  <p><span className="font-medium text-gray-700">Why it matters:</span> {rec.why}</p>
                  <p><span className="font-medium text-gray-700">Risk if ignored:</span> {rec.risk}</p>
                  <p><span className="font-medium text-gray-700">Expected benefit:</span> {rec.benefit}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

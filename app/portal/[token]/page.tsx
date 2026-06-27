// app/portal/[token]/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Public read-only QBR portal — shared with clients via share token.
//
// RENDERING PIPELINE:
//   Uses the same resolveSlides() + buildPlaceholderContext() + resolveBranding()
//   path as browser preview, PDF export, and PPTX export.
//   No raw placeholders ({{clientName}} etc.) will ever appear to clients.
//
// SECURITY:
//   - Token is 128-bit random hex — unguessable
//   - No workspace-private data exposed
//   - Read-only — no actions available
//   - workspaceId never appears in URL or response
// ─────────────────────────────────────────────────────────────────────────────

import { notFound } from 'next/navigation'
import { resolveBranding, buildFooterText } from '@/lib/branding'
import { resolveSlides, buildPlaceholderContext } from '@/lib/placeholders'
import { resolveHealthScore } from '@/lib/health-score'
import { resolveSharedQbr } from '@/lib/share-links'

export default async function PortalPage({ params }: { params: { token: string } }) {

  // ── Load QBR via share token ────────────────────────────────────────────────
  const qbr = await resolveSharedQbr(params.token)

  if (!qbr || !qbr.slides) notFound()

  // ── Resolve branding — same logic as export routes ──────────────────────────
  const plan      = qbr.client.workspace.subscription?.plan ?? 'FREE'
  const workspace = qbr.client.workspace

  const branding = resolveBranding({
    plan,
    workspaceName: workspace.name,
  })

  // ── Resolve health score — prefer stored, fall back to recompute ────────────
  const healthResult = resolveHealthScore(qbr)

  // ── Build footer text — same as export routes ───────────────────────────────
  const footerText = buildFooterText({
    branding,
    clientName: qbr.client.name,
    quarter:    qbr.quarter,
    year:       qbr.year,
  })

  // ── Build placeholder context — same as export routes ──────────────────────
  const placeholderCtx = buildPlaceholderContext({
    clientName:     qbr.client.name,
    clientIndustry: qbr.client.industry,
    quarter:        qbr.quarter,
    year:           qbr.year,
    workspaceName:  workspace.name,
    mspName:        branding.mspName,
    healthScore:    healthResult?.score  ?? qbr.healthScore,
    healthStatus:   healthResult?.status ?? qbr.healthStatus,
    branding:       { ...branding, footerText },
    generatedAt:    qbr.createdAt,
  })

  // ── Resolve all placeholders in slide content ───────────────────────────────
  // This is the same call made by export-pdf and export-pptx routes.
  // No {{placeholder}} tags will reach the client.
  const slides = resolveSlides(
    qbr.slides as Array<Record<string, unknown>>,
    placeholderCtx
  )

  // ── Render helpers ──────────────────────────────────────────────────────────

  const statusColor = (s: string) =>
    s === 'good'    ? 'bg-green-50 border-green-200' :
    s === 'caution' ? 'bg-amber-50 border-amber-200' :
                      'bg-red-50 border-red-200'

  const statusLabel = (s: string) =>
    s === 'good'    ? 'On track'       :
    s === 'caution' ? 'Monitor'        :
                      'Needs attention'

  const statusText = (s: string) =>
    s === 'good'    ? 'text-green-600' :
    s === 'caution' ? 'text-amber-600' :
                      'text-red-600'

  // ── Page ────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <div className="bg-[#0a1634] px-8 py-5 flex items-center justify-between">
        <div>
          <p className="text-[#c9a02a] text-xs tracking-widest uppercase mb-1">
            Quarterly Business Review
          </p>
          <h1 className="text-white text-xl font-bold">
            {qbr.client.name} — Q{qbr.quarter} {qbr.year}
          </h1>
        </div>
        <p className="text-white/40 text-xs">Confidential</p>
      </div>
      <div className="h-0.5 bg-[#c9a02a]" />

      {/* Slides */}
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        {(slides as any[]).map((slide: any, i: number) => (
          <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="bg-[#0a1634] px-6 py-3 flex items-center justify-between">
              <p className="text-white text-sm font-medium">{slide.title}</p>
              <span className="text-white/40 text-xs">Slide {i + 2}</span>
            </div>
            <div className="p-6">
              <p className="text-gray-600 text-sm leading-relaxed mb-4">{slide.content}</p>

              {/* Metrics slide */}
              {slide.type === 'metrics' && slide.metrics && (
                <div className="grid grid-cols-3 gap-3">
                  {slide.metrics.map((m: any, j: number) => (
                    <div key={j} className={`rounded-lg p-3.5 border ${statusColor(m.status)}`}>
                      <p className="text-xs text-gray-500 mb-1">{m.label}</p>
                      <p className="text-xl font-bold text-[#0a1634] mb-1">{m.value}</p>
                      <p className={`text-xs font-medium ${statusText(m.status)}`}>
                        {statusLabel(m.status)}
                      </p>
                    </div>
                  ))}
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
        ))}

        {/* Branding footer — plan-aware, same rules as PDF/PPTX */}
        <p className="text-center text-xs text-gray-400 pt-4">
          {branding.closingLine}
        </p>
      </div>
    </div>
  )
}

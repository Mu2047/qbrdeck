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
import { SlideBody } from '@/components/qbr/SlideBody'

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
          <SlideBody key={i} slide={slide} index={i} />
        ))}

        {/* Branding footer — plan-aware, same rules as PDF/PPTX */}
        <p className="text-center text-xs text-gray-400 pt-4">
          {branding.closingLine}
        </p>
      </div>
    </div>
  )
}

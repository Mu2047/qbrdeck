import { prisma } from '@/lib/prisma'
import { generatePDF } from '@/lib/export-pdf'
import { generatePPTX } from '@/lib/export-pptx'
import { resolveBranding, buildFooterText } from '@/lib/branding'
import { resolveHealthScore } from '@/lib/health-score'
import { resolveSlides, buildPlaceholderContext, sanitizeResolvedSlides } from '@/lib/placeholders'
import { getLimits, isUnderLimit, shouldResetPeriod } from '@/lib/limits'
import { VERSIONS } from '@/lib/versions'
import type { getWorkspaceMembership } from '@/lib/workspace'

export type ExportFormat = 'pdf' | 'pptx'

// Mechanical extraction of the business logic previously inlined identically
// in app/api/export-pdf/route.ts and app/api/export-pptx/route.ts. Behavior,
// quota semantics, ExportEvent/Subscription accounting, and response shape
// are unchanged — only the qbrId's origin (browser body vs. an
// onboarding-anchored id) and the thin route-level auth/response wiring
// differ between callers. Thrown as typed errors (not NextResponse) so each
// caller can map them to its own existing response shape.
export class ExportQbrNotFoundError extends Error {}
export class ExportNoSlidesError extends Error {}
export class ExportLimitError extends Error {
  constructor(public plan: string, public max: number | null) {
    super('LIMIT_REACHED')
  }
}

type Membership = NonNullable<Awaited<ReturnType<typeof getWorkspaceMembership>>>

export async function performQbrExport(
  membership: Membership,
  qbrId: string,
  format: ExportFormat,
): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const qbr = await prisma.qBR.findFirst({
    where: { id: qbrId, workspaceId: membership.workspaceId, deletedAt: null },
    include: { client: true },
  })
  if (!qbr) throw new ExportQbrNotFoundError()
  if (!qbr.slides) throw new ExportNoSlidesError()

  // ── Export limit enforcement ──────────────────────────────────────────────
  const plan = (membership.subscription?.plan ?? 'FREE') as string
  const limits = getLimits(plan)
  let sub = membership.subscription

  if (sub && shouldResetPeriod(new Date(sub.periodStart))) {
    await prisma.subscription.update({
      where: { workspaceId: membership.workspaceId },
      data: { qbrCount: 0, exportCount: 0, exportedQbrIds: '[]', periodStart: new Date() },
    })
    sub = { ...sub, exportCount: 0, exportedQbrIds: '[]' }
  }

  const exportedIds: string[] = JSON.parse(sub?.exportedQbrIds ?? '[]')
  const alreadyExported = exportedIds.includes(qbrId) || qbr.status === 'EXPORTED'

  if (!alreadyExported) {
    const exportCount = sub?.exportCount ?? 0
    if (!isUnderLimit(exportCount, limits.exportPackagesPerMonth)) {
      throw new ExportLimitError(plan, limits.exportPackagesPerMonth)
    }
  }
  // ── End export limit enforcement ──────────────────────────────────────────

  // ── Workspace + branding ──────────────────────────────────────────────────
  const workspace = await prisma.workspace.findUnique({
    where: { id: membership.workspaceId },
  })

  const branding = resolveBranding({
    plan,
    workspaceName: workspace?.name ?? 'QBR Deck',
  })

  // ── Health score ──────────────────────────────────────────────────────────
  const healthResult = resolveHealthScore(qbr)

  // ── Footer ────────────────────────────────────────────────────────────────
  const footerText = buildFooterText({
    branding,
    clientName: qbr.client.name,
    quarter:    qbr.quarter,
    year:       qbr.year,
  })

  // ── Resolve placeholders ──────────────────────────────────────────────────
  const placeholderCtx = buildPlaceholderContext({
    clientName:     qbr.client.name,
    clientIndustry: qbr.client.industry,
    quarter:        qbr.quarter,
    year:           qbr.year,
    workspaceName:  workspace?.name ?? 'QBR Deck',
    mspName:        branding.mspName,
    healthScore:    healthResult?.score  ?? qbr.healthScore,
    healthStatus:   healthResult?.status ?? qbr.healthStatus,
    branding:       { ...branding, footerText },
    generatedAt:    qbr.createdAt,
  })

  const resolvedSlides = resolveSlides(qbr.slides as Array<Record<string, unknown>>, placeholderCtx)

  // ── Defensive guard: sanitize the display copy handed to the renderer.
  // Raw qbr.slides above is untouched; lib/export-pdf.tsx and
  // lib/export-pptx.ts are not modified — they simply receive already-safe
  // input, exactly as before this extraction.
  const { slides: safeResolvedSlides, hadUnresolvedTokens } = sanitizeResolvedSlides(resolvedSlides)
  if (hadUnresolvedTokens) {
    console.error(`[unresolved-placeholder][export-${format}]`, qbr.id)
  }

  const metricsArgs = {
    clientName:         qbr.client.name,
    quarter:            qbr.quarter,
    year:               qbr.year,
    tickets:            qbr.tickets            ?? undefined,
    avgResolutionHrs:   qbr.avgResolutionHrs   ?? undefined,
    uptimePct:          qbr.uptimePct           ?? undefined,
    patchCompliancePct: qbr.patchCompliancePct  ?? undefined,
    securityIncidents:  qbr.securityIncidents   ?? undefined,
    usersSupported:     qbr.usersSupported      ?? undefined,
  }

  // ── Generate file ─────────────────────────────────────────────────────────
  const buffer = format === 'pdf'
    ? await generatePDF(
        safeResolvedSlides as any,
        qbr.client.name,
        qbr.quarter,
        qbr.year,
        branding.mspName ?? undefined,
        workspace?.logoUrl ?? undefined,
        metricsArgs,
        branding.isWhiteLabel,
      )
    : await generatePPTX(
        safeResolvedSlides as any,
        qbr.client.name,
        qbr.quarter,
        qbr.year,
        branding.mspName ?? undefined,
        workspace?.logoUrl ?? undefined,
        metricsArgs,
        branding.isWhiteLabel,
      )

  // ── Update QBR status ─────────────────────────────────────────────────────
  await prisma.qBR.update({
    where: { id: qbrId },
    data: { status: 'EXPORTED', exportedById: membership.userId },
  })

  // ── ExportEvent + billing ─────────────────────────────────────────────────
  const existingEvent = await prisma.exportEvent.findFirst({
    where: { qbrId },
    orderBy: { exportedAt: 'asc' },
  })
  const exportPackageId = existingEvent?.exportPackageId ?? `pkg_${qbrId}`
  const isRedownload    = alreadyExported
  const consumedCredit  = !alreadyExported

  await prisma.exportEvent.create({
    data: {
      id:                         `${Date.now()}_${format}_${qbrId}`,
      qbrId,
      workspaceId:                membership.workspaceId,
      clientId:                   qbr.client.id,
      exportedByUserId:           membership.userId,
      exportType:                 format.toUpperCase() as 'PDF' | 'PPTX',
      exportPackageId,
      isRedownload,
      consumedExportCredit:       consumedCredit,
      brandingMode:               branding.brandingMode,
      planAtExport:               plan as any,
      clientNameAtExport:         qbr.client.name,
      mspNameAtExport:            branding.mspName,
      healthScoreAtExport:        healthResult?.score  ?? qbr.healthScore  ?? null,
      healthStatusAtExport:       healthResult?.status ?? qbr.healthStatus ?? null,
      healthScoreVersionAtExport: healthResult?.scoreVersion ?? qbr.healthScoreVersion ?? null,
      templateVersion:            VERSIONS.exportTemplate,
    },
  })

  if (!alreadyExported) {
    const current: string[] = JSON.parse(sub?.exportedQbrIds ?? '[]')
    current.push(qbrId)
    if (sub) {
      await prisma.subscription.update({
        where: { workspaceId: membership.workspaceId },
        data: {
          exportCount:    { increment: 1 },
          exportedQbrIds: JSON.stringify(current),
        },
      })
    } else {
      await prisma.subscription.create({
        data: {
          workspaceId:      membership.workspaceId,
          stripeCustomerId: `free_${membership.workspaceId}`,
          plan:             'FREE',
          qbrCount:         0,
          exportCount:      1,
          exportedQbrIds:   JSON.stringify([qbrId]),
          periodStart:      new Date(),
        },
      })
    }
  }

  const safeName = qbr.client.name.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim()
  const filename = `${safeName}-QBR-Q${qbr.quarter}-${qbr.year}.${format}`
  const contentType = format === 'pdf'
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

  return { buffer, filename, contentType }
}

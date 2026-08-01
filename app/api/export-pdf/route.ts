import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generatePDF } from '@/lib/export-pdf'
import { getWorkspaceMembership } from '@/lib/workspace'
import { can } from '@/lib/permissions'
import { resolveBranding, buildFooterText } from '@/lib/branding'
import { resolveHealthScore } from '@/lib/health-score'
import { resolveSlides, buildPlaceholderContext, sanitizeResolvedSlides } from '@/lib/placeholders'
import { getLimits, isUnderLimit, shouldResetPeriod } from '@/lib/limits'
import { VERSIONS } from '@/lib/versions'

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.exportQBR(membership.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { qbrId } = await req.json()

    const qbr = await prisma.qBR.findFirst({
      where: { id: qbrId, workspaceId: membership.workspaceId, deletedAt: null },
      include: { client: true },
    })

    if (!qbr) return NextResponse.json({ error: 'QBR not found' }, { status: 404 })

    if (!qbr.slides)
      return NextResponse.json({ error: 'QBR has no generated slides' }, { status: 400 })

    // ── Export limit enforcement ──────────────────────────────────────────────
    const plan   = (membership.subscription?.plan ?? 'FREE') as string
    const limits = getLimits(plan)
    const sub    = membership.subscription

    if (sub && shouldResetPeriod(new Date(sub.periodStart))) {
      await prisma.subscription.update({
        where: { workspaceId: membership.workspaceId },
        data: { qbrCount: 0, exportCount: 0, exportedQbrIds: '[]', periodStart: new Date() },
      })
      sub.exportCount = 0
      sub.exportedQbrIds = '[]'
    }

    const exportedIds: string[] = JSON.parse(sub?.exportedQbrIds ?? '[]')
    const alreadyExported = exportedIds.includes(qbrId) || qbr.status === 'EXPORTED'

    if (!alreadyExported) {
      const exportCount = sub?.exportCount ?? 0
      if (!isUnderLimit(exportCount, limits.exportPackagesPerMonth)) {
        return NextResponse.json(
          { error: 'LIMIT_REACHED', limit: 'exports', plan, max: limits.exportPackagesPerMonth },
          { status: 403 }
        )
      }
    }
    // ── End export limit enforcement ──────────────────────────────────────────

    // ── Workspace + branding ──────────────────────────────────────────────────
    const workspace = await prisma.workspace.findUnique({
      where: { id: membership.workspaceId },
    })

    const branding = resolveBranding({
      plan:          membership.subscription?.plan ?? 'FREE',
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

    // ── Defensive guard: sanitize the display copy handed to the PDF
    // renderer. Raw qbr.slides above is untouched; lib/export-pdf.tsx is not
    // modified — it simply receives already-safe input.
    const { slides: safeResolvedSlides, hadUnresolvedTokens } = sanitizeResolvedSlides(resolvedSlides)
    if (hadUnresolvedTokens) {
      console.error('[unresolved-placeholder][export-pdf]', qbr.id)
    }

    // ── Generate PDF ──────────────────────────────────────────────────────────
    const buffer = await generatePDF(
      safeResolvedSlides as any,
      qbr.client.name,
      qbr.quarter,
      qbr.year,
      branding.mspName ?? undefined,
      workspace?.logoUrl ?? undefined,
      {
        clientName:         qbr.client.name,
        quarter:            qbr.quarter,
        year:               qbr.year,
        tickets:            qbr.tickets            ?? undefined,
        avgResolutionHrs:   qbr.avgResolutionHrs   ?? undefined,
        uptimePct:          qbr.uptimePct           ?? undefined,
        patchCompliancePct: qbr.patchCompliancePct  ?? undefined,
        securityIncidents:  qbr.securityIncidents   ?? undefined,
        usersSupported:     qbr.usersSupported      ?? undefined,
      },
      branding.isWhiteLabel
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
    const exportPackageId  = existingEvent?.exportPackageId ?? `pkg_${qbrId}`
    const isRedownload     = alreadyExported
    const consumedCredit   = !alreadyExported

    await prisma.exportEvent.create({
      data: {
        id:                         `${Date.now()}_pdf_${qbrId}`,
        qbrId,
        workspaceId:                membership.workspaceId,
        clientId:                   qbr.client.id,
        exportedByUserId:           membership.userId,
        exportType:                 'PDF',
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

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}-QBR-Q${qbr.quarter}-${qbr.year}.pdf"`,
      },
    })

  } catch (err: any) {
    console.error('[export-pdf]', err)
    return NextResponse.json(
      { error: typeof err.message === 'string' ? err.message : 'Export failed' },
      { status: 500 }
    )
  }
}
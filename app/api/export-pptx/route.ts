import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generatePPTX } from '@/lib/export-pptx'
import { getWorkspaceMembership } from '@/lib/workspace'
import { can } from '@/lib/permissions'
import { resolveBranding, buildFooterText } from '@/lib/branding'
import { resolveHealthScore } from '@/lib/health-score'
import { resolveSlides, buildPlaceholderContext } from '@/lib/placeholders'
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
      where: { id: qbrId },
      include: { client: true },
    })

    if (!qbr || qbr.client.workspaceId !== membership.workspaceId)
      return NextResponse.json({ error: 'QBR not found' }, { status: 404 })

    if (!qbr.slides)
      return NextResponse.json({ error: 'QBR has no generated slides' }, { status: 400 })

    // ── Export limit enforcement ──────────────────────────────────────────────
    const { PLAN_LIMITS, shouldResetPeriod, isUnderLimit } = await import('@/lib/limits')
    const plan = (membership.subscription?.plan ?? 'FREE') as keyof typeof PLAN_LIMITS
    const limits = PLAN_LIMITS[plan]
    const sub = membership.subscription

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
      if (!isUnderLimit(exportCount, limits.exportsPerMonth)) {
        return NextResponse.json(
          { error: 'LIMIT_REACHED', limit: 'exports', plan, max: limits.exportsPerMonth },
          { status: 403 }
        )
      }
    }
    // ── End export limit enforcement ──────────────────────────────────────────

    // ── Workspace + branding (single resolver) ────────────────────────────────
    const workspace = await prisma.workspace.findUnique({
      where: { id: membership.workspaceId },
    })

    const branding = resolveBranding({
      plan:          membership.subscription?.plan ?? 'FREE',
      workspaceName: workspace?.name ?? 'QBR Deck',
    })

    // ── Health score (use stored value, fall back to recompute) ───────────────
    const healthResult = resolveHealthScore(qbr)

    // ── Footer with live client name and quarter injected ─────────────────────
    const footerText = buildFooterText({
      branding,
      clientName: qbr.client.name,
      quarter:    qbr.quarter,
      year:       qbr.year,
    })

    // ── Resolve placeholders in all slide content ─────────────────────────────
    // Uses live client name — corrects typos without regeneration
    const placeholderCtx = buildPlaceholderContext({
      clientName:     qbr.client.name,
      clientIndustry: qbr.client.industry,
      quarter:        qbr.quarter,
      year:           qbr.year,
      workspaceName:  workspace?.name ?? 'QBR Deck',
      mspName:        branding.mspName,
      healthScore:    healthResult?.score  ?? qbr.healthScore,
      healthStatus:   healthResult?.status ?? (qbr as any).healthStatus,
      branding:       { ...branding, footerText },
      generatedAt:    qbr.createdAt,
    })

    const resolvedSlides = resolveSlides(
      qbr.slides as Array<Record<string, unknown>>,
      placeholderCtx
    )

    // ── Generate PPTX ─────────────────────────────────────────────────────────
    const buffer = await generatePPTX(
      resolvedSlides as any,
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

    // ── Export package tracking + billing ─────────────────────────────────────
    // Reuse existing package ID if PDF was already exported for this QBR.
    // PDF and PPTX share one exportPackageId — one credit consumed total.
    const existingEvent = await prisma.exportEvent.findFirst({
      where: { qbrId },
      orderBy: { exportedAt: 'asc' },
    })
    const exportPackageId = existingEvent?.exportPackageId ?? `pkg_${qbrId}`

    const isRedownload   = alreadyExported
    const consumedCredit = !alreadyExported

    await prisma.exportEvent.create({
      data: {
        id:                         `${Date.now()}_pptx_${qbrId}`,
        qbrId,
        workspaceId:                membership.workspaceId,
        clientId:                   qbr.client.id,
        exportedByUserId:           membership.userId,
        exportType:                 'PPTX',
        exportPackageId,
        isRedownload,
        consumedExportCredit:       consumedCredit,
        brandingMode:               branding.brandingMode,
        planAtExport:               plan,
        clientNameAtExport:         qbr.client.name,
        mspNameAtExport:            branding.mspName,
        healthScoreAtExport:        healthResult?.score  ?? qbr.healthScore  ?? null,
        healthStatusAtExport:       healthResult?.status ?? (qbr as any).healthStatus ?? null,
        healthScoreVersionAtExport: healthResult?.scoreVersion ?? qbr.healthScoreVersion ?? null,
        templateVersion:            VERSIONS.exportTemplate,
      },
    })

    // ── Update subscription export counters (first export only) ──────────────
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

    // ── Sanitize filename ─────────────────────────────────────────────────────
    const safeName = qbr.client.name.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim()

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type':        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${safeName}-QBR-Q${qbr.quarter}-${qbr.year}.pptx"`,
      },
    })

  } catch (err: any) {
    console.error('[export-pptx]', err)
    return NextResponse.json(
      { error: typeof err.message === 'string' ? err.message : 'Export failed' },
      { status: 500 }
    )
  }
}

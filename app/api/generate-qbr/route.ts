import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateQBRSlides } from '@/lib/anthropic'
import { getWorkspaceMembership } from '@/lib/workspace'
import { can } from '@/lib/permissions'
import { computeHealthScore } from '@/lib/health-score'
import { resolveBranding } from '@/lib/branding'
import { VERSIONS } from '@/lib/versions'
import { z } from 'zod'

const schema = z.object({
  clientId:            z.string(),
  quarter:             z.string(),
  year:                z.number(),
  tickets:             z.number().optional(),
  avgResolutionHrs:    z.number().optional(),
  uptimePct:           z.number().optional(),
  patchCompliancePct:  z.number().optional(),
  securityIncidents:   z.number().optional(),
  usersSupported:      z.number().optional(),
  ticketCategories:    z.string().optional(),
  wins:                z.string().optional(),
  upsellOpportunities: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.generateQBR(membership.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const data = schema.parse(body)

    // Verify client belongs to this workspace
    const client = await prisma.client.findFirst({
      where: { id: data.clientId, workspaceId: membership.workspaceId },
    })
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    // ── Limit enforcement ────────────────────────────────────────────────────
    const { PLAN_LIMITS, shouldResetPeriod, isUnderLimit } = await import('@/lib/limits')
    const plan = (membership.subscription?.plan ?? 'FREE') as keyof typeof PLAN_LIMITS
    const limits = PLAN_LIMITS[plan]
    const sub = membership.subscription

    if (sub && shouldResetPeriod(new Date(sub.periodStart))) {
      await prisma.subscription.update({
        where: { workspaceId: membership.workspaceId },
        data: { qbrCount: 0, exportCount: 0, periodStart: new Date() },
      })
      sub.qbrCount = 0
    }

    const clientCount = await prisma.client.count({ where: { workspaceId: membership.workspaceId } })
    if (!isUnderLimit(clientCount - 1, limits.clients)) {
      return NextResponse.json(
        { error: 'LIMIT_REACHED', limit: 'clients', plan, max: limits.clients },
        { status: 403 }
      )
    }

    const qbrCount = sub?.qbrCount ?? 0
    if (!isUnderLimit(qbrCount, limits.qbrsPerMonth)) {
      return NextResponse.json(
        { error: 'LIMIT_REACHED', limit: 'qbrs', plan, max: limits.qbrsPerMonth },
        { status: 403 }
      )
    }

    // ── Workspace + branding ─────────────────────────────────────────────────
    const workspace = await prisma.workspace.findUnique({
      where: { id: membership.workspaceId },
    })

    const branding = resolveBranding({
      plan:          membership.subscription?.plan ?? 'FREE',
      workspaceName: workspace?.name ?? 'QBR Deck',
    })

    // ── Health score — computed once here, stored on record ──────────────────
    const metrics = {
      uptimePct:          data.uptimePct,
      avgResolutionHrs:   data.avgResolutionHrs,
      patchCompliancePct: data.patchCompliancePct,
      securityIncidents:  data.securityIncidents,
      tickets:            data.tickets,
      usersSupported:     data.usersSupported,
    }
    const healthResult = computeHealthScore(metrics)

    // ── Generate slides ──────────────────────────────────────────────────────
    // Pass placeholder-friendly values — generator writes {{clientName}} etc.
    // into slide content instead of hardcoding mutable metadata.
    const slides = await generateQBRSlides({
      clientName: client.name,
      mspName:    branding.mspName ?? 'QBR Deck',
      ...data,
      // Pass computed score so generator can reference it consistently
      
    })

    // ── Raw metrics snapshot — structured for analytics queries ──────────────
    const rawMetrics = {
      tickets:            data.tickets            ?? null,
      avgResolutionHrs:   data.avgResolutionHrs   ?? null,
      uptimePct:          data.uptimePct           ?? null,
      patchCompliancePct: data.patchCompliancePct  ?? null,
      securityIncidents:  data.securityIncidents   ?? null,
      usersSupported:     data.usersSupported      ?? null,
      ticketCategories:   data.ticketCategories    ?? null,
      wins:               data.wins                ?? null,
      upsellOpportunities: data.upsellOpportunities ?? null,
    }

    // ── Generation-time audit snapshot ──────────────────────────────────────
    // Records state at generation — used for history/audit only.
    // Re-exports use live client/workspace values, not this snapshot.
    const user = await prisma.user.findUnique({ where: { clerkId } })
    const snapshot = {
      clientId:                data.clientId,
      clientNameAtGeneration:  client.name,
      clientIndustryAtGeneration: client.industry ?? null,
      workspaceId:             membership.workspaceId,
      workspaceNameAtGeneration: workspace?.name ?? null,
      planAtGeneration:        plan,
      brandingModeAtGeneration: branding.brandingMode,
      generatedByUserId:       membership.userId,
      generatedByUserEmail:    user?.email ?? null,
      generatedAt:             new Date().toISOString(),
      generatorVersion:        VERSIONS.generator,
      healthScoreVersion:      VERSIONS.healthScore,
      exportTemplateVersion:   VERSIONS.exportTemplate,
    }

    // ── Save QBR with all hardening fields ───────────────────────────────────
    const qbr = await prisma.qBR.create({
      data: {
        clientId:            client.id,
        createdById:         membership.userId,
        quarter:             data.quarter,
        year:                data.year,
        status:              'GENERATED',

        // Raw metric inputs (existing fields — unchanged)
        tickets:             data.tickets,
        avgResolutionHrs:    data.avgResolutionHrs,
        uptimePct:           data.uptimePct,
        patchCompliancePct:  data.patchCompliancePct,
        securityIncidents:   data.securityIncidents,
        usersSupported:      data.usersSupported,
        ticketCategories:    data.ticketCategories,
        wins:                data.wins,
        upsellOpportunities: data.upsellOpportunities,

        // Generated content
        slides:  slides as any,
        summary: slides[0]?.content ?? '',

        // ── Architecture hardening fields (new) ──────────────────────────────
        rawMetrics:           rawMetrics,
        healthScore:          healthResult.score,
        healthStatus:         healthResult.status,
        healthScoreVersion:   healthResult.scoreVersion,
        scoreBreakdown:       healthResult.deductions as any,
        snapshot:             snapshot,
        generatorVersion:     VERSIONS.generator,
        exportTemplateVersion: VERSIONS.exportTemplate,
      },
    })

    // ── Auto-suggest next QBR date ────────────────────────────────────────────
    const { suggestNextQbrDate } = await import('@/lib/reminder-utils')
    if (!client.nextQbrDate) {
      await prisma.client.update({
        where: { id: client.id },
        data: { nextQbrDate: suggestNextQbrDate(data.quarter, data.year) },
      })
    }

    // ── Increment workspace QBR counter ───────────────────────────────────────
    if (sub) {
      await prisma.subscription.update({
        where: { workspaceId: membership.workspaceId },
        data: { qbrCount: { increment: 1 } },
      })
    } else {
      await prisma.subscription.create({
        data: {
          workspaceId:     membership.workspaceId,
          stripeCustomerId: `free_${membership.workspaceId}`,
          plan:            'FREE',
          qbrCount:        1,
          exportCount:     0,
          periodStart:     new Date(),
        },
      })
    }

    return NextResponse.json({
      qbrId:        qbr.id,
      slides,
      healthScore:  healthResult.score,
      healthStatus: healthResult.status,
    })

  } catch (err: any) {
    console.error('[generate-qbr]', err)
    const message = typeof err.message === 'string'
      ? err.message
      : typeof err.error === 'string'
        ? err.error
        : 'Internal error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

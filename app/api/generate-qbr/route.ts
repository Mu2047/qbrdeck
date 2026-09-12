import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'
import { can } from '@/lib/permissions'
import { computeHealthScore } from '@/lib/health-score'
import { resolveBranding, buildFooterText } from '@/lib/branding'
import { resolveSlides, buildPlaceholderContext, sanitizeResolvedSlides } from '@/lib/placeholders'
import { VERSIONS } from '@/lib/versions'
import { lockWorkspaceRow } from '@/lib/workspace-lock'
import { z } from 'zod'
 
// Applies to the three free-text fields interpolated into the Anthropic
// prompt. Generous for real QBR business content, but bounds the request so
// an arbitrarily large document cannot be pasted in to inflate AI input-token
// cost before any generation call is made.
const MAX_FREE_TEXT_LENGTH = 2000

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
  ticketCategories:    z.string().max(MAX_FREE_TEXT_LENGTH).optional(),
  wins:                z.string().max(MAX_FREE_TEXT_LENGTH).optional(),
  upsellOpportunities: z.string().max(MAX_FREE_TEXT_LENGTH).optional(),
})
 
export async function POST(req: NextRequest) {
  // Declared outside the try block so the catch handler below can see
  // whether a quota unit was actually reserved and, if so, compensate it —
  // `const`s declared inside try are not visible to its own catch.
  let reservation: { workspaceId: string; periodStart: Date } | null = null
  // Set to true the instant the QBR row is durably persisted. Once true, a
  // later, unrelated failure (e.g. secondary reminder bookkeeping) must never
  // compensate the reservation — the customer already received a real,
  // billable, AI-generated QBR, so its quota unit is correctly spent.
  let qbrPersisted = false
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 
    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
 
    if (!can.generateQBR(membership.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
 
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const data = parsed.data

    const client = await prisma.client.findFirst({
  where: { id: data.clientId, workspaceId: membership.workspaceId, deletedAt: null },
})
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
 
    // ── Quota reservation ────────────────────────────────────────────────────
    // Locked, atomic, and committed BEFORE the Anthropic call: two concurrent
    // requests near a finite plan's limit can no longer both observe the same
    // pre-increment qbrCount and both be authorized to consume the last slot
    // (each waits for the Workspace row lock in turn, then re-reads current
    // state). No AI call happens inside this transaction — only the lock plus
    // a short read-check-write, mirroring the pattern already used for Client
    // capacity in app/api/clients/route.ts (see lib/workspace-lock.ts).
    const { PLAN_LIMITS, shouldResetPeriod, isUnderLimit } = await import('@/lib/limits')

    const reserveResult = await prisma.$transaction(async (tx) => {
      await lockWorkspaceRow(tx, membership.workspaceId)

      const freshSub = await tx.subscription.findUnique({
        where: { workspaceId: membership.workspaceId },
      })

      const plan   = (freshSub?.plan ?? 'FREE') as keyof typeof PLAN_LIMITS
      const limits = PLAN_LIMITS[plan]

      const periodNeedsReset = !!freshSub && shouldResetPeriod(new Date(freshSub.periodStart))
      const periodStart      = periodNeedsReset ? new Date() : (freshSub?.periodStart ?? new Date())
      const qbrCount         = periodNeedsReset ? 0 : (freshSub?.qbrCount ?? 0)

      if (!isUnderLimit(qbrCount, limits.qbrsPerMonth)) {
        // A period rollover was due even though the (now-reset) count is
        // still over the OLD period's limit — never true in practice since
        // reset always sets qbrCount to 0, but committing it here means a
        // workspace doesn't get stuck re-evaluating a stale period forever.
        if (periodNeedsReset) {
          await tx.subscription.update({
            where: { workspaceId: membership.workspaceId },
            data: { qbrCount: 0, exportCount: 0, periodStart },
          })
        }
        return { kind: 'limit_reached', plan, max: limits.qbrsPerMonth } as const
      }

      if (freshSub) {
        await tx.subscription.update({
          where: { workspaceId: membership.workspaceId },
          data: periodNeedsReset
            ? { qbrCount: 1, exportCount: 0, periodStart }
            : { qbrCount: { increment: 1 } },
        })
      } else {
        await tx.subscription.create({
          data: {
            workspaceId:      membership.workspaceId,
            stripeCustomerId: `free_${membership.workspaceId}`,
            plan:             'FREE',
            qbrCount:         1,
            exportCount:      0,
            periodStart,
          },
        })
      }

      return { kind: 'reserved', periodStart } as const
    })

    if (reserveResult.kind === 'limit_reached') {
      return NextResponse.json(
        { error: 'LIMIT_REACHED', limit: 'qbrs', plan: reserveResult.plan, max: reserveResult.max },
        { status: 403 }
      )
    }

    reservation = { workspaceId: membership.workspaceId, periodStart: reserveResult.periodStart }

    // ── Workspace + branding ──────────────────────────────────────────────────
    const workspace = await prisma.workspace.findUnique({
      where: { id: membership.workspaceId },
    })
 
    const branding = resolveBranding({
      plan:          membership.subscription?.plan ?? 'FREE',
      workspaceName: workspace?.name ?? 'QBR Deck',
    })
 
    // ── Health score — single source of truth ─────────────────────────────────
    const healthResult = computeHealthScore({
      uptimePct:          data.uptimePct,
      avgResolutionHrs:   data.avgResolutionHrs,
      patchCompliancePct: data.patchCompliancePct,
      securityIncidents:  data.securityIncidents,
      tickets:            data.tickets,
      usersSupported:     data.usersSupported,
    })
 
    const healthSummary = healthResult.deductions.length === 0
      ? 'Strong overall performance across all measured areas.'
      : `Improvement needed in: ${healthResult.deductions.map((d: { metric: string }) => d.metric).join(', ')}.`
 
    // ── Generate slides (dynamic import avoids Next.js route export conflict) ─
    const { generateQBRSlides } = await import('@/lib/anthropic')
    const slides = await generateQBRSlides(
      {
        clientName: client.name,
        mspName:    branding.mspName ?? 'QBR Deck',
        ...data,
      },
      healthResult.score,
      healthResult.status,
      healthSummary,
    )
 
    // ── Raw metrics + snapshot ────────────────────────────────────────────────
    const rawMetrics = {
      tickets:             data.tickets            ?? null,
      avgResolutionHrs:    data.avgResolutionHrs   ?? null,
      uptimePct:           data.uptimePct           ?? null,
      patchCompliancePct:  data.patchCompliancePct  ?? null,
      securityIncidents:   data.securityIncidents   ?? null,
      usersSupported:      data.usersSupported      ?? null,
      ticketCategories:    data.ticketCategories    ?? null,
      wins:                data.wins                ?? null,
      upsellOpportunities: data.upsellOpportunities ?? null,
    }
 
    const user = await prisma.user.findUnique({ where: { clerkId } })
    const snapshot = {
      clientId:                   data.clientId,
      clientNameAtGeneration:     client.name,
      clientIndustryAtGeneration: client.industry ?? null,
      workspaceId:                membership.workspaceId,
      workspaceNameAtGeneration:  workspace?.name ?? null,
      planAtGeneration:           membership.subscription?.plan ?? 'FREE',
      brandingModeAtGeneration:   branding.brandingMode,
      generatedByUserId:          membership.userId,
      generatedByUserEmail:       user?.email ?? null,
      generatedAt:                new Date().toISOString(),
      generatorVersion:           VERSIONS.generator,
      healthScoreVersion:         VERSIONS.healthScore,
      exportTemplateVersion:      VERSIONS.exportTemplate,
    }
 
    // ── Save QBR ──────────────────────────────────────────────────────────────
    const qbr = await prisma.qBR.create({
      data: {
        client: {
          connect: {
            id_workspaceId: { id: client.id, workspaceId: client.workspaceId },
          },
        },
        workspace: {
          connect: { id: client.workspaceId },
        },
        createdBy: {
          connect: { id: membership.userId },
        },
        quarter:              data.quarter,
        year:                 data.year,
        status:               'GENERATED',
        tickets:              data.tickets,
        avgResolutionHrs:     data.avgResolutionHrs,
        uptimePct:            data.uptimePct,
        patchCompliancePct:   data.patchCompliancePct,
        securityIncidents:    data.securityIncidents,
        usersSupported:       data.usersSupported,
        ticketCategories:     data.ticketCategories,
        wins:                 data.wins,
        upsellOpportunities:  data.upsellOpportunities,
        slides:               slides as any,
        summary:              slides[0]?.content ?? '',
        rawMetrics,
        healthScore:          healthResult.score,
        healthStatus:         healthResult.status,
        healthScoreVersion:   healthResult.scoreVersion,
        scoreBreakdown:       healthResult.deductions as any,
        snapshot,
        generatorVersion:     VERSIONS.generator,
        exportTemplateVersion: VERSIONS.exportTemplate,
      },
    })
    // The QBR is now durably persisted — no failure from here on may cause
    // its already-reserved quota unit to be compensated.
    qbrPersisted = true

    // ── Resolve placeholders for the immediate preview (display only) ─────────
    // qbr.slides was just persisted above as the RAW AI output, unchanged —
    // this resolved copy exists only in the API response below, for the
    // preview step to render. Nothing here is written back to the database.
    const footerText = buildFooterText({
      branding,
      clientName: client.name,
      quarter:    data.quarter,
      year:       data.year,
    })

    const placeholderCtx = buildPlaceholderContext({
      clientName:     client.name,
      clientIndustry: client.industry,
      quarter:        data.quarter,
      year:           data.year,
      workspaceName:  workspace?.name ?? 'QBR Deck',
      mspName:        branding.mspName,
      healthScore:    healthResult.score,
      healthStatus:   healthResult.status,
      branding:       { ...branding, footerText },
      generatedAt:    qbr.createdAt,
    })

    const resolvedSlides = resolveSlides(
      slides as unknown as Array<Record<string, unknown>>,
      placeholderCtx
    )

    // ── Defensive guard: sanitize the preview display copy before it is
    // returned. Raw qbr.slides (persisted above) is untouched.
    const { slides: safeResolvedSlides, hadUnresolvedTokens } = sanitizeResolvedSlides(resolvedSlides)
    if (hadUnresolvedTokens) {
      console.error('[unresolved-placeholder][generate-qbr]', qbr.id)
    }

    // ── Auto-suggest next QBR date — best-effort, isolated ────────────────────
    // Secondary bookkeeping only: the QBR itself is already fully persisted
    // (qbrPersisted is already true). A failure here must never turn an
    // already-successful generation into a customer-facing failure, and must
    // never reach the outer catch's compensation logic.
    try {
      const { suggestNextQbrDate } = await import('@/lib/reminder-utils')
      if (!client.nextQbrDate) {
        await prisma.client.update({
          where: { id: client.id },
          data: { nextQbrDate: suggestNextQbrDate(data.quarter, data.year) },
        })
      }
    } catch (reminderErr) {
      console.error('[generate-qbr] Failed to update next QBR reminder', reminderErr)
    }

    // QBR quota was already atomically reserved above, before the Anthropic
    // call — no further increment here.

    return NextResponse.json({
      qbrId:        qbr.id,
      slides:       safeResolvedSlides,
      clientName:   client.name,
      healthScore:  healthResult.score,
      healthStatus: healthResult.status,
    })
 
  } catch (err: any) {
    console.error('[generate-qbr]', err)
    // Never compensate a reservation whose QBR was already durably
    // persisted — only a pre-persistence failure (auth/quota/Anthropic/
    // parsing/QBR-create itself) may return the reserved unit.
    if (reservation && !qbrPersisted) {
      await compensateQbrReservation(reservation.workspaceId, reservation.periodStart)
    }
    return NextResponse.json({ error: 'Failed to generate QBR' }, { status: 500 })
  }
}

// Best-effort compensation for a quota unit reserved before a since-failed
// Anthropic call or persistence step — preserves the existing product
// semantic that a failed generation does not permanently consume quota.
// Re-acquires the same Workspace row lock used for the reservation itself
// (never a process-local lock — must stay correct across separate Vercel
// function instances), and only decrements if the billing period the
// reservation was made against is still the current one: a period reset
// between reservation and compensation means this slot no longer belongs to
// the count now being tracked, so it is intentionally left alone rather than
// risk decrementing a newer period's real usage. Never decrements below zero,
// and never targets anything but this workspace's own aggregate counter, so
// it cannot claw back a different, already-completed generation.
async function compensateQbrReservation(workspaceId: string, reservedPeriodStart: Date): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await lockWorkspaceRow(tx, workspaceId)

      const sub = await tx.subscription.findUnique({ where: { workspaceId } })
      if (!sub) return
      if (sub.periodStart.getTime() !== reservedPeriodStart.getTime()) return
      if (sub.qbrCount <= 0) return

      await tx.subscription.update({
        where: { workspaceId },
        data: { qbrCount: { decrement: 1 } },
      })
    })
  } catch (compErr) {
    console.error('[generate-qbr] Quota compensation failed', compErr)
  }
}

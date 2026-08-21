import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'

// No clientId field — the target Client is resolved exclusively from
// WorkspaceOnboarding.onboardingClientId, never from the browser. See P2
// onboarding preflight, "QBR request authority".
const qbrSchema = z.object({
  retryKey:            z.string().uuid(),
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
}).strict()

// Thrown only for the one legitimate concurrency race this endpoint must
// detect: the conditional WorkspaceOnboarding claim lost. Never used to
// mask an unexpected/programming error as a conflict.
class ClaimLostError extends Error {}

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const parsed = qbrSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { workspaceId, userId } = membership
    const data = parsed.data

    // ── Authenticated, workspace-scoped onboarding read + owner identity ───────
    // Eligibility here is exact onboardingOwnerUserId identity only — never
    // TeamRole. See P2 onboarding preflight, Correction 3.
    const onboarding = await prisma.workspaceOnboarding.findUnique({ where: { workspaceId } })
    if (!onboarding) {
      return NextResponse.json({ error: 'Onboarding not found' }, { status: 409 })
    }
    if (onboarding.onboardingOwnerUserId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // ── Idempotent replay check — BEFORE quota, health score, or any AI call ──
    const replayResult = await tryReplay(onboarding, workspaceId, data.retryKey)
    if (replayResult) return replayResult

    // ── Fresh-path state guard — exact shape only, never "further along" ───────
    const isFreshState =
      onboarding.status === 'IN_PROGRESS' &&
      onboarding.currentStep === 'FIRST_QBR' &&
      onboarding.onboardingClientId != null &&
      onboarding.onboardingQbrId === null
    if (!isFreshState) {
      return NextResponse.json({ error: 'Onboarding state conflict' }, { status: 409 })
    }

    // ── Anchored Client — resolved server-side, verified non-deleted and
    // workspace-scoped. Never a browser-supplied clientId. ─────────────────────
    const anchoredClient = await prisma.client.findFirst({
      where: { id: onboarding.onboardingClientId!, workspaceId, deletedAt: null },
    })
    if (!anchoredClient) {
      return NextResponse.json({ error: 'Onboarding state conflict' }, { status: 409 })
    }

    // ── Subscription period rollover + effective quota (legitimate
    // qbrsPerMonth check only — never the suspicious client-count check
    // that lives in app/api/generate-qbr/route.ts). ────────────────────────────
    const { getLimits, isUnderLimit, shouldResetPeriod } = await import('@/lib/limits')
    const plan = membership.subscription?.plan ?? 'FREE'
    const limits = getLimits(plan)
    const sub = membership.subscription

    let effectiveQbrCount = sub?.qbrCount ?? 0
    if (sub && shouldResetPeriod(new Date(sub.periodStart))) {
      await prisma.subscription.update({
        where: { workspaceId },
        data: { qbrCount: 0, exportCount: 0, periodStart: new Date() },
      })
      // Never continue using the stale pre-reset in-memory count.
      effectiveQbrCount = 0
    }

    if (!isUnderLimit(effectiveQbrCount, limits.qbrsPerMonth)) {
      return NextResponse.json(
        { error: 'LIMIT_REACHED', limit: 'qbrs', plan, max: limits.qbrsPerMonth },
        { status: 403 }
      )
    }

    // ── Health score + AI generation — OUTSIDE the transaction ─────────────────
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } })
    const { resolveBranding } = await import('@/lib/branding')
    const branding = resolveBranding({ plan, workspaceName: workspace?.name ?? 'QBR Deck' })

    const { computeHealthScore } = await import('@/lib/health-score')
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

    const { generateQBRSlides } = await import('@/lib/anthropic')
    const slides = await generateQBRSlides(
      {
        clientName: anchoredClient.name,
        mspName:    branding.mspName ?? 'QBR Deck',
        ...data,
      },
      healthResult.score,
      healthResult.status,
      healthSummary,
    )

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
    const { VERSIONS } = await import('@/lib/versions')
    const snapshot = {
      clientId:                   anchoredClient.id,
      clientNameAtGeneration:     anchoredClient.name,
      clientIndustryAtGeneration: anchoredClient.industry ?? null,
      workspaceId,
      workspaceNameAtGeneration:  workspace?.name ?? null,
      planAtGeneration:           plan,
      brandingModeAtGeneration:   branding.brandingMode,
      generatedByUserId:          userId,
      generatedByUserEmail:       user?.email ?? null,
      generatedAt:                new Date().toISOString(),
      generatorVersion:           VERSIONS.generator,
      healthScoreVersion:         VERSIONS.healthScore,
      exportTemplateVersion:      VERSIONS.exportTemplate,
    }

    const { suggestNextQbrDate } = await import('@/lib/reminder-utils')

    // ── Winning transaction — deterministic persistence only ───────────────────
    try {
      const qbr = await prisma.$transaction(async (tx) => {
        const created = await tx.qBR.create({
          data: {
            client: {
              connect: { id_workspaceId: { id: anchoredClient.id, workspaceId } },
            },
            workspace: { connect: { id: workspaceId } },
            createdBy: { connect: { id: userId } },
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

        // Same "only if currently unset" semantics as generate-qbr, but as a
        // conditional transactional write rather than a read-then-write on a
        // possibly-stale pre-AI value — avoids overwriting a date another
        // request may have established while AI was running.
        await tx.client.updateMany({
          where: { id: anchoredClient.id, workspaceId, nextQbrDate: null },
          data: { nextQbrDate: suggestNextQbrDate(data.quarter, data.year) },
        })

        // Upsert avoids the avoidable unique-constraint race on
        // Subscription.workspaceId between concurrent first-ever-QBR
        // requests, instead of a manual "exists ? update : create" branch.
        await tx.subscription.upsert({
          where: { workspaceId },
          update: { qbrCount: { increment: 1 } },
          create: {
            workspaceId,
            stripeCustomerId: `free_${workspaceId}`,
            plan:             'FREE',
            qbrCount:         1,
            exportCount:      0,
            periodStart:      new Date(),
          },
        })

        const claim = await tx.workspaceOnboarding.updateMany({
          where: {
            workspaceId,
            status:                'IN_PROGRESS',
            currentStep:           'FIRST_QBR',
            onboardingOwnerUserId: userId,
            onboardingClientId:    anchoredClient.id,
            onboardingQbrId:       null,
          },
          data: {
            onboardingQbrId:       created.id,
            qbrStepIdempotencyKey: data.retryKey,
            currentStep:           'REVIEW_QBR',
          },
        })
        // Prisma rolls back the whole transaction on throw — QBR create,
        // Client metadata write, subscription usage write, and any
        // onboarding change together. No manual qBR.delete anywhere.
        if (claim.count !== 1) throw new ClaimLostError()

        return created
      })

      return NextResponse.json({ qbrId: qbr.id }, { status: 201 })
    } catch (err) {
      // Known conflict/race paths only: our own claim-lost signal, or a
      // unique-constraint violation from a genuinely concurrent transaction.
      // Any other error is unexpected and must retain normal 500 handling —
      // never silently reclassified as a 409.
      const isKnownRace =
        err instanceof ClaimLostError ||
        (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
      if (isKnownRace) {
        return await classifyQbrConflict(workspaceId, userId, data.retryKey)
      }
      throw err
    }
  } catch (err: any) {
    console.error('[onboarding-qbr]', err)
    const message = typeof err.message === 'string' ? err.message : 'Internal error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function tryReplay(
  onboarding: { status: string; currentStep: string | null; onboardingQbrId: string | null; qbrStepIdempotencyKey: string | null },
  workspaceId: string,
  retryKey: string,
) {
  const isReplay =
    onboarding.status === 'IN_PROGRESS' &&
    onboarding.currentStep === 'REVIEW_QBR' &&
    onboarding.onboardingQbrId != null &&
    onboarding.qbrStepIdempotencyKey === retryKey

  if (!isReplay) return null

  const qbr = await prisma.qBR.findFirst({ where: { id: onboarding.onboardingQbrId!, workspaceId } })
  if (!qbr) {
    return NextResponse.json({ error: 'Onboarding state conflict' }, { status: 409 })
  }
  return NextResponse.json({ qbrId: qbr.id }, { status: 200 })
}

// Re-read after a lost/raced claim (post-rollback) and classify: an exact
// matching retry result is a successful idempotent replay; anything else is
// a genuine conflict, never silently treated as success.
async function classifyQbrConflict(workspaceId: string, userId: string, retryKey: string) {
  const onboarding = await prisma.workspaceOnboarding.findUnique({ where: { workspaceId } })
  if (!onboarding) {
    return NextResponse.json({ error: 'Onboarding not found' }, { status: 409 })
  }
  if (onboarding.onboardingOwnerUserId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (
    onboarding.status === 'IN_PROGRESS' &&
    onboarding.currentStep === 'REVIEW_QBR' &&
    onboarding.onboardingQbrId != null &&
    onboarding.qbrStepIdempotencyKey === retryKey
  ) {
    const qbr = await prisma.qBR.findFirst({ where: { id: onboarding.onboardingQbrId, workspaceId } })
    if (qbr) {
      return NextResponse.json({ qbrId: qbr.id }, { status: 200 })
    }
  }
  return NextResponse.json({ error: 'Onboarding state conflict' }, { status: 409 })
}

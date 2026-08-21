import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'
import { isSkippableStep, skipTransitionFor } from '@/lib/onboarding'

// .strict() — the client identifies only the step it is skipping. Identity
// (userId/workspaceId) and current state are always re-derived server-side
// below, never taken from the request body. See P2 onboarding PR 7 preflight.
const skipSchema = z.object({
  step: z.enum(['EXPORT_QBR', 'SHARE_QBR']),
}).strict()

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

    const parsed = skipSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { step } = parsed.data
    if (!isSkippableStep(step)) {
      return NextResponse.json({ error: 'Invalid step' }, { status: 400 })
    }

    const { workspaceId, userId } = membership
    const { toStep } = skipTransitionFor(step)

    // Explicit per-step data shape (not a computed column key) so each
    // branch stays a plain, statically-typed Prisma update payload — the
    // target step itself still comes from the single skipTransitionFor
    // table above, so the two transitions are never hand-duplicated.
    const result = step === 'EXPORT_QBR'
      ? await prisma.workspaceOnboarding.updateMany({
          where: {
            workspaceId,
            status:                'IN_PROGRESS',
            onboardingOwnerUserId: userId,
            currentStep:           'EXPORT_QBR',
          },
          data: { exportSkippedAt: new Date(), currentStep: 'SHARE_QBR' },
        })
      : await prisma.workspaceOnboarding.updateMany({
          where: {
            workspaceId,
            status:                'IN_PROGRESS',
            onboardingOwnerUserId: userId,
            currentStep:           'SHARE_QBR',
          },
          data: { shareSkippedAt: new Date(), currentStep: 'COMPLETE' },
        })

    if (result.count === 1) {
      return NextResponse.json({ currentStep: toStep })
    }

    // count === 0 — classify: a lost-response retry of an already-applied
    // skip must succeed idempotently; anything else is a genuine conflict.
    const onboarding = await prisma.workspaceOnboarding.findUnique({ where: { workspaceId } })

    if (!onboarding) {
      return NextResponse.json({ error: 'Onboarding not found' }, { status: 409 })
    }
    if (onboarding.onboardingOwnerUserId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Idempotent retry: only exact achieved-state equality (currentStep at
    // the exact target AND the exact skip marker set) counts as success. A
    // row further along than toStep, or one advanced by a plain Continue
    // (skip marker still null), is a genuine conflict — never masked as
    // success here.
    const skippedExactly =
      onboarding.status === 'IN_PROGRESS' &&
      onboarding.currentStep === toStep &&
      (step === 'EXPORT_QBR' ? onboarding.exportSkippedAt != null : onboarding.shareSkippedAt != null)

    if (skippedExactly) {
      return NextResponse.json({ currentStep: toStep })
    }

    return NextResponse.json({ error: 'Onboarding state conflict' }, { status: 409 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

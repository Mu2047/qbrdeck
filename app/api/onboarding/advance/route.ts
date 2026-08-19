import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'
import { isAdvanceableStep, requiredFromStepFor } from '@/lib/onboarding'

// .strict() so an unexpected key (workspaceId, userId, onboardingOwnerUserId,
// fromStep, role, ...) is rejected outright rather than silently ignored —
// the client is never trusted to supply anything but the step it wants to
// move to. Identity (userId/workspaceId) and current state (fromStep) are
// always re-derived server-side below, never taken from the request body.
const advanceSchema = z.object({
  toStep: z.enum(['WORKSPACE_NAME', 'FIRST_CLIENT']),
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

    const parsed = advanceSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { toStep } = parsed.data
    if (!isAdvanceableStep(toStep)) {
      return NextResponse.json({ error: 'Invalid toStep' }, { status: 400 })
    }

    const fromStep = requiredFromStepFor(toStep)
    const { workspaceId, userId } = membership

    // Atomic conditional write: the where clause IS the authorization +
    // concurrency boundary. No TeamRole is consulted anywhere in this
    // query — only exact onboardingOwnerUserId identity and the exact
    // persisted currentStep this transition requires.
    const result = await prisma.workspaceOnboarding.updateMany({
      where: {
        workspaceId,
        status:                'IN_PROGRESS',
        onboardingOwnerUserId: userId,
        currentStep:           fromStep,
      },
      data: { currentStep: toStep },
    })

    if (result.count === 1) {
      return NextResponse.json({ currentStep: toStep })
    }

    // count === 0 — classify: a lost-response retry of an already-applied
    // transition must succeed idempotently; anything else is a genuine
    // conflict and must not be silently treated as success.
    const onboarding = await prisma.workspaceOnboarding.findUnique({
      where: { workspaceId },
    })

    if (!onboarding) {
      return NextResponse.json({ error: 'Onboarding not found' }, { status: 409 })
    }

    if (onboarding.onboardingOwnerUserId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Idempotent retry: only exact achieved-state equality counts as
    // success. A row further along than toStep, or in any other shape, is
    // a genuine conflict — never masked as success here.
    if (onboarding.status === 'IN_PROGRESS' && onboarding.currentStep === toStep) {
      return NextResponse.json({ currentStep: toStep })
    }

    return NextResponse.json({ error: 'Onboarding state conflict' }, { status: 409 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

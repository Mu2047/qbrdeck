import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'

// No request body authority — the client sends nothing, the server always
// re-derives workspace/user from the authenticated session. Completion is
// authoritative only through this endpoint; reaching currentStep ===
// COMPLETE never implies status === COMPLETED on its own. See P2 onboarding
// PR 7 preflight.
export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { workspaceId, userId } = membership

    // Atomic conditional write: the where clause IS the authorization +
    // concurrency boundary. No TeamRole is consulted — only exact
    // onboardingOwnerUserId identity and the exact persisted currentStep.
    const result = await prisma.workspaceOnboarding.updateMany({
      where: {
        workspaceId,
        status:                'IN_PROGRESS',
        currentStep:           'COMPLETE',
        onboardingOwnerUserId: userId,
      },
      data: { status: 'COMPLETED', currentStep: 'COMPLETE', completedAt: new Date() },
    })

    if (result.count === 1) {
      return NextResponse.json({ status: 'COMPLETED' })
    }

    // count === 0 — classify: a lost-response retry of an already-applied
    // completion must succeed idempotently; anything else is a genuine
    // conflict and must not be silently treated as success.
    const onboarding = await prisma.workspaceOnboarding.findUnique({ where: { workspaceId } })

    if (!onboarding) {
      return NextResponse.json({ error: 'Onboarding not found' }, { status: 409 })
    }
    if (onboarding.onboardingOwnerUserId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Idempotent retry: only exact achieved-completion equality counts as
    // success — status COMPLETED, currentStep COMPLETE, completedAt set,
    // same anchored owner. Any other shape is a genuine conflict.
    if (
      onboarding.status === 'COMPLETED' &&
      onboarding.currentStep === 'COMPLETE' &&
      onboarding.completedAt != null
    ) {
      return NextResponse.json({ status: 'COMPLETED' })
    }

    return NextResponse.json({ error: 'Onboarding state conflict' }, { status: 409 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

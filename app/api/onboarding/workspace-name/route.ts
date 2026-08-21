import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'

// Strict — no workspaceId/userId/ownerId/currentStep/toStep/role field. The
// browser supplies only the requested name; identity and current state are
// always re-derived server-side. See P2 onboarding PR 8 preflight,
// "Workspace Name — must-fix": the generic PATCH /api/workspace requires
// TeamRole OWNER, but onboarding eligibility is anchored to
// onboardingOwnerUserId, not role — an anchored creator demoted from OWNER
// (a normal, permitted product action by a co-owner) would otherwise be
// permanently stranded at this step once the dashboard gate is authoritative.
const bodySchema = z.object({
  name: z.string(),
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

    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    // Normalized once, up front — every comparison and write below (fresh
    // write, replay classification) uses this exact same trimmed value.
    const normalizedName = parsed.data.name.trim()
    if (!normalizedName) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const { workspaceId, userId } = membership

    // ── Authenticated, workspace-scoped onboarding read + owner identity ───────
    // Eligibility here is exact onboardingOwnerUserId identity only — never
    // TeamRole. This is deliberately creator-anchor authority for onboarding
    // only; the generic PATCH /api/workspace's OWNER-role requirement is
    // untouched and still governs every non-onboarding rename.
    const onboarding = await prisma.workspaceOnboarding.findUnique({ where: { workspaceId } })
    if (!onboarding) {
      return NextResponse.json({ error: 'Onboarding not found' }, { status: 409 })
    }
    if (onboarding.onboardingOwnerUserId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // ── Fresh-path state guard — exact shape only, never "further along" ───────
    const isFreshState =
      onboarding.status === 'IN_PROGRESS' &&
      onboarding.currentStep === 'WORKSPACE_NAME'
    if (!isFreshState) {
      return await classifyReplay(workspaceId, userId, normalizedName)
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.workspace.update({
          where: { id: workspaceId },
          data:  { name: normalizedName },
        })

        const claim = await tx.workspaceOnboarding.updateMany({
          where: {
            workspaceId,
            status:                'IN_PROGRESS',
            currentStep:           'WORKSPACE_NAME',
            onboardingOwnerUserId: userId,
          },
          data: { currentStep: 'FIRST_CLIENT' },
        })
        // Prisma rolls back the whole transaction on throw — including the
        // workspace rename above. No partial rename is ever left behind.
        if (claim.count !== 1) throw new ClaimLostError()
      })

      return NextResponse.json({ name: normalizedName, currentStep: 'FIRST_CLIENT' }, { status: 200 })
    } catch (err) {
      if (err instanceof ClaimLostError) {
        return await classifyReplay(workspaceId, userId, normalizedName)
      }
      throw err
    }
  } catch (err: any) {
    console.error('[onboarding-workspace-name]', err)
    return NextResponse.json({ error: err.message ?? 'Internal error' }, { status: 500 })
  }
}

// Re-read after a lost/raced claim, or when the fresh-path guard already
// failed, and classify: an exact matching retry result is a successful
// idempotent replay; anything else — including any state further ahead than
// FIRST_CLIENT — is a genuine conflict, never silently treated as success.
async function classifyReplay(workspaceId: string, userId: string, normalizedName: string) {
  const onboarding = await prisma.workspaceOnboarding.findUnique({ where: { workspaceId } })
  if (!onboarding) {
    return NextResponse.json({ error: 'Onboarding not found' }, { status: 409 })
  }
  if (onboarding.onboardingOwnerUserId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (
    onboarding.status === 'IN_PROGRESS' &&
    onboarding.currentStep === 'FIRST_CLIENT'
  ) {
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } })
    if (workspace && workspace.name === normalizedName) {
      return NextResponse.json({ name: workspace.name, currentStep: 'FIRST_CLIENT' }, { status: 200 })
    }
  }

  return NextResponse.json({ error: 'Onboarding state conflict' }, { status: 409 })
}

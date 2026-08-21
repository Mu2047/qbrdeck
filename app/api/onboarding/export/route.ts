import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'
import { can } from '@/lib/permissions'
import { performQbrExport, ExportQbrNotFoundError, ExportNoSlidesError, ExportLimitError } from '@/lib/qbr-export'

// No qbrId/clientId/workspaceId/userId field — the target QBR is resolved
// exclusively from WorkspaceOnboarding.onboardingQbrId, never from the
// browser. See P2 onboarding PR 7 preflight, Correction 2.
const bodySchema = z.object({
  format: z.enum(['pdf', 'pptx']),
}).strict()

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    if (!can.exportQBR(membership.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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

    const { workspaceId, userId } = membership
    const { format } = parsed.data

    // ── Authenticated, workspace-scoped onboarding read + owner identity ───────
    const onboarding = await prisma.workspaceOnboarding.findUnique({ where: { workspaceId } })
    if (!onboarding) {
      return NextResponse.json({ error: 'Onboarding not found' }, { status: 409 })
    }
    if (onboarding.onboardingOwnerUserId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (
      onboarding.status !== 'IN_PROGRESS' ||
      onboarding.currentStep !== 'EXPORT_QBR' ||
      onboarding.onboardingClientId == null ||
      onboarding.onboardingQbrId == null
    ) {
      return NextResponse.json({ error: 'Onboarding state conflict' }, { status: 409 })
    }

    // ── Anchored QBR — resolved server-side, verified workspace/client
    // scoped and non-deleted. Never a browser-supplied qbrId. ───────────────────
    const anchoredQbr = await prisma.qBR.findFirst({
      where: {
        id:          onboarding.onboardingQbrId,
        workspaceId,
        clientId:    onboarding.onboardingClientId,
        deletedAt:   null,
      },
    })
    if (!anchoredQbr) {
      return NextResponse.json({ error: 'Onboarding state conflict' }, { status: 409 })
    }

    // ── Exact existing export semantics — quota, redownload/consumedCredit,
    // ExportEvent, Subscription.exportCount, qbr.status — unchanged. ───────────
    const { buffer, filename, contentType } = await performQbrExport(membership, anchoredQbr.id, format)

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type':        contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err: any) {
    if (err instanceof ExportQbrNotFoundError) {
      return NextResponse.json({ error: 'Onboarding state conflict' }, { status: 409 })
    }
    if (err instanceof ExportNoSlidesError) {
      return NextResponse.json({ error: 'QBR has no generated slides' }, { status: 400 })
    }
    if (err instanceof ExportLimitError) {
      return NextResponse.json(
        { error: 'LIMIT_REACHED', limit: 'exports', plan: err.plan, max: err.max },
        { status: 403 }
      )
    }
    console.error('[onboarding-export]', err)
    return NextResponse.json({ error: err.message ?? 'Internal error' }, { status: 500 })
  }
}

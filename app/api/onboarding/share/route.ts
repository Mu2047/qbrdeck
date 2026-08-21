import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'
import { can } from '@/lib/permissions'
import { createShareLink } from '@/lib/share-links'
import { sendQBREmail } from '@/lib/email'

// No qbrId/clientId/workspaceId/userId field — the target QBR is resolved
// exclusively from WorkspaceOnboarding.onboardingQbrId, never from the
// browser. See P2 onboarding PR 7 preflight, Correction 2B.
const linkSchema = z.object({ action: z.literal('link') }).strict()
const emailSchema = z.object({ action: z.literal('email'), email: z.string().email() }).strict()
const bodySchema = z.discriminatedUnion('action', [linkSchema, emailSchema])

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
      onboarding.currentStep !== 'SHARE_QBR' ||
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
      include: { client: true },
    })
    if (!anchoredQbr) {
      return NextResponse.json({ error: 'Onboarding state conflict' }, { status: 409 })
    }

    if (parsed.data.action === 'link') {
      const token = await createShareLink({ qbrId: anchoredQbr.id, workspaceId, userId })
      return NextResponse.json({ token })
    }

    // action === 'email' — always mints a fresh, hashed ShareLink for the
    // emailed link, exactly like the generic send route.
    const token = await createShareLink({ qbrId: anchoredQbr.id, workspaceId, userId })
    const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/${token}`
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } })
    const mspName = workspace?.name ?? 'MI Secure Tech Solutions'

    await sendQBREmail({
      to:         parsed.data.email,
      clientName: anchoredQbr.client.name,
      quarter:    anchoredQbr.quarter,
      year:       anchoredQbr.year,
      mspName,
      portalUrl,
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[onboarding-share]', err)
    return NextResponse.json({ error: err.message ?? 'Failed to share' }, { status: 500 })
  }
}

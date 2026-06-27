import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendQBREmail } from '@/lib/email'
import { getWorkspaceMembership } from '@/lib/workspace'
import { can } from '@/lib/permissions'
import { createShareLink, hashShareToken } from '@/lib/share-links'
export async function POST(req: NextRequest, { params }: { params: { qbrId: string } }) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.exportQBR(membership.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { email } = await req.json()
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

    const qbr = await prisma.qBR.findFirst({
      where: { id: params.qbrId, workspaceId: membership.workspaceId, deletedAt: null },
      include: { client: true },
    })

    if (!qbr) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Always mint a fresh, hashed ShareLink for the emailed link
    const token = await createShareLink({
      qbrId:       qbr.id,
      workspaceId: membership.workspaceId,
      userId:      membership.userId,
    })

    const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/${token}`
    const workspace = await prisma.workspace.findUnique({
      where: { id: membership.workspaceId },
    })
    const mspName = workspace?.name ?? 'MI Secure Tech Solutions'

    await sendQBREmail({
      to: email,
      clientName: qbr.client.name,
      quarter: qbr.quarter,
      year: qbr.year,
      mspName,
      portalUrl,
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[send-qbr]', err)
    return NextResponse.json({ error: err.message ?? 'Failed to send' }, { status: 500 })
  }
}
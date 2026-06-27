import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'
import { can } from '@/lib/permissions'
import { createShareLink } from '@/lib/share-links'

export async function POST(req: NextRequest, { params }: { params: { qbrId: string } }) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.exportQBR(membership.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const qbr = await prisma.qBR.findFirst({
      where: { id: params.qbrId, workspaceId: membership.workspaceId, deletedAt: null },
    })
    if (!qbr) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const token = await createShareLink({
      qbrId:       qbr.id,
      workspaceId: membership.workspaceId,
      userId:      membership.userId,
    })

    return NextResponse.json({ token })
  } catch (err: any) {
    console.error('[share]', err)
    return NextResponse.json({ error: 'Failed to create share link' }, { status: 500 })
  }
}

// Revoke all active share links for this QBR
export async function DELETE(req: NextRequest, { params }: { params: { qbrId: string } }) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.exportQBR(membership.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // Scope the revoke to this workspace's links only
    await prisma.shareLink.updateMany({
      where: { qbrId: params.qbrId, workspaceId: membership.workspaceId, revokedAt: null },
      data:  { revokedAt: new Date() },
    })

    // Also clear the legacy plaintext token so old links die too
    await prisma.qBR.updateMany({
      where: { id: params.qbrId, workspaceId: membership.workspaceId },
      data:  { shareToken: null },
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[share:revoke]', err)
    return NextResponse.json({ error: 'Failed to revoke' }, { status: 500 })
  }
}
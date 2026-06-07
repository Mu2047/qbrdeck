import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'
import { can } from '@/lib/permissions'
import { randomBytes } from 'crypto'

export async function POST(req: NextRequest, { params }: { params: { qbrId: string } }) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.exportQBR(membership.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const qbr = await prisma.qBR.findFirst({
      where: { id: params.qbrId },
      include: { client: true },
    })

    if (!qbr || qbr.client.workspaceId !== membership.workspaceId)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const token = qbr.shareToken ?? randomBytes(16).toString('hex')

    await prisma.qBR.update({
      where: { id: params.qbrId },
      data:  { shareToken: token },
    })

    return NextResponse.json({ token })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
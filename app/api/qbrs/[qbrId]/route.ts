import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'
import { can } from '@/lib/permissions'

export async function GET(req: NextRequest, { params }: { params: { qbrId: string } }) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.viewQBR(membership.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const qbr = await prisma.qBR.findFirst({
      where: { id: params.qbrId },
      include: { client: true },
    })

    if (!qbr || qbr.client.workspaceId !== membership.workspaceId)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json(qbr)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { qbrId: string } }) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.generateQBR(membership.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const qbr = await prisma.qBR.findFirst({
      where: { id: params.qbrId },
      include: { client: true },
    })

    if (!qbr || qbr.client.workspaceId !== membership.workspaceId)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { slides } = await req.json()

    const updated = await prisma.qBR.update({
      where: { id: params.qbrId },
      data:  { slides },
    })

    return NextResponse.json(updated)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
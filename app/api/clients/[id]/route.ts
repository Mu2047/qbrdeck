import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'
import { can } from '@/lib/permissions'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.viewClients(membership.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const client = await prisma.client.findFirst({
      where: { id: params.id, workspaceId: membership.workspaceId, deletedAt: null },
      include: { qbrs: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } } },
    })
    if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json(client)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    const body = await req.json()

    // nextQbrDate-only patch (from reminder editor) requires only ADMIN
    // Full client edit also requires ADMIN
    if (!can.editClient(membership.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const client = await prisma.client.findFirst({
      where: { id: params.id, workspaceId: membership.workspaceId, deletedAt: null },
    })
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    const name = (body.name ?? client.name).trim().replace(/\s+/g, ' ')
    if (!name) return NextResponse.json({ error: 'Client name is required' }, { status: 400 })

    const updated = await prisma.client.update({
      where: { id: params.id },
      data: {
        name,
        industry:     (body.industry     ?? '').trim() || null,
        contactName:  (body.contactName  ?? '').trim() || null,
        contactEmail: (body.contactEmail ?? '').trim() || null,
        userCount:    body.userCount ? Number(body.userCount) : null,
        notes:        (body.notes        ?? '').trim() || null,
        nextQbrDate:  body.nextQbrDate ? new Date(body.nextQbrDate) : null,
      },
    })

    return NextResponse.json(updated)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.deleteClient(membership.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const client = await prisma.client.findFirst({
      where: { id: params.id, workspaceId: membership.workspaceId, deletedAt: null },
    })
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    // Soft delete (archive) — preserves QBRs and ExportEvent audit history.
    await prisma.client.update({
      where: { id: params.id },
      data:  { deletedAt: new Date() },
    })

    // Archive the client's QBRs too so they leave active lists.
    await prisma.qBR.updateMany({
      where: { clientId: params.id, workspaceId: membership.workspaceId, deletedAt: null },
      data:  { deletedAt: new Date() },
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
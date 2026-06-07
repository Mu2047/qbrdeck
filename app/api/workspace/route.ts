import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'
import { can } from '@/lib/permissions'

export async function GET() {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId: membership.workspaceId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { joinedAt: 'asc' },
    })

    const invites = await prisma.workspaceInvite.findMany({
      where: { workspaceId: membership.workspaceId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      workspace: {
        id:   membership.workspaceId,
        name: membership.workspace.name,
      },
      currentRole: membership.role,
      members: members.map(m => ({
        id:       m.id,
        userId:   m.userId,
        name:     m.user.name,
        email:    m.user.email,
        role:     m.role,
        joinedAt: m.joinedAt,
      })),
      invites: invites.map(i => ({
        id:        i.id,
        email:     i.email,
        role:      i.role,
        status:    i.status,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
      })),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.manageSettings(membership.role))
      return NextResponse.json({ error: 'Only the workspace owner can update settings' }, { status: 403 })

    const { name } = await req.json()
    if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

    const updated = await prisma.workspace.update({
      where: { id: membership.workspaceId },
      data:  { name: name.trim() },
    })

    return NextResponse.json({ name: updated.name })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
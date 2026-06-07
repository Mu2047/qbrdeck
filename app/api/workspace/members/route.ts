import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'
import { can } from '@/lib/permissions'
import { TeamRole } from '@prisma/client'

export async function PATCH(req: NextRequest) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.changeRoles(membership.role))
      return NextResponse.json({ error: 'Only the workspace owner can change roles' }, { status: 403 })

    const { memberId, role } = await req.json()
    if (!memberId || !role) return NextResponse.json({ error: 'memberId and role required' }, { status: 400 })

    // Cannot change your own role
    const target = await prisma.workspaceMember.findUnique({ where: { id: memberId } })
    if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    if (target.userId === membership.userId)
      return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 })
    if (target.workspaceId !== membership.workspaceId)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const updated = await prisma.workspaceMember.update({
      where: { id: memberId },
      data:  { role: role as TeamRole },
    })

    return NextResponse.json({ role: updated.role })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.removeMembers(membership.role))
      return NextResponse.json({ error: 'Only the workspace owner can remove members' }, { status: 403 })

    const { memberId } = await req.json()
    if (!memberId) return NextResponse.json({ error: 'memberId required' }, { status: 400 })

    const target = await prisma.workspaceMember.findUnique({ where: { id: memberId } })
    if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    if (target.userId === membership.userId)
      return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 })
    if (target.workspaceId !== membership.workspaceId)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.workspaceMember.delete({ where: { id: memberId } })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
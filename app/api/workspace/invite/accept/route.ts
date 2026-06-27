import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { token } = await req.json()
    if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

    const invite = await prisma.workspaceInvite.findUnique({ where: { token } })
    if (!invite) return NextResponse.json({ error: 'Invalid invitation' }, { status: 404 })
    if (invite.status !== 'PENDING')
      return NextResponse.json({ error: 'This invitation has already been used or revoked' }, { status: 400 })
    if (new Date() > invite.expiresAt)
      return NextResponse.json({ error: 'This invitation has expired' }, { status: 400 })

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Check email matches invite
    if (user.email.toLowerCase() !== invite.email.toLowerCase())
      return NextResponse.json({
        error: `This invitation was sent to ${invite.email}. Please sign in with that email address.`
      }, { status: 403 })

    // Check not already a member
    const existing = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: user.id } },
    })
    if (existing)
      return NextResponse.json({ error: 'You are already a member of this workspace' }, { status: 400 })

    // Add member + mark invite accepted atomically (prevents double-accept race)
    await prisma.$transaction([
      prisma.workspaceMember.create({
        data: {
          workspaceId: invite.workspaceId,
          userId:      user.id,
          role:        invite.role,
        },
      }),
      prisma.workspaceInvite.update({
        where: { id: invite.id },
        data:  { status: 'ACCEPTED', acceptedAt: new Date(), acceptedByUserId: user.id },
      }),
    ])

    return NextResponse.json({ success: true, workspaceId: invite.workspaceId })
  } catch (err: any) {
    console.error('[accept-invite]', err)
    return NextResponse.json({ error: err.message ?? 'Failed to accept invitation' }, { status: 500 })
  }
}
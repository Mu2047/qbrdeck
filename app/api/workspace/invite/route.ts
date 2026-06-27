import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'
import { can, canInviteMoreMembers, canGrantRole, SEAT_LIMITS } from '@/lib/permissions'
import { TeamRole } from '@prisma/client'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.inviteMembers(membership.role))
      return NextResponse.json({ error: 'You do not have permission to invite members' }, { status: 403 })

    // Check seat limits
    const plan = membership.subscription?.plan ?? 'FREE'
    const memberCount = await prisma.workspaceMember.count({
      where: { workspaceId: membership.workspaceId },
    })

    if (!canInviteMoreMembers(plan, memberCount)) {
      const limit = SEAT_LIMITS[plan] ?? 1
      return NextResponse.json({
        error: 'SEAT_LIMIT_REACHED',
        plan,
        limit,
        message: plan === 'FREE' || plan === 'SOLO'
          ? 'Team access is available on the Growth plan and above.'
          : `Your ${plan} plan supports up to ${limit} team members.`,
      }, { status: 403 })
    }

    const { email, role } = await req.json()
    if (!email || !role) return NextResponse.json({ error: 'Email and role required' }, { status: 400 })

    // Validate role is a real enum value
    const VALID_ROLES: TeamRole[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']
    if (!VALID_ROLES.includes(role as TeamRole))
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

    // P1: enforce that the inviter may grant THIS role (prevents privilege escalation)
    if (!canGrantRole(membership.role, role as TeamRole))
      return NextResponse.json({ error: 'You cannot grant a role equal to or above your own' }, { status: 403 })

    // Check if already a member
    const existingUser = await prisma.user.findUnique({ where: { email } })
    if (existingUser) {
      const existingMember = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: membership.workspaceId, userId: existingUser.id } },
      })
      if (existingMember)
        return NextResponse.json({ error: 'This user is already a team member' }, { status: 400 })
    }

    // Upsert invite (reset if expired/revoked)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

    const invite = await prisma.workspaceInvite.upsert({
      where: { workspaceId_email: { workspaceId: membership.workspaceId, email } },
      update: {
        role: role as TeamRole,
        status: 'PENDING',
        expiresAt,
        invitedById: membership.userId,
      },
      create: {
        workspaceId: membership.workspaceId,
        email,
        role: role as TeamRole,
        invitedById: membership.userId,
        expiresAt,
      },
    })

    const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite/${invite.token}`
    const workspace = await prisma.workspace.findUnique({ where: { id: membership.workspaceId } })
    const inviter   = await prisma.user.findUnique({ where: { id: membership.userId } })

    // Send invite email
    await resend.emails.send({
      from:    'noreply@misecuretechsolutions.com',
      to:      email,
      subject: `You're invited to join ${workspace?.name ?? 'QBR Deck'}`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
          <h2 style="color: #0C101C;">You've been invited to QBR Deck</h2>
          <p style="color: #374151;">
            ${inviter?.name ?? inviter?.email} has invited you to join
            <strong>${workspace?.name}</strong> on QBR Deck as a <strong>${role.toLowerCase()}</strong>.
          </p>
          <a href="${inviteUrl}"
             style="display:inline-block;margin-top:16px;padding:12px 24px;background:#0C101C;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">
            Accept invitation
          </a>
          <p style="color: #9CA3AF; font-size: 12px; margin-top: 24px;">
            This invitation expires in 7 days. If you did not expect this email, you can ignore it.
          </p>
        </div>
      `,
    })

    return NextResponse.json({ success: true, inviteId: invite.id })
  } catch (err: any) {
    console.error('[invite]', err)
    return NextResponse.json({ error: err.message ?? 'Failed to send invite' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.inviteMembers(membership.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { inviteId } = await req.json()
    if (!inviteId) return NextResponse.json({ error: 'inviteId required' }, { status: 400 })

    const invite = await prisma.workspaceInvite.findUnique({ where: { id: inviteId } })
    if (!invite || invite.workspaceId !== membership.workspaceId)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.workspaceInvite.update({
      where: { id: inviteId },
      data:  { status: 'REVOKED' },
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
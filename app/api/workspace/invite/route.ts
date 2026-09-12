import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'
import { lockWorkspaceRow } from '@/lib/workspace-lock'
import { can, canGrantRole } from '@/lib/permissions'
import { getLimits } from '@/lib/limits'
import {
  INVITE_EXPIRY_MS,
  countReservedSeats,
  generateInviteToken,
  hasSeatCapacity,
  hashInviteToken,
  isInviteableRole,
  normalizeInviteEmail,
} from '@/lib/team-invites'
import { TeamRole } from '@prisma/client'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(req: NextRequest) {
  // Declared outside the try so the email-failure path below can compensate
  // the exact invitation this request created, and only that one.
  let createdInviteId: string | null = null

  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.inviteMembers(membership.role))
      return NextResponse.json({ error: 'You do not have permission to invite members' }, { status: 403 })

    const { email, role } = await req.json()
    if (!email || !role) return NextResponse.json({ error: 'Email and role required' }, { status: 400 })

    // Server-side role validation, independent of the Settings UI. OWNER is
    // never inviteable: a manipulated request asking for it is rejected here
    // even though the dropdown never offers it.
    if (!isInviteableRole(role))
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

    // Defence in depth — the inviter still may not grant a role above their own.
    if (!canGrantRole(membership.role, role as TeamRole))
      return NextResponse.json({ error: 'You cannot grant a role equal to or above your own' }, { status: 403 })

    const normalizedEmail = normalizeInviteEmail(String(email))
    if (!normalizedEmail.includes('@'))
      return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 })

    // ── Seat reservation ──────────────────────────────────────────────────────
    // Locked, atomic, and committed BEFORE the invitation email is sent: two
    // concurrent invites against the last Growth seat can no longer both
    // observe the same pre-reservation counts and both succeed. Mirrors the
    // pattern already used for Client capacity in app/api/clients/route.ts and
    // QBR quota in app/api/generate-qbr/route.ts. No network call happens
    // inside this transaction.
    const rawToken = generateInviteToken()
    const tokenHash = hashInviteToken(rawToken)
    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS)

    const result = await prisma.$transaction(async (tx) => {
      await lockWorkspaceRow(tx, membership.workspaceId)

      // Re-read the plan fresh under the lock rather than trusting the
      // pre-transaction membership.subscription value.
      const subscription = await tx.subscription.findUnique({
        where: { workspaceId: membership.workspaceId },
        select: { plan: true },
      })
      const plan = subscription?.plan ?? 'FREE'
      const limit = getLimits(plan).teamSeats

      // Already a member of this workspace? Matched case-insensitively so a
      // differently-cased address cannot slip a second invitation through.
      const existingUser = await tx.user.findFirst({
        where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
        select: { id: true },
      })
      if (existingUser) {
        const existingMember = await tx.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: membership.workspaceId, userId: existingUser.id } },
          select: { id: true },
        })
        if (existingMember) return { kind: 'already_member' } as const
      }

      // Any prior invitation row for this address in this workspace. Matched
      // case-insensitively because legacy rows were stored verbatim, and the
      // [workspaceId, email] unique constraint is case-sensitive — creating a
      // differently-cased row would otherwise duplicate the reservation.
      const existingInvite = await tx.workspaceInvite.findFirst({
        where: {
          workspaceId: membership.workspaceId,
          email: { equals: normalizedEmail, mode: 'insensitive' },
        },
      })

      const now = new Date()
      if (
        existingInvite &&
        existingInvite.status === 'PENDING' &&
        existingInvite.expiresAt > now
      ) {
        // A still-valid pending invitation already holds this seat. Never
        // silently mint a second token for the same address.
        return { kind: 'already_invited' } as const
      }

      const { reserved } = await countReservedSeats(tx, membership.workspaceId, now)
      if (!hasSeatCapacity(plan, reserved)) {
        return { kind: 'seat_limit_reached', plan, limit } as const
      }

      // Reuse an expired/revoked/accepted row for this address rather than
      // inserting alongside it — the [workspaceId, email] unique constraint
      // permits only one row per address per workspace.
      const invite = existingInvite
        ? await tx.workspaceInvite.update({
            where: { id: existingInvite.id },
            data: {
              email:            normalizedEmail,
              role:             role as TeamRole,
              token:            tokenHash,
              status:           'PENDING',
              expiresAt,
              invitedById:      membership.userId,
              acceptedAt:       null,
              acceptedByUserId: null,
              revokedAt:        null,
            },
          })
        : await tx.workspaceInvite.create({
            data: {
              workspaceId: membership.workspaceId,
              email:       normalizedEmail,
              role:        role as TeamRole,
              token:       tokenHash,
              invitedById: membership.userId,
              expiresAt,
            },
          })

      return { kind: 'created', inviteId: invite.id } as const
    })

    if (result.kind === 'already_member')
      return NextResponse.json({ error: 'This user is already a team member' }, { status: 400 })

    if (result.kind === 'already_invited')
      return NextResponse.json({ error: 'This email already has a pending invitation' }, { status: 409 })

    if (result.kind === 'seat_limit_reached') {
      const { plan, limit } = result
      return NextResponse.json({
        error: 'SEAT_LIMIT_REACHED',
        plan,
        limit,
        message: plan === 'FREE' || plan === 'SOLO'
          ? 'Team access is available on the Growth plan and above.'
          : `Your ${plan} plan supports up to ${limit} team members.`,
      }, { status: 403 })
    }

    createdInviteId = result.inviteId

    // ── Invitation email — AFTER the transaction committed ────────────────────
    // The raw token exists only here and in the URL below; the database holds
    // only its SHA-256 hash. Never logged.
    const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/invite/${rawToken}`
    const workspace = await prisma.workspace.findUnique({ where: { id: membership.workspaceId } })
    const inviter   = await prisma.user.findUnique({ where: { id: membership.userId } })

    await resend.emails.send({
      from: 'QBR Deck <noreply@misecuretechsolutions.com>',
      to:      normalizedEmail,
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

    return NextResponse.json({ success: true, inviteId: result.inviteId })
  } catch (err: any) {
    console.error('[invite]', err)

    // The invitation row committed but delivery failed — release the seat it
    // reserved rather than leaving an unusable reservation behind. Scoped to
    // this request's own invitation id AND guarded on status: 'PENDING', so it
    // can never revoke an invitation that another request has since accepted.
    if (createdInviteId) {
      try {
        await prisma.workspaceInvite.updateMany({
          where: { id: createdInviteId, status: 'PENDING' },
          data:  { status: 'REVOKED', revokedAt: new Date() },
        })
      } catch (compErr) {
        console.error('[invite] Failed to release reserved seat after email failure', compErr)
      }
    }

    return NextResponse.json({ error: 'Failed to send invite' }, { status: 500 })
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

    // Revoking releases the seat immediately (countReservedSeats only counts
    // PENDING rows) and makes the token unusable (acceptance requires PENDING).
    await prisma.workspaceInvite.update({
      where: { id: inviteId },
      data:  { status: 'REVOKED', revokedAt: new Date() },
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[invite:revoke]', err)
    return NextResponse.json({ error: 'Failed to revoke invitation' }, { status: 500 })
  }
}

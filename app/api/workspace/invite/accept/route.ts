import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { lockWorkspaceRow } from '@/lib/workspace-lock'
import { countReservedSeats, fitsWithinSeatLimit, hashInviteToken } from '@/lib/team-invites'

// Thrown only for the one legitimate concurrency race this endpoint must
// detect: the conditional PENDING -> ACCEPTED claim lost to a simultaneous
// acceptance of the same token. Never used to mask an unexpected error.
class InviteClaimLostError extends Error {}

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { token } = await req.json()
    if (!token || typeof token !== 'string')
      return NextResponse.json({ error: 'Token required' }, { status: 400 })

    // Hashed lookup first — every invitation created since the token-hardening
    // change stores only SHA-256(rawToken). The raw token is never logged.
    let invite = await prisma.workspaceInvite.findUnique({
      where: { token: hashInviteToken(token) },
    })

    // Legacy fallback: invitations created before that change stored a raw
    // cuid() in the same column, so an outstanding one must keep working.
    // Mirrors resolveSharedQbr()'s legacy branch in lib/share-links.ts. This
    // can only ever match a row whose stored value is not a hash, so it does
    // not weaken the hashed path above.
    if (!invite) {
      invite = await prisma.workspaceInvite.findUnique({ where: { token } })
    }

    if (!invite) return NextResponse.json({ error: 'Invalid invitation' }, { status: 404 })
    if (invite.status !== 'PENDING')
      return NextResponse.json({ error: 'This invitation has already been used or revoked' }, { status: 400 })
    if (new Date() > invite.expiresAt)
      return NextResponse.json({ error: 'This invitation has expired' }, { status: 400 })

    const user = await prisma.user.findUnique({ where: { clerkId } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Recipient binding — the signed-in account's own email must match the
    // invited address. Prevents someone who obtains an invite URL from joining
    // with a different account. Unchanged behavior, preserved deliberately.
    if (user.email.toLowerCase() !== invite.email.toLowerCase())
      return NextResponse.json({
        error: `This invitation was sent to ${invite.email}. Please sign in with that email address.`
      }, { status: 403 })

    // ── Locked acceptance ─────────────────────────────────────────────────────
    // The capacity decision made when the invite was SENT is not trusted: the
    // plan and the member list may both have changed since. Everything below
    // is re-read under the Workspace row lock, and no network call happens
    // inside the transaction.
    const result = await prisma.$transaction(async (tx) => {
      await lockWorkspaceRow(tx, invite!.workspaceId)

      const fresh = await tx.workspaceInvite.findUnique({ where: { id: invite!.id } })
      if (!fresh || fresh.status !== 'PENDING') return { kind: 'already_used' } as const
      if (new Date() > fresh.expiresAt) return { kind: 'expired' } as const

      const existing = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: fresh.workspaceId, userId: user.id } },
        select: { id: true },
      })
      if (existing) return { kind: 'already_member' } as const

      const subscription = await tx.subscription.findUnique({
        where: { workspaceId: fresh.workspaceId },
        select: { plan: true },
      })
      const plan = subscription?.plan ?? 'FREE'

      // This invitation already holds one reserved seat, so pending -> active
      // is a net-zero capacity change. What must still hold is that the
      // workspace is not ALREADY above its current entitlement — e.g. a Growth
      // workspace at 5/5 that has since downgraded to Solo.
      const { reserved } = await countReservedSeats(tx, fresh.workspaceId)
      if (!fitsWithinSeatLimit(plan, reserved)) {
        return { kind: 'over_seat_limit', plan } as const
      }

      // Conditional claim — only one concurrent acceptance of the same token
      // can flip PENDING -> ACCEPTED. The loser's whole transaction rolls back,
      // so no orphan membership can survive.
      const claimed = await tx.workspaceInvite.updateMany({
        where: { id: fresh.id, status: 'PENDING' },
        data:  { status: 'ACCEPTED', acceptedAt: new Date(), acceptedByUserId: user.id },
      })
      if (claimed.count !== 1) throw new InviteClaimLostError()

      // Role comes from the stored invitation, never from the request body —
      // the recipient cannot escalate their own role at acceptance time.
      await tx.workspaceMember.create({
        data: {
          workspaceId: fresh.workspaceId,
          userId:      user.id,
          role:        fresh.role,
        },
      })

      return { kind: 'accepted', workspaceId: fresh.workspaceId } as const
    })

    if (result.kind === 'already_used')
      return NextResponse.json({ error: 'This invitation has already been used or revoked' }, { status: 400 })
    if (result.kind === 'expired')
      return NextResponse.json({ error: 'This invitation has expired' }, { status: 400 })
    if (result.kind === 'already_member')
      return NextResponse.json({ error: 'You are already a member of this workspace' }, { status: 400 })
    if (result.kind === 'over_seat_limit')
      return NextResponse.json({
        error: 'This workspace has no available seats. Please ask the workspace owner to free a seat or upgrade the plan.',
      }, { status: 403 })

    return NextResponse.json({ success: true, workspaceId: result.workspaceId })
  } catch (err: any) {
    if (err instanceof InviteClaimLostError) {
      return NextResponse.json({ error: 'This invitation has already been used or revoked' }, { status: 400 })
    }
    console.error('[accept-invite]', err)
    return NextResponse.json({ error: 'Failed to accept invitation' }, { status: 500 })
  }
}

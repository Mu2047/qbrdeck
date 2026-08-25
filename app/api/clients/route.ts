import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'
import { lockWorkspaceRow } from '@/lib/workspace-lock'
import { can } from '@/lib/permissions'
import { getLimits, isUnderLimit } from '@/lib/limits'
import { z } from 'zod'

const createSchema = z.object({
  name: z.string().min(1),
  industry: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal('')),
  userCount: z.number().optional(),
  notes: z.string().optional(),
})

export async function GET() {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.viewClients(membership.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const clients = await prisma.client.findMany({
      where: { workspaceId: membership.workspaceId, deletedAt: null },
      include: { qbrs: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(clients)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId: clerkId } = auth()
    if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const membership = await getWorkspaceMembership(clerkId)
    if (!membership) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

    if (!can.createClient(membership.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const data = createSchema.parse(body)

    // ── Concurrency-safe capacity check + create ────────────────────────────
    // Locks the Workspace row so concurrent normal-creation requests for the
    // same workspace serialize at this point — the count and the create
    // happen atomically together, inside the lock, on the transaction client
    // (tx), never the outer prisma client. See lib/workspace-lock.ts.
    const result = await prisma.$transaction(async (tx) => {
      await lockWorkspaceRow(tx, membership.workspaceId)

      // Re-read the plan fresh under the lock rather than trusting the
      // pre-transaction membership.subscription value — a workspace may not
      // yet have a Subscription row at all, hence the FREE fallback below.
      const subscription = await tx.subscription.findUnique({
        where:  { workspaceId: membership.workspaceId },
        select: { plan: true },
      })
      const limits = getLimits(subscription?.plan ?? 'FREE')

      // Soft-deleted Clients do not consume active Client capacity.
      const clientCount = await tx.client.count({
        where: { workspaceId: membership.workspaceId, deletedAt: null },
      })

      if (!isUnderLimit(clientCount, limits.clients)) {
        return { kind: 'limit_reached' } as const
      }

      const client = await tx.client.create({
        data: {
          ...data,
          workspaceId: membership.workspaceId,
          createdById: membership.userId,
        },
      })

      return { kind: 'created', client } as const
    })

    if (result.kind === 'limit_reached') {
      return NextResponse.json({ error: 'CLIENT_LIMIT_REACHED' }, { status: 403 })
    }

    return NextResponse.json(result.client, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
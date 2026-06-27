import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getWorkspaceMembership } from '@/lib/workspace'
import { can } from '@/lib/permissions'
import { getReminderStatus } from '@/lib/reminder-utils'

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
      orderBy: { nextQbrDate: 'asc' },
    })
    const overdue:      any[] = []
    const dueThisWeek:  any[] = []
    const dueThisMonth: any[] = []

    for (const client of clients) {
      const status = getReminderStatus(client.nextQbrDate)
      if (status === 'none') continue

      const lastQbr = client.qbrs[0] ?? null
      const entry = {
        id:          client.id,
        name:        client.name,
        nextQbrDate: client.nextQbrDate,
        status,
        lastQbr:     lastQbr ? { quarter: lastQbr.quarter, year: lastQbr.year } : null,
      }

      if (status === 'overdue')         overdue.push(entry)
      else if (status === 'due-this-week')  dueThisWeek.push(entry)
      else if (status === 'due-this-month') dueThisMonth.push(entry)
    }

    return NextResponse.json({ overdue, dueThisWeek, dueThisMonth })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
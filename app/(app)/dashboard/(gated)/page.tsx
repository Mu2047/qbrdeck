import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { Users, FileText, TrendingUp, Plus, ArrowRight, AlertCircle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { getReminderStatus } from '@/lib/reminder-utils'
import { formatQbrDate, formatQbrQuarter } from '@/lib/qbr-display'
import { getWorkspaceContext } from '@/lib/workspace'
import { can } from '@/lib/permissions'
import { PageHeader } from '@/components/ui/PageHeader'
import { MetricCard } from '@/components/ui/MetricCard'
import { SectionCard } from '@/components/ui/SectionCard'

// Display labels only — the stored/compared plan value is never changed.
// Unknown values fall back to the raw plan string.
const PLAN_DISPLAY_NAME: Record<string, string> = {
  FREE: 'Free', SOLO: 'Solo', GROWTH: 'Growth', AGENCY: 'Agency',
}

async function getReminders(workspaceId: string) {
  const clients = await prisma.client.findMany({
    where: { workspaceId },
    include: { qbrs: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 } },
  })

  const overdue:      any[] = []
  const dueThisWeek:  any[] = []
  const dueThisMonth: any[] = []

  for (const client of clients) {
    const status = getReminderStatus(client.nextQbrDate)
    if (status === 'none' || status === 'upcoming') continue
    const entry = {
      id: client.id, name: client.name,
      nextQbrDate: client.nextQbrDate, status,
      lastQbr: client.qbrs[0] ?? null,
    }
    if (status === 'overdue')             overdue.push(entry)
    else if (status === 'due-this-week')  dueThisWeek.push(entry)
    else if (status === 'due-this-month') dueThisMonth.push(entry)
  }

  const byDate = (a: any, b: any) => new Date(a.nextQbrDate).getTime() - new Date(b.nextQbrDate).getTime()
  return {
    overdue:      overdue.sort(byDate),
    dueThisWeek:  dueThisWeek.sort(byDate),
    dueThisMonth: dueThisMonth.sort(byDate),
  }
}

export default async function DashboardPage() {
  const { userId: clerkId } = auth()
  if (!clerkId) redirect('/sign-in')

  const ctx = await getWorkspaceContext()
  if (!ctx) redirect('/sign-in')

  const { workspaceId } = ctx
  const plan = ctx.subscription?.plan ?? 'FREE'

  // Same checks the clients and generate-qbr routes enforce, on the role in
  // the ACTIVE workspace: Admin+ manage clients, Member+ generate QBRs.
  const canCreateClient = can.createClient(ctx.member.role)
  const canGenerateQBR  = can.generateQBR(ctx.member.role)

  const [clients, totalQBRsResult, clientCount] = await Promise.all([
    prisma.client.findMany({
      where: { workspaceId },
      include: { qbrs: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    }),
    prisma.qBR.count({ where: { client: { workspaceId }, deletedAt: null } }),
    prisma.client.count({ where: { workspaceId } }),
  ])

  const { overdue, dueThisWeek, dueThisMonth } = await getReminders(workspaceId)
  const hasReminders = overdue.length > 0 || dueThisWeek.length > 0 || dueThisMonth.length > 0
  // Display-only count of the arrays above. They are mutually exclusive —
  // getReminders() places each client in at most one of them — so the sum
  // never double-counts a client.
  const needsAttentionCount = overdue.length + dueThisWeek.length + dueThisMonth.length

  // Display mapping only — labels are unchanged; classification itself comes
  // from getReminderStatus() via getReminders() above.
  const urgencyConfig = {
    overdue:          { label: 'Overdue',        badge: 'qd-status-red'    },
    'due-this-week':  { label: 'Due This Week',  badge: 'qd-status-orange' },
    'due-this-month': { label: 'Due This Month', badge: 'qd-status-amber'  },
  } as const

  // Column template shared by the schedule header and every row (lg+). Below
  // lg the row stacks: client + last QBR, then due / status / action.
  const scheduleCols    = 'lg:grid lg:grid-cols-[minmax(0,1fr)_4.5rem_7.5rem_5.5rem] lg:gap-3 lg:items-center'
  const scheduleSubCols = 'lg:grid lg:grid-cols-[minmax(0,1fr)_5.5rem] lg:gap-3 lg:items-center'

  function ReminderRow({ client, urgency }: { client: any; urgency: any }) {
    return (
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3 hover:bg-gray-50 transition-colors ${scheduleCols}`}>
        <Link href={`/dashboard/clients/${client.id}`} className={`block w-full min-w-0 ${scheduleSubCols}`}>
          <p className="text-sm font-medium text-navy-800 truncate">{client.name}</p>
          <p className="text-xs text-gray-500 lg:text-sm lg:text-gray-600">
            {client.lastQbr ? <><span className="lg:hidden">Last QBR: </span>{formatQbrQuarter(client.lastQbr.quarter, client.lastQbr.year)}</> : 'No QBRs yet'}
          </p>
        </Link>
        <span className="text-xs text-gray-600 tabular-nums lg:text-sm">
          <span className="lg:hidden">Due </span>{formatQbrDate(client.nextQbrDate, 'short')}
        </span>
        <span>
          <span className={`qd-status-badge ${urgency.badge}`}>
            <span className="qd-status-dot" aria-hidden="true" />
            {urgency.label}
          </span>
        </span>
        <div className="flex items-center ml-auto lg:ml-0 lg:justify-end">
          {canGenerateQBR && (
          <Link
            href={`/dashboard/clients/${client.id}/qbr/new?quarter=${client.lastQbr ? (Number(client.lastQbr.quarter) === 4 ? 1 : Number(client.lastQbr.quarter) + 1) : new Date().getMonth() < 3 ? 1 : new Date().getMonth() < 6 ? 2 : new Date().getMonth() < 9 ? 3 : 4}&year=${client.lastQbr && Number(client.lastQbr.quarter) === 4 ? client.lastQbr.year + 1 : client.lastQbr?.year ?? new Date().getFullYear()}`}
            className="qd-btn-row"
          >
            Start QBR
          </Link>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <PageHeader
        title="Dashboard"
        description={clientCount === 0 ? 'Add your first client to get started.' : `You have ${clientCount} client${clientCount !== 1 ? 's' : ''} managed.`}
      />

      <div className="grid grid-cols-1 gap-5 mb-5 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Total clients"   value={clientCount}     helper="In this workspace"         icon={Users} />
        <MetricCard label="QBRs generated"  value={totalQBRsResult} helper="All time"                  icon={FileText} />
        <MetricCard
          label="Needs attention"
          value={needsAttentionCount}
          helper="Overdue or due this week/month"
          icon={AlertCircle}
          accent={needsAttentionCount > 0 ? 'warning' : 'neutral'}
        />
        <MetricCard label="Current plan"    value={PLAN_DISPLAY_NAME[plan] ?? plan} helper="Workspace subscription" icon={TrendingUp} accent="gold" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 items-start">
      {hasReminders && (
        <SectionCard
          className="xl:col-span-2"
          title="QBR Schedule"
          description={<>{overdue.length + dueThisWeek.length + dueThisMonth.length} client{overdue.length + dueThisWeek.length + dueThisMonth.length !== 1 ? 's' : ''} need attention</>}
        >
          <div className={`hidden px-5 py-2 bg-gray-50 border-b border-gray-100 text-[11px] font-medium uppercase tracking-wide text-gray-500 ${scheduleCols}`} aria-hidden="true">
            <div className={scheduleSubCols}>
              <span>Client</span>
              <span>Last QBR</span>
            </div>
            <span>Due</span>
            <span>Status</span>
            <span className="text-right">Action</span>
          </div>
          <div className="divide-y divide-gray-100">
            {overdue.map((c)      => <ReminderRow key={c.id} client={c} urgency={urgencyConfig['overdue']}        />)}
            {dueThisWeek.map((c)  => <ReminderRow key={c.id} client={c} urgency={urgencyConfig['due-this-week']}  />)}
            {dueThisMonth.map((c) => <ReminderRow key={c.id} client={c} urgency={urgencyConfig['due-this-month']} />)}
          </div>
        </SectionCard>
      )}

      <SectionCard
        className={hasReminders ? '' : 'xl:col-span-3'}
        title="Recent clients"
        description="Most recently updated"
        action={canCreateClient && (
            <Link href="/dashboard/clients/new" className="btn-primary text-xs py-1.5 px-3">
              <Plus size={12} aria-hidden="true" /> Add client
            </Link>
          )}
      >
        {clients.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-50 ring-1 ring-inset ring-gray-200">
              <Users size={18} className="text-gray-400" aria-hidden="true" />
            </div>
            <p className="text-gray-500 text-sm mb-4">No clients yet. Add your first client to generate your first QBR.</p>
            {canCreateClient && (
              <Link href="/dashboard/clients/new" className="btn-primary"><Plus size={14} aria-hidden="true" /> Add first client</Link>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {clients.map((client) => (
              <Link key={client.id} href={`/dashboard/clients/${client.id}`} className="group flex items-center justify-between gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div aria-hidden="true" className="w-8 h-8 shrink-0 rounded-md bg-navy-50 ring-1 ring-inset ring-navy-100 flex items-center justify-center text-navy-700 text-xs font-semibold">
                    {client.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-navy-800 truncate">{client.name}</p>
                    <p className="text-xs text-gray-500">
                      {client.qbrs && client.qbrs.length > 0 ? `Last QBR ${formatDistanceToNow(client.qbrs[0].createdAt)} ago` : 'No QBRs yet'}
                    </p>
                  </div>
                </div>
                <ArrowRight size={14} aria-hidden="true" className="shrink-0 text-gray-400 transition-colors group-hover:text-navy-600" />
              </Link>
            ))}
          </div>
        )}
        {clients.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-100">
            <Link href="/dashboard/clients" className="text-xs text-navy-600 hover:text-navy-800 font-medium flex items-center gap-1">
              View all clients <ArrowRight size={12} aria-hidden="true" />
            </Link>
          </div>
        )}
      </SectionCard>
      </div>
    </div>
  )
}
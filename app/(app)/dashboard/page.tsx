import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { Users, FileText, TrendingUp, Plus, ArrowRight, AlertCircle, Clock, Calendar } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { getReminderStatus } from '@/lib/reminder-utils'
import { formatQbrDate, formatQbrQuarter } from '@/lib/qbr-display'
import { getWorkspaceContext } from '@/lib/workspace'

async function getReminders(workspaceId: string) {
  const clients = await prisma.client.findMany({
    where: { workspaceId },
    include: { qbrs: { orderBy: { createdAt: 'desc' }, take: 1 } },
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

  const [clients, totalQBRsResult, clientCount] = await Promise.all([
    prisma.client.findMany({
      where: { workspaceId },
      include: { qbrs: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    }),
    prisma.qBR.count({ where: { client: { workspaceId } } }),
    prisma.client.count({ where: { workspaceId } }),
  ])

  const { overdue, dueThisWeek, dueThisMonth } = await getReminders(workspaceId)
  const hasReminders = overdue.length > 0 || dueThisWeek.length > 0 || dueThisMonth.length > 0

  const urgencyConfig = {
    overdue:          { label: 'Overdue',        color: 'text-red-600',    bg: 'bg-red-50',    icon: AlertCircle },
    'due-this-week':  { label: 'Due This Week',  color: 'text-orange-500', bg: 'bg-orange-50', icon: Clock      },
    'due-this-month': { label: 'Due This Month', color: 'text-yellow-600', bg: 'bg-yellow-50', icon: Calendar   },
  } as const

  function ReminderRow({ client, urgency }: { client: any; urgency: any }) {
    return (
      <div className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
        <Link href={`/dashboard/clients/${client.id}`} className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`w-8 h-8 rounded-lg ${urgency.bg} flex items-center justify-center flex-shrink-0`}>
            <urgency.icon size={14} className={urgency.color} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-navy-800 truncate">{client.name}</p>
            <p className="text-xs text-gray-400">
              {client.lastQbr ? `Last QBR: ${formatQbrQuarter(client.lastQbr.quarter, client.lastQbr.year)}` : 'No QBRs yet'}
            </p>
          </div>
        </Link>
        <div className="flex items-center gap-3 flex-shrink-0 ml-4">
          <span className={`text-xs font-medium ${urgency.color}`}>
            {urgency.label} · {formatQbrDate(client.nextQbrDate, 'short')}
          </span>
          <Link
            href={`/dashboard/clients/${client.id}/qbr/new?quarter=${client.lastQbr ? (Number(client.lastQbr.quarter) === 4 ? 1 : Number(client.lastQbr.quarter) + 1) : new Date().getMonth() < 3 ? 1 : new Date().getMonth() < 6 ? 2 : new Date().getMonth() < 9 ? 3 : 4}&year=${client.lastQbr && Number(client.lastQbr.quarter) === 4 ? client.lastQbr.year + 1 : client.lastQbr?.year ?? new Date().getFullYear()}`}
            className="text-xs btn-primary py-1 px-2.5"
          >
            Start QBR
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-navy-800">
          Welcome back
        </h1>
        <p className="text-gray-500 text-sm mt-1">
          {clientCount === 0 ? 'Add your first client to get started.' : `You have ${clientCount} client${clientCount !== 1 ? 's' : ''} managed.`}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-5 mb-8">
        {[
          { label: 'Total clients',  value: clientCount,     icon: Users,      color: 'bg-blue-50 text-blue-600'    },
          { label: 'QBRs generated', value: totalQBRsResult, icon: FileText,   color: 'bg-purple-50 text-purple-600' },
          { label: 'Current plan',   value: plan,            icon: TrendingUp, color: 'bg-amber-50 text-amber-600'  },
        ].map((s) => (
          <div key={s.label} className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-gray-500 font-medium">{s.label}</span>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${s.color}`}>
                <s.icon size={16} />
              </div>
            </div>
            <div className="text-2xl font-bold text-navy-800">{s.value}</div>
          </div>
        ))}
      </div>

      {hasReminders && (
        <div className="card mb-8">
          <div className="flex items-center gap-2 p-5 border-b border-gray-100">
            <Calendar size={15} className="text-gray-400" />
            <h2 className="font-semibold text-navy-800 text-sm">QBR Reminders</h2>
            <span className="ml-auto text-xs text-gray-400">
              {overdue.length + dueThisWeek.length + dueThisMonth.length} client{overdue.length + dueThisWeek.length + dueThisMonth.length !== 1 ? 's' : ''} need attention
            </span>
          </div>
          <div className="divide-y divide-gray-50">
            {overdue.map((c)      => <ReminderRow key={c.id} client={c} urgency={urgencyConfig['overdue']}        />)}
            {dueThisWeek.map((c)  => <ReminderRow key={c.id} client={c} urgency={urgencyConfig['due-this-week']}  />)}
            {dueThisMonth.map((c) => <ReminderRow key={c.id} client={c} urgency={urgencyConfig['due-this-month']} />)}
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="font-semibold text-navy-800 text-sm">Recent clients</h2>
          <Link href="/dashboard/clients/new" className="btn-primary text-xs py-1.5 px-3">
            <Plus size={12} /> Add client
          </Link>
        </div>
        {clients.length === 0 ? (
          <div className="p-12 text-center">
            <Users size={32} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 text-sm mb-4">No clients yet. Add your first client to generate your first QBR.</p>
            <Link href="/dashboard/clients/new" className="btn-primary"><Plus size={14} /> Add first client</Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {clients.map((client) => (
              <Link key={client.id} href={`/dashboard/clients/${client.id}`} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-navy-100 flex items-center justify-center text-navy-700 text-sm font-bold">
                    {client.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-navy-800">{client.name}</p>
                    <p className="text-xs text-gray-400">
                      {client.qbrs && client.qbrs.length > 0 ? `Last QBR ${formatDistanceToNow(client.qbrs[0].createdAt)} ago` : 'No QBRs yet'}
                    </p>
                  </div>
                </div>
                <ArrowRight size={14} className="text-gray-300" />
              </Link>
            ))}
          </div>
        )}
        {clients.length > 0 && (
          <div className="p-4 border-t border-gray-100">
            <Link href="/dashboard/clients" className="text-xs text-navy-600 hover:text-navy-800 font-medium flex items-center gap-1">
              View all clients <ArrowRight size={12} />
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
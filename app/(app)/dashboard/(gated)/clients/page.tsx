import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { Plus, ArrowRight, Users } from 'lucide-react'
import { format } from 'date-fns'
import { getWorkspaceContext } from '@/lib/workspace'

export default async function ClientsPage() {
  const { userId: clerkId } = auth()
  if (!clerkId) redirect('/sign-in')

  const ctx = await getWorkspaceContext()
  if (!ctx) redirect('/sign-in')

  const clients = await prisma.client.findMany({
    where: { workspaceId: ctx.workspaceId },
    include: {
      qbrs: { orderBy: { createdAt: 'desc' }, take: 1 },
      _count: { select: { qbrs: true } },
    },
    orderBy: { name: 'asc' },
  })

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-navy-800">Clients</h1>
          <p className="text-gray-500 text-sm mt-1">{clients.length} client{clients.length !== 1 ? 's' : ''} total</p>
        </div>
        <Link href="/dashboard/clients/new" className="btn-primary">
          <Plus size={15} /> Add client
        </Link>
      </div>

      {clients.length === 0 ? (
        <div className="card p-16 text-center">
          <Users size={40} className="mx-auto text-gray-200 mb-4" />
          <h2 className="font-semibold text-navy-800 mb-2">No clients yet</h2>
          <p className="text-gray-400 text-sm mb-6 max-w-sm mx-auto">Add your first client to start generating professional QBR decks.</p>
          <Link href="/dashboard/clients/new" className="btn-primary"><Plus size={14} /> Add first client</Link>
        </div>
      ) : (
        <div className="card divide-y divide-gray-50">
          {clients.map((client) => (
            <Link key={client.id} href={`/dashboard/clients/${client.id}`} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-navy-800 text-gold-300 font-bold flex items-center justify-center">
                  {client.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium text-navy-800 text-sm">{client.name}</p>
                  <div className="flex gap-3 mt-0.5 text-xs text-gray-400">
                    {client.industry && <span>{client.industry}</span>}
                    {client.userCount && <span>{client.userCount} users</span>}
                    <span>{client._count.qbrs} QBR{client._count.qbrs !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                {client.qbrs[0] && (
                  <span className="text-xs text-gray-400">Last QBR: {format(client.qbrs[0].createdAt, 'MMM yyyy')}</span>
                )}
                <ArrowRight size={14} className="text-gray-300" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

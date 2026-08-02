'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, ArrowLeft, FileText, Download, Pencil, Check, X, Calendar } from 'lucide-react'
import { format } from 'date-fns'
import { formatQbrDate, formatQbrQuarter } from '@/lib/qbr-display'
import { getReminderStatus, formatReminderStatus } from '@/lib/reminder-utils'

export default function ClientPage({ params }: { params: { id: string } }) {
  const [client, setClient]   = useState<any>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [form, setForm]       = useState({
    name: '', industry: '', contactName: '', contactEmail: '', userCount: '', notes: '', nextQbrDate: ''
  })

  useEffect(() => {
    fetch(`/api/clients/${params.id}`)
      .then(r => r.json())
      .then(data => {
        setClient(data)
        setForm({
          name:         data.name         ?? '',
          industry:     data.industry     ?? '',
          contactName:  data.contactName  ?? '',
          contactEmail: data.contactEmail ?? '',
          userCount:    data.userCount    ? String(data.userCount) : '',
          notes:        data.notes        ?? '',
          nextQbrDate:  data.nextQbrDate  ? data.nextQbrDate.slice(0, 10) : '',
        })
      })
  }, [params.id])

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function saveEdit() {
    const name = form.name.trim().replace(/\s+/g, ' ')
    if (!name) { setError('Client name is required'); return }
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/clients/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setClient(data)
      setEditing(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function cancelEdit() {
    setForm({
      name:         client.name         ?? '',
      industry:     client.industry     ?? '',
      contactName:  client.contactName  ?? '',
      contactEmail: client.contactEmail ?? '',
      userCount:    client.userCount    ? String(client.userCount) : '',
      notes:        client.notes        ?? '',
      nextQbrDate:  client.nextQbrDate  ? client.nextQbrDate.slice(0, 10) : '',
    })
    setError('')
    setEditing(false)
  }

  if (!client) return <div className="p-8 text-gray-400 text-sm">Loading...</div>

  const statusBadge = (s: string) =>
    s === 'GENERATED' ? 'badge-green' :
    s === 'EXPORTED'  ? 'badge-gray'  : 'badge-amber'

  // Computed once here (not inside JSX) so the reminder status is derived
  // from the same shared getReminderStatus() logic used by the dashboard and
  // /api/reminders, instead of a separately-thresholded inline calculation.
  // NOTE: this page runs client-side, so "today" is the browser's local
  // clock, while the dashboard/API compute "today" on the server. The two
  // can disagree by a calendar day near local midnight — that residual
  // client/server timezone difference is not addressed by this change.
  const reminderStatus = getReminderStatus(client.nextQbrDate ? new Date(client.nextQbrDate) : null)
  const reminderDisplay = formatReminderStatus(reminderStatus)

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-8">
        <Link href="/dashboard/clients" className="btn-secondary text-sm py-1.5 px-3">
          <ArrowLeft size={14} /> Clients
        </Link>
      </div>

      {/* Client header */}
      <div className="card p-6 mb-6">
        {!editing ? (
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-navy-800 text-gold-300 text-lg font-bold flex items-center justify-center">
                {client.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="text-xl font-bold text-navy-800">{client.name}</h1>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                  {client.industry    && <span>{client.industry}</span>}
                  {client.userCount   && <span>{client.userCount} users</span>}
                  {client.contactName && <span>Contact: {client.contactName}</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEditing(true)}
                className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5"
              >
                <Pencil size={13} /> Edit
              </button>
              <Link href={`/dashboard/clients/${client.id}/qbr/new`} className="btn-primary text-sm">
                <Plus size={14} /> New QBR
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base font-semibold text-navy-800">Edit client</h2>
              <div className="flex gap-2">
                <button onClick={cancelEdit} className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1">
                  <X size={13} /> Cancel
                </button>
                <button onClick={saveEdit} disabled={saving} className="btn-primary text-sm py-1.5 px-3 flex items-center gap-1">
                  <Check size={13} /> {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
            <div>
              <label className="label">Company name <span className="text-red-400">*</span></label>
              <input className="input" value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Industry</label>
                <input className="input" value={form.industry} onChange={e => set('industry', e.target.value)} />
              </div>
              <div>
                <label className="label">User count</label>
                <input className="input" type="number" value={form.userCount} onChange={e => set('userCount', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Contact name</label>
                <input className="input" value={form.contactName} onChange={e => set('contactName', e.target.value)} />
              </div>
              <div>
                <label className="label">Contact email</label>
                <input className="input" type="email" value={form.contactEmail} onChange={e => set('contactEmail', e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label">Internal notes</label>
              <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
          </div>
        )}
        {!editing && client.notes && (
          <p className="mt-4 pt-4 border-t border-gray-100 text-sm text-gray-500">{client.notes}</p>
        )}
      </div>

      {/* Regenerate notice */}
      {!editing && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 mb-6 flex items-center justify-between">
          <p className="text-sm text-blue-800">
            If you updated the client name, re-export any existing QBRs to apply the new name to PDF and PowerPoint.
          </p>
        </div>
      )}

      {/* QBR Schedule */}
      {!editing && (
        <div className="card p-5 mb-6">
          <h2 className="text-sm font-semibold text-navy-800 mb-4 flex items-center gap-2">
            <Calendar size={15} className="text-gray-400" /> QBR Schedule
          </h2>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <p className="text-xs text-gray-400 mb-1">Last QBR</p>
              <p className="text-sm font-medium text-navy-800">
                {client.qbrs?.length > 0 ? formatQbrQuarter(client.qbrs[0].quarter, client.qbrs[0].year) : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Next QBR due</p>
              <p className="text-sm font-medium text-navy-800">
                {client.nextQbrDate ? formatQbrDate(client.nextQbrDate, 'long') : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Status</p>
              <p className={`text-sm font-medium ${reminderDisplay.color}`}>
                {reminderDisplay.label}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={form.nextQbrDate}
              onChange={e => set('nextQbrDate', e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-navy-800 focus:outline-none focus:ring-2 focus:ring-navy-200"
            />
            <button
              onClick={async () => {
                setSaving(true)
                const res = await fetch(`/api/clients/${params.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    name: client.name,
                    nextQbrDate: form.nextQbrDate ? new Date(form.nextQbrDate).toISOString() : null,
                  }),
                })
                const data = await res.json()
                setClient(data)
                setSaving(false)
              }}
              disabled={saving}
              className="btn-primary text-xs py-1.5 px-3"
            >
              {saving ? 'Saving...' : 'Save date'}
            </button>
          </div>
        </div>
      )}

      {/* QBR history */}
      <div className="card">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-navy-800 text-sm">QBR History</h2>
        </div>
        {client.qbrs?.length === 0 ? (
          <div className="p-12 text-center">
            <FileText size={32} className="mx-auto text-gray-200 mb-3" />
            <p className="text-gray-500 text-sm mb-4">No QBRs generated yet for this client.</p>
            <Link href={`/dashboard/clients/${client.id}/qbr/new`} className="btn-primary text-sm">
              <Plus size={14} /> Generate first QBR
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {client.qbrs?.map((qbr: any) => (
              <Link
                key={qbr.id}
                href={`/dashboard/clients/${client.id}/qbr/${qbr.id}`}
                className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-navy-50 flex items-center justify-center text-navy-600">
                    <FileText size={16} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-navy-800">Q{qbr.quarter} {qbr.year}</p>
                    <p className="text-xs text-gray-400">{format(new Date(qbr.createdAt), 'MMM d, yyyy')}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={statusBadge(qbr.status)}>
                    {qbr.status === 'GENERATED' ? 'Generated' : qbr.status === 'EXPORTED' ? 'Exported' : 'Draft'}
                  </span>
                  <Download size={14} className="text-gray-300" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
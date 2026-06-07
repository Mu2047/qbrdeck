'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function NewClientPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', industry: '', contactName: '', contactEmail: '', userCount: '', notes: '' })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function submit() {
    if (!form.name.trim()) { setError('Client name is required'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, userCount: form.userCount ? Number(form.userCount) : undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      router.push(`/dashboard/clients/${data.id}`)
    } catch (e: any) {
      setError(e.message)
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-xl">
      <div className="flex items-center gap-3 mb-8">
        <Link href="/dashboard/clients" className="btn-secondary text-sm py-1.5 px-3">
          <ArrowLeft size={14} /> Clients
        </Link>
        <h1 className="text-xl font-bold text-navy-800">Add new client</h1>
      </div>

      <div className="card p-6 space-y-4">
        <div>
          <label className="label">Company name <span className="text-red-400">*</span></label>
          <input className="input" placeholder="Acme Corp" value={form.name} onChange={e => set('name', e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Industry</label>
            <input className="input" placeholder="Healthcare, Legal, Finance..." value={form.industry} onChange={e => set('industry', e.target.value)} />
          </div>
          <div>
            <label className="label">User count</label>
            <input className="input" type="number" placeholder="48" value={form.userCount} onChange={e => set('userCount', e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Primary contact name</label>
            <input className="input" placeholder="John Smith" value={form.contactName} onChange={e => set('contactName', e.target.value)} />
          </div>
          <div>
            <label className="label">Contact email</label>
            <input className="input" type="email" placeholder="john@acme.com" value={form.contactEmail} onChange={e => set('contactEmail', e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Internal notes <span className="text-gray-400 font-normal">(optional)</span></label>
          <textarea className="input" rows={2} placeholder="Any context about this client..." value={form.notes} onChange={e => set('notes', e.target.value)} />
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <button onClick={submit} disabled={loading} className="btn-primary w-full py-3 text-sm">
          {loading ? 'Creating...' : 'Create client'}
        </button>
      </div>
    </div>
  )
}

'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type ExistingClient = { id: string; name: string }

type Props = {
  // Persisted clientStepIdempotencyKey, if the row already has one (e.g. a
  // reload after a lost response). Null on first-ever render of this step.
  persistedKey: string | null
  // Server-provided, workspace-owned, non-deleted candidates only —
  // deterministically ordered (name asc, id asc). See P2 onboarding PR 8
  // preflight, "Server page client list" / "Multi-client selector".
  existingClients: ExistingClient[]
}

export function FirstClientScreen({ persistedKey, existingClients }: Props) {
  const router = useRouter()
  const existingClientCount = existingClients.length
  const soleExistingClientName = existingClientCount === 1 ? existingClients[0].name : null
  // Lazily generated on first submit, never during render — see P2
  // onboarding preflight, Correction 1. Reused for retries within this
  // mounted screen session; a reload re-seeds from the server-persisted key.
  const keyRef = useRef<string | null>(persistedKey)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '', industry: '', contactName: '', contactEmail: '', userCount: '', notes: '',
  })
  // Defaults to the first deterministically-ordered candidate — an explicit
  // choice is still required to submit (the Continue button always states
  // which client it will attach), the default just saves a click for the
  // common case of picking the first listed candidate.
  const [selectedClientId, setSelectedClientId] = useState<string | null>(
    existingClients[0]?.id ?? null
  )
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  function ensureKey() {
    if (!keyRef.current) keyRef.current = crypto.randomUUID()
    return keyRef.current
  }

  async function submitAttach(clientId?: string) {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const retryKey = ensureKey()
      const res = await fetch('/api/onboarding/client', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(clientId ? { mode: 'attach', retryKey, clientId } : { mode: 'attach', retryKey }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to continue')
      }
      router.push('/onboarding/first-qbr')
    } catch (e: any) {
      setError(e.message)
      setLoading(false)
    }
  }

  async function submitCreate() {
    if (loading) return
    if (!form.name.trim()) { setError('Client name is required'); return }
    setLoading(true)
    setError('')
    try {
      const retryKey = ensureKey()
      const res = await fetch('/api/onboarding/client', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          mode: 'create',
          retryKey,
          ...form,
          userCount: form.userCount ? Number(form.userCount) : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === 'CLIENT_LIMIT_REACHED') {
          setError("You've reached your client limit. Upgrade to add more clients.")
          setLoading(false)
          return
        }
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to continue')
      }
      router.push('/onboarding/first-qbr')
    } catch (e: any) {
      setError(e.message)
      setLoading(false)
    }
  }

  // 2+ existing, unanchored clients — explicit selection required. No
  // auto-pick, no forced duplicate creation, and critically no dead-end:
  // now that the dashboard gate is authoritative, "Return to dashboard"
  // would only redirect straight back here. See P2 onboarding PR 8
  // preflight, "First Client — 2+ selector" / "Multi-client reattach risk".
  if (existingClientCount > 1) {
    const selected = existingClients.find(c => c.id === selectedClientId) ?? existingClients[0]
    return (
      <div className="card p-8">
        <p className="text-xs font-medium text-gray-400 mb-3">Step 3 of 8</p>
        <h1 className="text-2xl font-bold text-navy-800 mb-2">Choose a client</h1>
        <p className="text-gray-500 text-sm mb-6">
          We found existing clients in your workspace. Choose which one to use for your first onboarding QBR.
        </p>

        <div className="space-y-2 mb-6">
          {existingClients.map(c => (
            <label
              key={c.id}
              className="flex items-center gap-3 border border-gray-200 rounded-lg px-4 py-3 cursor-pointer hover:bg-gray-50"
            >
              <input
                type="radio"
                name="existingClient"
                value={c.id}
                checked={selectedClientId === c.id}
                onChange={() => setSelectedClientId(c.id)}
                disabled={loading}
              />
              <span className="text-sm text-navy-800">{c.name}</span>
            </label>
          ))}
        </div>

        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

        <button
          onClick={() => selected && submitAttach(selected.id)}
          disabled={loading || !selected}
          className="btn-primary w-full py-3 text-sm"
        >
          {loading ? 'Continuing...' : `Continue with ${selected?.name ?? 'selected client'}`}
        </button>
      </div>
    )
  }

  if (existingClientCount === 1 && soleExistingClientName) {
    return (
      <div className="card p-8">
        <p className="text-xs font-medium text-gray-400 mb-3">Step 3 of 8</p>
        <h1 className="text-2xl font-bold text-navy-800 mb-2">We found {soleExistingClientName}</h1>
        <p className="text-gray-500 text-sm mb-6">Continue with this client for your first QBR.</p>

        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

        <button
          onClick={() => submitAttach()}
          disabled={loading}
          className="btn-primary w-full py-3 text-sm"
        >
          {loading ? 'Continuing...' : `Continue with ${soleExistingClientName}`}
        </button>
      </div>
    )
  }

  return (
    <div className="card p-8">
      <p className="text-xs font-medium text-gray-400 mb-3">Step 3 of 8</p>
      <h1 className="text-2xl font-bold text-navy-800 mb-2">Add your first client</h1>
      <p className="text-gray-500 text-sm mb-6">This creates a real client record in your workspace.</p>

      <div className="space-y-4">
        <div>
          <label className="label">Company name <span className="text-red-400">*</span></label>
          <input
            className="input"
            placeholder="Acme Corp"
            value={form.name}
            onChange={e => set('name', e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Industry</label>
            <input
              className="input"
              placeholder="Healthcare, Legal, Finance..."
              value={form.industry}
              onChange={e => set('industry', e.target.value)}
              disabled={loading}
            />
          </div>
          <div>
            <label className="label">User count</label>
            <input
              className="input"
              type="number"
              placeholder="48"
              value={form.userCount}
              onChange={e => set('userCount', e.target.value)}
              disabled={loading}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Primary contact name</label>
            <input
              className="input"
              placeholder="John Smith"
              value={form.contactName}
              onChange={e => set('contactName', e.target.value)}
              disabled={loading}
            />
          </div>
          <div>
            <label className="label">Contact email</label>
            <input
              className="input"
              type="email"
              placeholder="john@acme.com"
              value={form.contactEmail}
              onChange={e => set('contactEmail', e.target.value)}
              disabled={loading}
            />
          </div>
        </div>

        <div>
          <label className="label">Internal notes <span className="text-gray-400 font-normal">(optional)</span></label>
          <textarea
            className="input"
            rows={2}
            placeholder="Any context about this client..."
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            disabled={loading}
          />
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <button
          onClick={submitCreate}
          disabled={loading}
          className="btn-primary w-full py-3 text-sm"
        >
          {loading ? 'Creating...' : 'Create client & continue'}
        </button>
      </div>
    </div>
  )
}

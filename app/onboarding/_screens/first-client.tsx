'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  // Persisted clientStepIdempotencyKey, if the row already has one (e.g. a
  // reload after a lost response). Null on first-ever render of this step.
  persistedKey: string | null
  existingClientCount: number
  soleExistingClientName: string | null
}

export function FirstClientScreen({ persistedKey, existingClientCount, soleExistingClientName }: Props) {
  const router = useRouter()
  // Lazily generated on first submit, never during render — see P2
  // onboarding preflight, Correction 1. Reused for retries within this
  // mounted screen session; a reload re-seeds from the server-persisted key.
  const keyRef = useRef<string | null>(persistedKey)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '', industry: '', contactName: '', contactEmail: '', userCount: '', notes: '',
  })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  function ensureKey() {
    if (!keyRef.current) keyRef.current = crypto.randomUUID()
    return keyRef.current
  }

  async function submitAttach() {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const retryKey = ensureKey()
      const res = await fetch('/api/onboarding/client', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mode: 'attach', retryKey }),
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

  // 2+ existing, unanchored clients — safe inert state for this PR. No
  // auto-pick, no forced duplicate creation, no multi-client selector here.
  // See P2 onboarding preflight, Correction 2.
  if (existingClientCount > 1) {
    return (
      <div className="card p-8 text-center">
        <p className="text-xs font-medium text-gray-400 mb-3">Step 3 of 8</p>
        <h1 className="text-2xl font-bold text-navy-800 mb-2">Choose a client later</h1>
        <p className="text-gray-500 text-sm mb-8">
          This workspace already has multiple clients. Client selection for onboarding isn&apos;t available yet.
        </p>
        <button
          onClick={() => router.push('/dashboard')}
          className="btn-primary w-full py-3 text-sm"
        >
          Return to dashboard
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
          onClick={submitAttach}
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

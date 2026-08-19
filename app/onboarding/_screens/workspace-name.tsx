'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function WorkspaceNameScreen({ initialName }: { initialName: string }) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function saveAndContinue() {
    if (loading) return // guard against duplicate submission

    const trimmed = name.trim()
    if (!trimmed) {
      setError('Workspace name is required')
      return
    }

    setLoading(true)
    setError('')

    try {
      // FIRST: the existing workspace-rename endpoint, unchanged contract.
      const patchRes = await fetch('/api/workspace', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: trimmed }),
      })
      const patchData = await patchRes.json()

      if (!patchRes.ok) {
        throw new Error(typeof patchData.error === 'string' ? patchData.error : 'Failed to save workspace name')
      }

      // SECOND: only after the name write has actually succeeded — never
      // attempted if the PATCH above failed.
      const advanceRes = await fetch('/api/onboarding/advance', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ toStep: 'FIRST_CLIENT' }),
      })
      const advanceData = await advanceRes.json()

      if (!advanceRes.ok) {
        throw new Error(typeof advanceData.error === 'string' ? advanceData.error : 'Failed to continue')
      }

      // FIRST_CLIENT has no screen in this deployment yet — the onboarding
      // row is now durably at FIRST_CLIENT, and normal product access is the
      // intentional temporary fail-open target, not /onboarding/first-client.
      router.push('/dashboard')
    } catch (e: any) {
      setError(e.message)
      setLoading(false)
    }
  }

  return (
    <div className="card p-8">
      <p className="text-xs font-medium text-gray-400 mb-3">Step 2 of 8</p>
      <h1 className="text-2xl font-bold text-navy-800 mb-2">Name your workspace</h1>
      <p className="text-gray-500 text-sm mb-6">
        This name is used inside your workspace and can be changed later.
      </p>

      <label className="label">Workspace name</label>
      <input
        className="input"
        value={name}
        onChange={e => setName(e.target.value)}
        disabled={loading}
      />

      {error && <p className="text-red-500 text-sm mt-3">{error}</p>}

      <button
        onClick={saveAndContinue}
        disabled={loading}
        className="btn-primary w-full py-3 text-sm mt-6"
      >
        {loading ? 'Saving...' : 'Save & continue'}
      </button>
    </div>
  )
}

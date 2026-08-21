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
      // One atomic call: the dedicated onboarding endpoint renames the
      // workspace and advances currentStep to FIRST_CLIENT together, in a
      // single transaction — see P2 onboarding PR 8 preflight, "Workspace
      // Name — must-fix". This is authorized by the exact anchored
      // onboardingOwnerUserId, never by the generic PATCH /api/workspace's
      // TeamRole OWNER requirement, so a creator demoted from OWNER mid-onboarding
      // is never stranded here.
      const res = await fetch('/api/onboarding/workspace-name', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: trimmed }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to save workspace name')
      }

      router.push('/onboarding/first-client')
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

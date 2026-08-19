'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function WelcomeScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function getStarted() {
    if (loading) return // guard against duplicate submission
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/onboarding/advance', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ toStep: 'WORKSPACE_NAME' }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to continue')
      }

      // Persisted server response is authoritative — only navigate once the
      // advance call has actually confirmed currentStep moved forward.
      router.push('/onboarding/workspace-name')
    } catch (e: any) {
      setError(e.message)
      setLoading(false)
    }
  }

  return (
    <div className="card p-8 text-center">
      <p className="text-xs font-medium text-gray-400 mb-3">Step 1 of 8</p>
      <h1 className="text-2xl font-bold text-navy-800 mb-2">Welcome to QBR Deck</h1>
      <p className="text-gray-500 text-sm mb-8">
        Let&apos;s set up your workspace and create your first QBR.
      </p>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <button
        onClick={getStarted}
        disabled={loading}
        className="btn-primary w-full py-3 text-sm"
      >
        {loading ? 'Loading...' : 'Get started'}
      </button>
    </div>
  )
}

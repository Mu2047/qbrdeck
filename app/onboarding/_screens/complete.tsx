'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Destination = 'dashboard' | 'new-client' | 'invite'

type Props = {
  // Only shown when the workspace has actual current seat capacity — see
  // P2 onboarding PR 7 preflight, Correction 3: derived from the same
  // canInviteMoreMembers(plan, memberCount) source of truth the real invite
  // endpoint uses, never from plan type alone.
  canInviteTeammate: boolean
}

const DESTINATION_PATH: Record<Destination, string> = {
  dashboard:  '/dashboard',
  'new-client': '/dashboard/clients/new',
  invite:     '/dashboard/settings',
}

// Completion is authoritative and singular: every button below calls the
// exact same finish() function, which hits the same idempotent endpoint —
// only the post-success destination differs. No button may navigate without
// a prior successful completion write.
export function CompleteScreen({ canInviteTeammate }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState<Destination | null>(null)
  const [error, setError] = useState('')

  async function finish(destination: Destination) {
    if (pending) return
    setPending(destination)
    setError('')
    try {
      const res = await fetch('/api/onboarding/finish', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to finish onboarding')
      }
      router.push(DESTINATION_PATH[destination])
    } catch (e: any) {
      setError(e.message)
      setPending(null)
    }
  }

  return (
    <div className="card p-8 text-center">
      <p className="text-xs font-medium text-gray-400 mb-3">Step 8 of 8</p>
      <h1 className="text-2xl font-bold text-navy-800 mb-2">Your workspace is ready</h1>
      <p className="text-gray-500 text-sm mb-8">You&apos;ve set up your first client and generated your first QBR.</p>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <div className="space-y-3">
        <button
          onClick={() => finish('dashboard')}
          disabled={pending !== null}
          className="btn-primary w-full py-3 text-sm"
        >
          {pending === 'dashboard' ? 'Finishing...' : 'Finish & go to dashboard'}
        </button>

        <button
          onClick={() => finish('new-client')}
          disabled={pending !== null}
          className="btn-secondary w-full py-3 text-sm"
        >
          {pending === 'new-client' ? 'Finishing...' : 'Finish & add another client'}
        </button>

        {canInviteTeammate && (
          <button
            onClick={() => finish('invite')}
            disabled={pending !== null}
            className="btn-secondary w-full py-3 text-sm"
          >
            {pending === 'invite' ? 'Finishing...' : 'Finish & invite teammate'}
          </button>
        )}
      </div>
    </div>
  )
}

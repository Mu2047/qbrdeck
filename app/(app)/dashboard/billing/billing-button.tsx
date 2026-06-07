'use client'

import { useState } from 'react'

export function BillingButton({
  planKey,
  isCurrent,
  priceId,
}: {
  planKey: string
  isCurrent: boolean
  priceId?: string | null
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function handleClick() {
    if (isCurrent) return
    setLoading(true)
    setError('')

    try {
      // ── Manage subscription (portal) ────────────────────────────────────
      if (planKey === 'MANAGE') {
        const res  = await fetch('/api/billing/portal', { method: 'POST' })
        const data = await res.json()
        if (!res.ok) { setError(data.error ?? 'Something went wrong'); setLoading(false); return }
        if (data.url) { window.location.href = data.url } else { setError('No portal URL'); setLoading(false) }
        return
      }

      // ── Upgrade / checkout ───────────────────────────────────────────────
      if (!priceId) { setError('Price ID missing'); setLoading(false); return }

      const res  = await fetch('/api/billing/checkout', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ priceId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Something went wrong'); setLoading(false); return }
      if (data.url) { window.location.href = data.url } else { setError('No checkout URL'); setLoading(false) }

    } catch (e: any) {
      setError(e.message ?? 'Network error')
      setLoading(false)
    }
  }

  if (isCurrent) {
    return (
      <button disabled className="btn-secondary w-full justify-center opacity-50 cursor-not-allowed">
        Current plan
      </button>
    )
  }

  return (
    <div>
      <button onClick={handleClick} disabled={loading} className="btn-primary w-full justify-center">
        {loading ? 'Loading...' : planKey === 'MANAGE' ? 'Manage Subscription' : 'Upgrade'}
      </button>
      {error && <p className="text-red-500 text-xs mt-2 text-center">{error}</p>}
    </div>
  )
}

// Keep for backwards compatibility if used elsewhere
export function ManageSubscriptionButton() {
  return <BillingButton planKey="MANAGE" isCurrent={false} priceId={null} />
}
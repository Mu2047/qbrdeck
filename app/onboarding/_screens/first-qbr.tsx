'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  // Persisted qbrStepIdempotencyKey, if the row already has one (e.g. a
  // reload after a lost response). Null on first-ever render of this step.
  persistedKey: string | null
}

export function FirstQbrScreen({ persistedKey }: Props) {
  const router = useRouter()
  // Lazily generated on first submit, never during render — see P2
  // onboarding preflight, Correction 1.
  const keyRef = useRef<string | null>(persistedKey)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    quarter: String(Math.ceil((new Date().getMonth() + 1) / 3)),
    year: new Date().getFullYear(),
    tickets: '', avgResolutionHrs: '', uptimePct: '', patchCompliancePct: '',
    securityIncidents: '', usersSupported: '', ticketCategories: '', wins: '', upsellOpportunities: '',
  })
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  function ensureKey() {
    if (!keyRef.current) keyRef.current = crypto.randomUUID()
    return keyRef.current
  }

  async function generate() {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const retryKey = ensureKey()
      const res = await fetch('/api/onboarding/qbr', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          retryKey,
          quarter: form.quarter,
          year: Number(form.year),
          tickets:             form.tickets            ? Number(form.tickets)            : undefined,
          avgResolutionHrs:    form.avgResolutionHrs   ? Number(form.avgResolutionHrs)   : undefined,
          uptimePct:           form.uptimePct           ? Number(form.uptimePct)           : undefined,
          patchCompliancePct:  form.patchCompliancePct  ? Number(form.patchCompliancePct)  : undefined,
          securityIncidents:   form.securityIncidents   ? Number(form.securityIncidents)   : undefined,
          usersSupported:      form.usersSupported      ? Number(form.usersSupported)      : undefined,
          ticketCategories:    form.ticketCategories    || undefined,
          wins:                form.wins                || undefined,
          upsellOpportunities: form.upsellOpportunities || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === 'LIMIT_REACHED') {
          setError("You've reached your Free plan limit for this month. Upgrade to continue generating QBRs.")
          setLoading(false)
          return
        }
        throw new Error(typeof data.error === 'string' ? data.error : 'Generation failed. Please try again.')
      }
      // Screen 5 (Review QBR) does not exist yet — the persisted step is now
      // REVIEW_QBR, and /dashboard is the intentional temporary fail-open
      // target, not /onboarding/review-qbr.
      router.push('/dashboard')
    } catch (e: any) {
      setError(e.message || 'Generation failed. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="card p-8">
      <p className="text-xs font-medium text-gray-400 mb-3">Step 4 of 8</p>
      <h1 className="text-2xl font-bold text-navy-800 mb-2">Generate your first QBR</h1>
      <p className="text-gray-500 text-sm mb-6">We&apos;ll use AI to draft your first Quarterly Business Review.</p>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Quarter</label>
            <select className="input" value={form.quarter} onChange={e => set('quarter', e.target.value)} disabled={loading}>
              <option value="1">Q1 (Jan–Mar)</option>
              <option value="2">Q2 (Apr–Jun)</option>
              <option value="3">Q3 (Jul–Sep)</option>
              <option value="4">Q4 (Oct–Dec)</option>
            </select>
          </div>
          <div>
            <label className="label">Year</label>
            <input className="input" type="number" value={form.year} onChange={e => set('year', e.target.value)} disabled={loading} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Tickets closed</label>
            <input className="input" type="number" placeholder="142" value={form.tickets} onChange={e => set('tickets', e.target.value)} disabled={loading} />
          </div>
          <div>
            <label className="label">Avg resolution time (hrs)</label>
            <input className="input" type="number" step="0.1" placeholder="3.2" value={form.avgResolutionHrs} onChange={e => set('avgResolutionHrs', e.target.value)} disabled={loading} />
          </div>
          <div>
            <label className="label">Uptime %</label>
            <input className="input" type="number" step="0.01" placeholder="99.7" value={form.uptimePct} onChange={e => set('uptimePct', e.target.value)} disabled={loading} />
          </div>
          <div>
            <label className="label">Patch compliance %</label>
            <input className="input" type="number" placeholder="94" value={form.patchCompliancePct} onChange={e => set('patchCompliancePct', e.target.value)} disabled={loading} />
          </div>
          <div>
            <label className="label">Security incidents</label>
            <input className="input" type="number" placeholder="0" value={form.securityIncidents} onChange={e => set('securityIncidents', e.target.value)} disabled={loading} />
          </div>
          <div>
            <label className="label">Users supported</label>
            <input className="input" type="number" placeholder="48" value={form.usersSupported} onChange={e => set('usersSupported', e.target.value)} disabled={loading} />
          </div>
        </div>

        <div>
          <label className="label">Top ticket categories <span className="text-gray-400 font-normal">(comma separated)</span></label>
          <input className="input" placeholder="Password resets, VPN issues, Printer setup" value={form.ticketCategories} onChange={e => set('ticketCategories', e.target.value)} disabled={loading} />
        </div>
        <div>
          <label className="label">Notable wins & completed projects this quarter</label>
          <textarea className="input" rows={3} placeholder="e.g. Completed M365 migration, deployed MFA..." value={form.wins} onChange={e => set('wins', e.target.value)} disabled={loading} />
        </div>
        <div>
          <label className="label">Risks or upsell opportunities <span className="text-gray-400 font-normal">(optional)</span></label>
          <textarea className="input" rows={2} placeholder="e.g. No EDR solution in place..." value={form.upsellOpportunities} onChange={e => set('upsellOpportunities', e.target.value)} disabled={loading} />
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <button
          onClick={generate}
          disabled={loading}
          className="btn-primary w-full py-3 text-sm"
        >
          {loading ? 'Generating QBR...' : 'Generate QBR with AI'}
        </button>
      </div>
    </div>
  )
}

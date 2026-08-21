'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type ReviewSlide = {
  title?: string
  content?: string
  bullets?: string[]
}

type Props = {
  clientName: string
  quarter: string
  year: number
  healthScore: number | null
  healthStatus: string | null
  summary: string | null
  slides: ReviewSlide[]
}

// Read-only by design — see P2 onboarding PR 7 preflight, Correction 1: after
// PR 8 activation, dashboard product routes will be gated while onboarding is
// IN_PROGRESS, so a dashboard-editor escape hatch from this screen would be
// structurally incompatible with the final activated flow. Editing is an
// optional product capability, not something this screen offers.
export function ReviewQbrScreen({ clientName, quarter, year, healthScore, healthStatus, summary, slides }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleContinue() {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/onboarding/advance', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ toStep: 'EXPORT_QBR' }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to continue')
      }
      router.push('/onboarding/export-qbr')
    } catch (e: any) {
      setError(e.message)
      setLoading(false)
    }
  }

  return (
    <div className="card p-8 max-w-2xl">
      <p className="text-xs font-medium text-gray-400 mb-3">Step 5 of 8</p>
      <h1 className="text-2xl font-bold text-navy-800 mb-2">Review your QBR</h1>
      <p className="text-gray-500 text-sm mb-6">Take a look at what we generated. You can edit this later from your dashboard.</p>

      <div className="card mb-6 overflow-hidden">
        <div className="bg-navy-800 p-6 flex items-center justify-between">
          <div>
            <p className="text-gold-300 text-xs tracking-widest mb-2">QUARTERLY BUSINESS REVIEW</p>
            <p className="text-white text-xl font-bold mb-1">{clientName}</p>
            <p className="text-gold-300 text-sm">Q{quarter} {year}</p>
          </div>
          <div className="bg-[#0d1f3c] rounded-lg border border-gold-500 px-4 py-2.5 text-center flex-shrink-0">
            <p className="text-gold-300 text-[10px] tracking-widest mb-1">TECH HEALTH SCORE</p>
            <p className="text-white text-2xl font-bold">
              {healthScore != null ? healthScore : 'N/A'}
              <span className="text-xs text-gray-400">/100</span>
            </p>
            <p className="text-white text-xs font-semibold mt-1">{healthStatus ?? 'Not assessed'}</p>
          </div>
        </div>
      </div>

      {summary && (
        <p className="text-sm text-gray-600 leading-relaxed mb-6">{summary}</p>
      )}

      <div className="space-y-4 mb-6">
        {slides.map((slide, i) => (
          <div key={i} className="border border-gray-100 rounded-lg p-4">
            {slide.title && <p className="text-sm font-semibold text-navy-800 mb-2">{slide.title}</p>}
            {slide.content && <p className="text-sm text-gray-600 leading-relaxed mb-2">{slide.content}</p>}
            {slide.bullets && slide.bullets.length > 0 && (
              <ul className="space-y-1.5">
                {slide.bullets.map((b, j) => (
                  <li key={j} className="text-sm text-gray-700 flex items-start gap-2">
                    <span className="w-1 h-1 rounded-full bg-gold-500 flex-shrink-0 mt-2" />
                    {b}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <button
        onClick={handleContinue}
        disabled={loading}
        className="btn-primary w-full py-3 text-sm"
      >
        {loading ? 'Continuing...' : 'Continue'}
      </button>
    </div>
  )
}

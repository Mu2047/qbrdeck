'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, FileText, Check, Loader2, Share2, Copy, Mail } from 'lucide-react'
import { healthCardLabel, isHealthScoreMetric, statusToColor, type HealthStatus } from '@/lib/health-score'
import { requestJson, type ApiResult } from '@/lib/api-client'

type SaveState = 'idle' | 'saving' | 'saved'

// Decision logic for sendToClient(), factored out of the handler for
// readability: a 2xx response whose payload lacks success === true is a
// failure, exactly like a non-2xx response or a network rejection — never
// partial credit for "the fetch resolved". (Not exported: Next.js's App
// Router restricts page.tsx to its fixed set of framework exports.)
function resolveSendResult(result: ApiResult<{ success: boolean }>): {
  sent: boolean
  error: string | null
} {
  if (result.ok && result.data?.success === true) {
    return { sent: true, error: null }
  }
  return {
    sent: false,
    error: result.ok ? 'The email could not be sent. Please try again.' : result.error,
  }
}

// Tailwind classes for each deterministic health-status color family.
// Mirrors the equivalent map in components/qbr/SlideBody.tsx (not imported
// from there since SlideBody does not export it and this commit does not
// modify that file).
const HEALTH_STATUS_CLASSES: Record<ReturnType<typeof statusToColor>, { card: string; text: string }> = {
  green:  { card: 'bg-green-50 border-green-200',   text: 'text-green-600'  },
  blue:   { card: 'bg-blue-50 border-blue-200',     text: 'text-blue-600'   },
  yellow: { card: 'bg-yellow-50 border-yellow-200', text: 'text-yellow-600' },
  orange: { card: 'bg-orange-50 border-orange-200', text: 'text-orange-600' },
  red:    { card: 'bg-red-50 border-red-200',       text: 'text-red-600'   },
}

export default function QBRPage({ params }: { params: { id: string; qbrId: string } }) {
  const [qbr, setQbr]                   = useState<any>(null)
  // ── Raw vs. resolved slide state ─────────────────────────────────────────
  // rawSlides: the raw, placeholder-bearing slides exactly as stored in the
  //   database (data.slides from the GET response). This is the ONLY array
  //   ever sent to PATCH — it is what preserves untouched {{...}} placeholders
  //   across an edit to an unrelated field.
  // resolvedSlides: the display-only, placeholder-substituted copy
  //   (data.resolvedSlides from the GET response). Everything the user sees
  //   is rendered from this array; it is never sent to PATCH.
  const [rawSlides, setRawSlides]       = useState<any[]>([])
  const [resolvedSlides, setResolvedSlides] = useState<any[]>([])
  const [exporting, setExporting] = useState<'pdf' | 'pptx' | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const saveTimer                 = useRef<NodeJS.Timeout>()
  const sendConfirmationTimer     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sharing, setSharing]     = useState(false)
  const [copied, setCopied]       = useState(false)
  const [shareUrl, setShareUrl]   = useState<string | null>(null)
  const [sending, setSending]     = useState(false)
  const [sent, setSent]           = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sendEmail, setSendEmail] = useState('')
  const [showEmailInput, setShowEmailInput] = useState(false)
  useEffect(() => {
    fetch(`/api/qbrs/${params.qbrId}`)
      .then(r => r.json())
      .then(data => {
        setQbr(data)
        setRawSlides(data.slides ?? [])
        setResolvedSlides(data.resolvedSlides ?? data.slides ?? [])
      })
  }, [params.qbrId])

  // Clear any pending "Sent to client!" auto-reset timer on unmount so it
  // never fires a state update after the page has been navigated away from.
  useEffect(() => {
    return () => {
      if (sendConfirmationTimer.current) clearTimeout(sendConfirmationTimer.current)
    }
  }, [])

  // ── Save to DB ────────────────────────────────────────────────────────────
  // Always PATCHes rawSlides (never resolvedSlides), so every untouched
  // field's raw {{...}} placeholders are preserved exactly as stored.
  async function saveSlides(nextRawSlides: any[]) {
    setSaveState('saving')
    clearTimeout(saveTimer.current)
    await fetch(`/api/qbrs/${params.qbrId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slides: nextRawSlides }),
    })
    setSaveState('saved')
    saveTimer.current = setTimeout(() => setSaveState('idle'), 2000)
  }

  // ── Slide field updaters ──────────────────────────────────────────────────
  // Each updater applies the identical edit to both rawSlides (source of
  // truth, sent to PATCH) and resolvedSlides (display, mirrors the edit
  // immediately). Only the targeted slide/field changes in either array —
  // every other slide is passed through unchanged by reference.
  function updateContent(slideIdx: number, value: string) {
    const nextRaw      = rawSlides.map((s, i) => i === slideIdx ? { ...s, content: value } : s)
    const nextResolved = resolvedSlides.map((s, i) => i === slideIdx ? { ...s, content: value } : s)
    setRawSlides(nextRaw)
    setResolvedSlides(nextResolved)
    saveSlides(nextRaw)
  }

  function updateBullet(slideIdx: number, bulletIdx: number, value: string) {
    const nextRaw = rawSlides.map((s, i) => {
      if (i !== slideIdx) return s
      const bullets = s.bullets.map((b: string, j: number) => j === bulletIdx ? value : b)
      return { ...s, bullets }
    })
    const nextResolved = resolvedSlides.map((s, i) => {
      if (i !== slideIdx) return s
      const bullets = s.bullets.map((b: string, j: number) => j === bulletIdx ? value : b)
      return { ...s, bullets }
    })
    setRawSlides(nextRaw)
    setResolvedSlides(nextResolved)
    saveSlides(nextRaw)
  }

  function updateMetric(slideIdx: number, metricIdx: number, field: string, value: string) {
    const nextRaw = rawSlides.map((s, i) => {
      if (i !== slideIdx) return s
      const metrics = s.metrics.map((m: any, j: number) =>
        j === metricIdx ? { ...m, [field]: value } : m
      )
      return { ...s, metrics }
    })
    const nextResolved = resolvedSlides.map((s, i) => {
      if (i !== slideIdx) return s
      const metrics = s.metrics.map((m: any, j: number) =>
        j === metricIdx ? { ...m, [field]: value } : m
      )
      return { ...s, metrics }
    })
    setRawSlides(nextRaw)
    setResolvedSlides(nextResolved)
    saveSlides(nextRaw)
  }

  // ── Export ────────────────────────────────────────────────────────────────
 async function sendToClient() {
    if (!sendEmail || sending) return
    setSendError(null)
    setSent(false)
    if (sendConfirmationTimer.current) {
      clearTimeout(sendConfirmationTimer.current)
      sendConfirmationTimer.current = null
    }
    setSending(true)
    try {
      const result = await requestJson<{ success: boolean }>(`/api/qbrs/${params.qbrId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: sendEmail }),
      })
      const outcome = resolveSendResult(result)
      if (outcome.sent) {
        setSent(true)
        setShowEmailInput(false)
        sendConfirmationTimer.current = setTimeout(() => {
          setSent(false)
          sendConfirmationTimer.current = null
        }, 3000)
      } else {
        setShowEmailInput(true)
        setSendError(outcome.error)
      }
    } finally {
      setSending(false)
    }
  }

  async function exportFile(type: 'pdf' | 'pptx') {
    setExporting(type)
    const res = await fetch(`/api/export-${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qbrId: params.qbrId }),
    })

    if (!res.ok) {
      const data = await res.json()
      setExporting(null)
      if (data.error === 'LIMIT_REACHED') {
        window.location.href = '/dashboard/billing'
      } else {
        alert(data.error ?? 'Export failed')
      }
      return
    }

    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `QBR-Q${qbr?.quarter}-${qbr?.year}.${type}`
    a.click()
    setExporting(null)
  }

  async function shareQBR() {
    setSharing(true)
    const res  = await fetch(`/api/qbrs/${params.qbrId}/share`, { method: 'POST' })
    const data = await res.json()
    const url  = `${window.location.origin}/portal/${data.token}`
    setShareUrl(url)
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setSharing(false)
    setTimeout(() => setCopied(false), 3000)
  }

  if (!qbr) return <div className="p-8 text-gray-400 text-sm">Loading...</div>

  const statusBadge = (s: string) =>
    s === 'good' ? 'badge-green' : s === 'caution' ? 'badge-amber' : 'badge-red'

  const statusLabel = (s: string) =>
    s === 'good' ? 'On track' : s === 'caution' ? 'Monitor' : 'Needs attention'

  return (
    <div className="p-8 max-w-4xl">

      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href={`/dashboard/clients/${params.id}`} className="btn-secondary text-sm py-1.5 px-3">
            <ArrowLeft size={14} /> Back
          </Link>
          <h1 className="text-xl font-bold text-navy-800">Q{qbr.quarter} {qbr.year} QBR</h1>
        </div>

        {/* Save indicator */}
        <div className="text-xs text-gray-400 flex items-center gap-1.5 h-5">
          {saveState === 'saving' && <><Loader2 size={12} className="animate-spin" /> Saving...</>}
          {saveState === 'saved'  && <><Check size={12} className="text-green-500" /> Saved</>}
        </div>
      </div>

      {/* ── Cover ── */}
      {/* Client name, quarter/year, and health score/status always come from
          the QBR record's own deterministic fields (qbr.client.name,
          qbr.quarter, qbr.year, qbr.healthScore, qbr.healthStatus) — never
          from an individual slide's AI-authored metric status. */}
      <div className="card mb-6 overflow-hidden">
        <div className="bg-navy-800 p-8 flex items-center justify-between">
          <div>
            <p className="text-gold-300 text-xs tracking-widest mb-3">QUARTERLY BUSINESS REVIEW</p>
            <p className="text-white text-2xl font-bold mb-1">{qbr.client.name}</p>
            <p className="text-gold-300 text-lg">Q{qbr.quarter} {qbr.year}</p>
          </div>
          <div className="bg-[#0d1f3c] rounded-lg border border-gold-500 px-5 py-3 text-center flex-shrink-0">
            <p className="text-gold-300 text-[10px] tracking-widest mb-1">TECH HEALTH SCORE</p>
            <p className="text-white text-3xl font-bold">
              {qbr.healthScore != null ? qbr.healthScore : 'N/A'}
              <span className="text-sm text-gray-400">/100</span>
            </p>
            <p className="text-white text-sm font-semibold mt-1">{qbr.healthStatus ?? 'Not assessed'}</p>
          </div>
        </div>
      </div>

      {/* ── Export bar ── */}
      <div className="card p-4 mb-6 flex items-center justify-between">
        <p className="text-sm text-gray-600">Export this QBR to share with your client.</p>
        <div className="flex gap-3">
          <button onClick={() => setShowEmailInput(v => !v)} disabled={sending} className="btn-secondary text-sm py-2">
            <Mail size={14} /> Send to Client
          </button>
          <button onClick={shareQBR} disabled={sharing} className="btn-secondary text-sm py-2">
            {sharing ? <Loader2 size={14} className="animate-spin" /> : copied ? <><Check size={14} className="text-green-500" /> Copied!</> : <><Share2 size={14} /> Share Link</>}
          </button>
          <button onClick={() => exportFile('pdf')} disabled={!!exporting} className="btn-secondary text-sm py-2">
            {exporting === 'pdf' ? 'Exporting...' : <><Download size={14} /> PDF</>}
          </button>
          <button onClick={() => exportFile('pptx')} disabled={!!exporting} className="btn-primary text-sm py-2">
            {exporting === 'pptx' ? 'Exporting...' : <><FileText size={14} /> PowerPoint</>}
          </button>
        </div>
      </div>

      {/* ── Send status — accessible, and rendered outside the email panel so
          it persists (and stays announced) even after the panel closes on
          success. Only mounted while there's something to announce, so the
          role="status" region is never permanently present but empty. ── */}
      {(sending || sent) && (
        <div role="status" aria-live="polite" className="text-xs text-gray-500 h-4 mb-1 flex items-center gap-1.5">
          {sending && <><Loader2 size={12} className="animate-spin" aria-hidden="true" /> Sending to client...</>}
          {!sending && sent && <><Check size={12} className="text-green-500" aria-hidden="true" /> Sent to client!</>}
        </div>
      )}

      {/* ── Email input ── */}
      {showEmailInput && (
        <div className="card p-4 mb-4 flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Mail size={16} className="text-gray-400 flex-shrink-0" />
            <input
              type="email"
              placeholder="Client email address"
              aria-label="Client email address"
              value={sendEmail}
              onChange={e => setSendEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendToClient()}
              className="flex-1 text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy-800"
            />
            <button
              onClick={sendToClient}
              disabled={sending || !sendEmail}
              aria-busy={sending}
              className="btn-primary text-sm py-2 px-4"
            >
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
          {sendError && (
            <p role="alert" className="text-xs text-red-600">{sendError}</p>
          )}
        </div>
      )}

      {/* ── Edit hint ── */}
      <p className="text-xs text-gray-400 mb-4 italic">
        Click any text to edit. Changes save automatically.
      </p>

      {/* ── Slides ── */}
      {resolvedSlides.map((slide: any, i: number) => (
        <div key={i} className="card mb-4 overflow-hidden">

          {/* Slide header */}
          <div className="bg-navy-800 px-6 py-3 flex items-center justify-between">
            <p className="text-white text-sm font-medium">{slide.title}</p>
            <span className="text-white/40 text-xs">Slide {i + 2}</span>
          </div>

          <div className="p-6">

            {/* Content paragraph */}
            <EditableText
              value={slide.content}
              onSave={val => updateContent(i, val)}
              multiline
              className="text-gray-600 text-sm leading-relaxed mb-4"
            />

            {/* Metrics */}
            {slide.type === 'metrics' && slide.metrics && (
              <div className="grid grid-cols-3 gap-3">
                {slide.metrics.map((m: any, j: number) => {
                  // Health-score card: deterministic label + color from the
                  // stored qbr.healthStatus, same treatment as SlideBody
                  // (portal/preview) — see lib/health-score.ts healthCardLabel().
                  // Falls back to the standard good/caution/risk styling if
                  // qbr.healthStatus is unavailable or unrecognized.
                  const isHealthCard = isHealthScoreMetric(m.label)
                  const healthColorFamily = isHealthCard && qbr.healthStatus
                    ? statusToColor(qbr.healthStatus as HealthStatus)
                    : undefined
                  const healthClasses = healthColorFamily ? HEALTH_STATUS_CLASSES[healthColorFamily] : undefined

                  const cardClasses = healthClasses ? healthClasses.card : (
                    m.status === 'good'    ? 'bg-green-50 border-green-200' :
                    m.status === 'caution' ? 'bg-amber-50 border-amber-200' :
                                            'bg-red-50 border-red-200')

                  return (
                    <div key={j} className={`rounded-lg p-3.5 border ${cardClasses}`}>
                      <EditableText
                        value={m.label}
                        onSave={val => updateMetric(i, j, 'label', val)}
                        className="text-xs text-gray-500 mb-1 block"
                      />
                      <EditableText
                        value={m.value}
                        onSave={val => updateMetric(i, j, 'value', val)}
                        className="text-xl font-bold text-navy-800 mb-1 block"
                      />
                      {/* Health-score card: deterministic, read-only status —
                          the AI-authored 3-tier status select below does not
                          apply to this card, since its displayed status must
                          always match qbr.healthStatus, not an editable
                          good/caution/risk bucket that cannot represent
                          values like "Excellent" or "Strong". */}
                      {healthClasses ? (
                        <p className={`text-xs font-medium ${healthClasses.text}`}>
                          {healthCardLabel(m, qbr.healthStatus)}
                        </p>
                      ) : (
                        <select
                          value={m.status}
                          onChange={e => updateMetric(i, j, 'status', e.target.value)}
                          className={`text-xs rounded px-1 py-0.5 border-0 cursor-pointer font-medium
                            ${m.status === 'good'    ? 'bg-green-100 text-green-700' :
                              m.status === 'caution' ? 'bg-amber-100 text-amber-700' :
                                                       'bg-red-100 text-red-700'}`}
                        >
                          <option value="good">On track</option>
                          <option value="caution">Monitor</option>
                          <option value="risk">Needs attention</option>
                        </select>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Bullets */}
            {slide.bullets && (
              <div className="space-y-2.5">
                {slide.bullets.map((b: string, j: number) => (
                  <div key={j} className="flex items-start gap-2.5">
                    <div className="w-0.5 h-5 bg-gold-500 flex-shrink-0 mt-1 rounded-full" />
                    <EditableText
                      value={b}
                      onSave={val => updateBullet(i, j, val)}
                      className="text-sm text-gray-700 flex-1"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Roadmap — read-only in this commit; presentation ported from
                components/qbr/SlideBody.tsx / the public portal verbatim. */}
            {slide.priorities && (
              <div className="grid grid-cols-3 gap-4">
                {[
                  { key: 'critical',  label: 'Critical',  color: 'bg-red-50 border-red-200 text-red-700'    },
                  { key: 'important', label: 'Important', color: 'bg-amber-50 border-amber-200 text-amber-700' },
                  { key: 'strategic', label: 'Strategic', color: 'bg-blue-50 border-blue-200 text-blue-700'  },
                ].map(col => (
                  <div key={col.key} className={`rounded-lg border p-3 ${col.color}`}>
                    <p className="text-xs font-bold uppercase tracking-wide mb-2">{col.label}</p>
                    <ul className="space-y-1.5">
                      {(slide.priorities[col.key] ?? []).map((item: string, k: number) => (
                        <li key={k} className="text-xs leading-snug">— {item}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {/* Recommendations — read-only in this commit; presentation
                ported from components/qbr/SlideBody.tsx / the public portal
                verbatim. */}
            {slide.recommendations && (
              <div className="space-y-4">
                {slide.recommendations.map((rec: any, j: number) => (
                  <div key={j} className="border border-gray-100 rounded-lg p-4">
                    <p className="text-sm font-semibold text-[#0a1634] mb-2">{j + 1}. {rec.title}</p>
                    <div className="space-y-1 text-xs text-gray-600">
                      <p><span className="font-medium text-gray-700">Why it matters:</span> {rec.why}</p>
                      <p><span className="font-medium text-gray-700">Risk if ignored:</span> {rec.risk}</p>
                      <p><span className="font-medium text-gray-700">Expected benefit:</span> {rec.benefit}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>
        </div>
      ))}
    </div>
  )
}

// ── Inline editable text component ──────────────────────────────────────────
function EditableText({
  value,
  onSave,
  multiline = false,
  className = '',
}: {
  value: string
  onSave: (val: string) => void
  multiline?: boolean
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(value)
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null)

  useEffect(() => { if (editing) ref.current?.focus() }, [editing])

  function commit() {
    setEditing(false)
    if (draft.trim() !== value) onSave(draft.trim())
  }

  if (editing) {
    const shared = {
      ref,
      value: draft,
      onChange: (e: any) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: any) => {
        if (!multiline && e.key === 'Enter') { e.preventDefault(); commit() }
        if (e.key === 'Escape') { setDraft(value); setEditing(false) }
      },
      className: `w-full bg-blue-50 border border-blue-300 rounded px-2 py-1 text-sm
        text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none ${className}`,
    }
    return multiline
      ? <textarea {...shared} rows={3} />
      : <input {...shared} type="text" />
  }

  return (
    <span
      onClick={() => { setDraft(value); setEditing(true) }}
      title="Click to edit"
      className={`cursor-text hover:bg-blue-50 hover:outline hover:outline-1
        hover:outline-blue-200 rounded px-1 -mx-1 transition-colors ${className}`}
    >
      {value}
    </span>
  )
}

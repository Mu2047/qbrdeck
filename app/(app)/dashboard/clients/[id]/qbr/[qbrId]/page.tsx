'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, FileText, Check, Loader2, Share2, Copy, Mail } from 'lucide-react'

type SaveState = 'idle' | 'saving' | 'saved'

export default function QBRPage({ params }: { params: { id: string; qbrId: string } }) {
  const [qbr, setQbr]           = useState<any>(null)
  const [slides, setSlides]     = useState<any[]>([])
  const [exporting, setExporting] = useState<'pdf' | 'pptx' | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const saveTimer                 = useRef<NodeJS.Timeout>()
  const [sharing, setSharing]     = useState(false)
  const [copied, setCopied]       = useState(false)
  const [shareUrl, setShareUrl]   = useState<string | null>(null)
  const [sending, setSending]     = useState(false)
  const [sent, setSent]           = useState(false)
  const [sendEmail, setSendEmail] = useState('')
  const [showEmailInput, setShowEmailInput] = useState(false)
  useEffect(() => {
    fetch(`/api/qbrs/${params.qbrId}`)
      .then(r => r.json())
      .then(data => { setQbr(data); setSlides(data.slides ?? []) })
  }, [params.qbrId])

  // ── Save to DB ────────────────────────────────────────────────────────────
  async function saveSlides(updated: any[]) {
    setSaveState('saving')
    clearTimeout(saveTimer.current)
    await fetch(`/api/qbrs/${params.qbrId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slides: updated }),
    })
    setSaveState('saved')
    saveTimer.current = setTimeout(() => setSaveState('idle'), 2000)
  }

  // ── Slide field updaters ──────────────────────────────────────────────────
  function updateContent(slideIdx: number, value: string) {
    const updated = slides.map((s, i) => i === slideIdx ? { ...s, content: value } : s)
    setSlides(updated)
    saveSlides(updated)
  }

  function updateBullet(slideIdx: number, bulletIdx: number, value: string) {
    const updated = slides.map((s, i) => {
      if (i !== slideIdx) return s
      const bullets = s.bullets.map((b: string, j: number) => j === bulletIdx ? value : b)
      return { ...s, bullets }
    })
    setSlides(updated)
    saveSlides(updated)
  }

  function updateMetric(slideIdx: number, metricIdx: number, field: string, value: string) {
    const updated = slides.map((s, i) => {
      if (i !== slideIdx) return s
      const metrics = s.metrics.map((m: any, j: number) =>
        j === metricIdx ? { ...m, [field]: value } : m
      )
      return { ...s, metrics }
    })
    setSlides(updated)
    saveSlides(updated)
  }

  // ── Export ────────────────────────────────────────────────────────────────
 async function sendToClient() {
    if (!sendEmail) return
    setSending(true)
    await fetch(`/api/qbrs/${params.qbrId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: sendEmail }),
    })
    setSending(false)
    setSent(true)
    setShowEmailInput(false)
    setTimeout(() => setSent(false), 3000)
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

      {/* ── Export bar ── */}
      <div className="card p-4 mb-6 flex items-center justify-between">
        <p className="text-sm text-gray-600">Export this QBR to share with your client.</p>
        <div className="flex gap-3">
          <button onClick={() => setShowEmailInput(v => !v)} className="btn-secondary text-sm py-2">
            {sent ? <><Check size={14} className="text-green-500" /> Sent!</> : <><Mail size={14} /> Send to Client</>}
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

      {/* ── Email input ── */}
      {showEmailInput && (
        <div className="card p-4 mb-4 flex items-center gap-3">
          <Mail size={16} className="text-gray-400 flex-shrink-0" />
          <input
            type="email"
            placeholder="Client email address"
            value={sendEmail}
            onChange={e => setSendEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendToClient()}
            className="flex-1 text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy-800"
          />
          <button
            onClick={sendToClient}
            disabled={sending || !sendEmail}
            className="btn-primary text-sm py-2 px-4"
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      )}

      {/* ── Edit hint ── */}
      <p className="text-xs text-gray-400 mb-4 italic">
        Click any text to edit. Changes save automatically.
      </p>

      {/* ── Slides ── */}
      {slides.map((slide: any, i: number) => (
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
                {slide.metrics.map((m: any, j: number) => (
                  <div key={j} className={`rounded-lg p-3.5 border ${
                    m.status === 'good'    ? 'bg-green-50 border-green-200' :
                    m.status === 'caution' ? 'bg-amber-50 border-amber-200' :
                                            'bg-red-50 border-red-200'}`}>
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
                    {/* Status dropdown */}
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
                  </div>
                ))}
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
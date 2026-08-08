'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, FileText, Check, Loader2, Share2, Copy, Mail } from 'lucide-react'
import { healthCardLabel, isHealthScoreMetric, statusToColor, type HealthStatus } from '@/lib/health-score'
import { requestJson, type ApiResult } from '@/lib/api-client'
import { SerializedLatestQueue } from '@/lib/serialized-latest-queue'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

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

const SAVE_FAILURE_MESSAGE = 'Your latest changes were not saved. Please retry.'

const SHARE_API_FAILURE_MESSAGE = 'Unable to create the share link. Please try again.'
const SHARE_CLIPBOARD_FAILURE_MESSAGE =
  'The share link was created, but it could not be copied. Please copy it manually.'

// Runtime guard for the share token: requestJson<{ token: string }>() only
// guarantees the *shape* at compile time — a 2xx response can still carry a
// missing/blank/literal-"undefined" token if the server (or a future bug)
// sends one, and that must never reach `/portal/${token}` or the clipboard.
function isValidShareToken(token: unknown): token is string {
  if (typeof token !== 'string') return false
  const trimmed = token.trim()
  return trimmed.length > 0 && trimmed !== 'undefined' && trimmed !== 'null'
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
  const [saveError, setSaveError] = useState<string | null>(null)
  const saveTimer                 = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Serializes every autosave PATCH so requests execute strictly in the
  // order the edits were queued and never overlap — an older request can
  // therefore never finish after a newer one and overwrite it. Each
  // enqueue() is stamped with a version; only the caller holding the latest
  // version may set the final visible saveState (see enqueueSaveBody()).
  const saveQueueRef              = useRef(new SerializedLatestQueue<ApiResult<unknown>>())
  // Authoritative concurrency guard for Retry save: a ref (not just
  // retryingSave/saveState) because rapid double-clicks can both observe a
  // stale, pre-re-render state and slip past a state-only guard — same
  // reasoning as shareCopyInFlight below.
  const retrySaveInFlight         = useRef(false)
  const [retryingSave, setRetryingSave] = useState(false)
  const sendConfirmationTimer     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copiedTimer               = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Authoritative concurrency guard for clipboard copies: a ref (not just
  // React state) because it must be readable/settable synchronously, before
  // the next render, to reject an overlapping copy the instant it starts —
  // state is closure-based and only updates after rendering.
  const shareCopyInFlight         = useRef(false)
  const [sharing, setSharing]     = useState(false)
  const [copyingShareUrl, setCopyingShareUrl] = useState(false)
  const [copied, setCopied]       = useState(false)
  const [shareUrl, setShareUrl]   = useState<string | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)
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

  // Clear any pending "Copied!" auto-reset timer on unmount, same reasoning
  // as the send confirmation timer above — kept as its own effect (rather
  // than merged into it) so each timer's cleanup is independently testable.
  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    }
  }, [])

  // Clear any pending "Saved" -> "idle" auto-reset timer on unmount, same
  // reasoning as the timers above.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  // ── Save to DB ────────────────────────────────────────────────────────────
  // Always PATCHes rawSlides (never resolvedSlides), so every untouched
  // field's raw {{...}} placeholders are preserved exactly as stored.
  //
  // enqueueSaveBody() is the single place that owns the save-state decision
  // logic — used by every save attempt, fresh edit or Retry, via
  // saveSlides() — so there is exactly one decision path, never a parallel
  // one. Every attempt is enqueued on saveQueueRef, so attempts never
  // overlap — attempt N+1 cannot start until attempt N has fully settled —
  // and only the *latest* enqueued attempt (per saveQueueRef.current
  // .isLatest) is allowed to set the final visible saveState. A slower
  // older attempt that settles (or rejects) after a newer edit was queued
  // therefore can never flash a stale "Saved", clear a newer error, or
  // overwrite what the newer edit wrote. Crucially this holds even when the
  // older attempt's task actually reached the network and the newer
  // attempt's did not (e.g. the newer attempt failed to serialize) — the
  // queue task itself is what decides whether to call requestJson, so every
  // attempt claims a version before enqueueSaveBody ever awaits it. No save
  // attempt bypasses this version/isLatest ownership model.
  async function enqueueSaveBody(task: () => Promise<ApiResult<unknown>>): Promise<void> {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    setSaveError(null)
    setSaveState('saving')

    const { version, settled } = saveQueueRef.current.enqueue(task)

    let result: ApiResult<unknown>
    try {
      result = await settled
    } catch {
      // The queue's task rejected (e.g. a future requestJson/queue
      // regression) — never let that leave the UI stuck on "Saving...", and
      // never let a superseded rejection overwrite newer work.
      if (!saveQueueRef.current.isLatest(version)) return
      setSaveState('error')
      setSaveError(SAVE_FAILURE_MESSAGE)
      return
    }

    // A newer save was queued while this one was in flight — that newer
    // call owns the final visible state; this one's outcome is discarded.
    if (!saveQueueRef.current.isLatest(version)) return

    if (result.ok) {
      setSaveState('saved')
      saveTimer.current = setTimeout(() => {
        if (saveQueueRef.current.isLatest(version)) setSaveState('idle')
        saveTimer.current = null
      }, 2000)
    } else {
      setSaveState('error')
      setSaveError(SAVE_FAILURE_MESSAGE)
    }
  }

  // Serializes nextRawSlides synchronously, before this snapshot can ever be
  // touched by a later edit — then enqueues exactly one queue task
  // regardless of whether serialization succeeded. A serialization failure
  // (e.g. a future updater that accidentally introduces a circular
  // reference) is therefore never invisible to the queue: it still claims a
  // version via saveQueueRef.current.enqueue() inside enqueueSaveBody(), so
  // it can still invalidate an older in-flight attempt and can still be
  // invalidated by a newer one — exactly like a normal PATCH failure, never
  // a bypass of the version/isLatest ownership model. The queue task never
  // throws and never reaches the network layer when serialization failed;
  // it resolves a safe local ApiFailure instead, so the real serialization
  // exception is never exposed.
  async function saveSlides(nextRawSlides: any[]) {
    let requestBody: string | null
    try {
      requestBody = JSON.stringify({ slides: nextRawSlides })
    } catch {
      requestBody = null
    }
    const body = requestBody

    await enqueueSaveBody(() => {
      if (body === null) {
        return Promise.resolve<ApiResult<unknown>>({
          ok: false,
          status: null,
          error: SAVE_FAILURE_MESSAGE,
        })
      }
      return requestJson<unknown>(`/api/qbrs/${params.qbrId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
    })
  }

  // Retries by re-running the identical serialize → enqueue → version →
  // result flow as any other edit, against the CURRENT rawSlides — never a
  // cached body that could belong to an older edit. There is only one
  // source of truth for what Retry sends: the rawSlides state visible on
  // screen right now. Never automatic (only fired by the user clicking
  // Retry save), and guarded by a ref (not just saveState/retryingSave) so
  // a rapid double-click can never enqueue the same retry twice.
  async function retrySave() {
    if (retrySaveInFlight.current) return
    retrySaveInFlight.current = true
    setRetryingSave(true)
    try {
      await saveSlides(rawSlides)
    } finally {
      retrySaveInFlight.current = false
      setRetryingSave(false)
    }
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

  type PriorityCategory = 'critical' | 'important' | 'strategic'

  function updatePriority(slideIdx: number, category: PriorityCategory, itemIdx: number, value: string) {
    const nextRaw = rawSlides.map((s, i) => {
      if (i !== slideIdx) return s
      const items = s.priorities[category].map((item: string, k: number) => k === itemIdx ? value : item)
      return { ...s, priorities: { ...s.priorities, [category]: items } }
    })
    const nextResolved = resolvedSlides.map((s, i) => {
      if (i !== slideIdx) return s
      const items = s.priorities[category].map((item: string, k: number) => k === itemIdx ? value : item)
      return { ...s, priorities: { ...s.priorities, [category]: items } }
    })
    setRawSlides(nextRaw)
    setResolvedSlides(nextResolved)
    saveSlides(nextRaw)
  }

  type RecommendationField = 'title' | 'why' | 'risk' | 'benefit'

  function updateRecommendation(slideIdx: number, recIdx: number, field: RecommendationField, value: string) {
    const nextRaw = rawSlides.map((s, i) => {
      if (i !== slideIdx) return s
      const recommendations = s.recommendations.map((r: any, j: number) =>
        j === recIdx ? { ...r, [field]: value } : r
      )
      return { ...s, recommendations }
    })
    const nextResolved = resolvedSlides.map((s, i) => {
      if (i !== slideIdx) return s
      const recommendations = s.recommendations.map((r: any, j: number) =>
        j === recIdx ? { ...r, [field]: value } : r
      )
      return { ...s, recommendations }
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

  // Attempts to copy an already-validated portal URL to the clipboard.
  // Shared by shareQBR() (fresh token) and retryCopyShareUrl() (reusing a
  // previously validated shareUrl) so a clipboard-only retry never re-calls
  // the share API for a new token.
  async function copyShareUrl(url: string) {
    if (shareCopyInFlight.current) return
    shareCopyInFlight.current = true
    setCopyingShareUrl(true)
    if (copiedTimer.current) {
      clearTimeout(copiedTimer.current)
      copiedTimer.current = null
    }
    setCopied(false)
    setShareError(null)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      copiedTimer.current = setTimeout(() => {
        setCopied(false)
        copiedTimer.current = null
      }, 3000)
    } catch {
      setShareError(SHARE_CLIPBOARD_FAILURE_MESSAGE)
    } finally {
      shareCopyInFlight.current = false
      setCopyingShareUrl(false)
    }
  }

  async function shareQBR() {
    if (sharing || shareCopyInFlight.current) return
    setShareError(null)
    setSharing(true)
    try {
      const result = await requestJson<{ token: string }>(`/api/qbrs/${params.qbrId}/share`, {
        method: 'POST',
      })
      if (!result.ok || !isValidShareToken(result.data?.token)) {
        setShareError(SHARE_API_FAILURE_MESSAGE)
        return
      }
      const url = `${window.location.origin}/portal/${result.data.token.trim()}`
      setShareUrl(url)
      await copyShareUrl(url)
    } finally {
      setSharing(false)
    }
  }

  // Reuses the already-validated shareUrl — never requests a new token just
  // to retry a failed clipboard copy.
  async function retryCopyShareUrl() {
    if (!shareUrl || sharing || shareCopyInFlight.current) return
    await copyShareUrl(shareUrl)
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

        {/* Save indicator — only mounted while there's something to
            announce, so the role="status" region is never permanently
            present but empty. */}
        {(saveState === 'saving' || saveState === 'saved') && (
          <div
            role="status"
            aria-live="polite"
            aria-busy={saveState === 'saving'}
            className="text-xs text-gray-400 flex items-center gap-1.5 h-5"
          >
            {saveState === 'saving' && <><Loader2 size={12} className="animate-spin" aria-hidden="true" /> Saving...</>}
            {saveState === 'saved'  && <><Check size={12} className="text-green-500" aria-hidden="true" /> Saved</>}
          </div>
        )}
      </div>

      {/* ── Autosave failure — a save attempt (including one that failed to
          serialize) never rolls back the visible edit or claims it was
          persisted; the edited content stays exactly as the user left it.
          Retry save re-runs the same serialize → enqueue → version → result
          flow against the CURRENT rawSlides, never a cached body that could
          belong to an older edit — so Retry always targets the edit
          actually on screen, genuinely retryable even after a serialization
          failure. Mounted while there's a failure to announce OR a retry is
          in flight, so the Retry button stays visible (and observably
          disabled/busy) through the whole retry attempt instead of
          disappearing the instant it's clicked — saveError itself is
          cleared as soon as the retry starts. role="alert" wraps only the
          actual failure text, never an empty region. ── */}
      {(saveError || retryingSave) && (
        <div className="text-xs text-red-600 mb-2 flex items-center gap-2">
          {saveError && <span role="alert">{saveError}</span>}
          <button
            onClick={retrySave}
            disabled={retryingSave || saveState === 'saving'}
            aria-busy={retryingSave}
            aria-label="Retry save"
            className="underline"
          >
            {retryingSave ? 'Retrying...' : 'Retry save'}
          </button>
        </div>
      )}

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
          <button
            onClick={shareQBR}
            disabled={sharing || copyingShareUrl}
            aria-busy={sharing || copyingShareUrl}
            aria-label="Share Link"
            className="btn-secondary text-sm py-2"
          >
            {sharing
              ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              : copied
              ? <><Check size={14} className="text-green-500" aria-hidden="true" /> Copied!</>
              : <><Share2 size={14} aria-hidden="true" /> Share Link</>}
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

      {/* ── Share status — same accessible pattern as Send status: only
          mounted while there's something to announce. ── */}
      {(sharing || copyingShareUrl || copied) && (
        <div role="status" aria-live="polite" className="text-xs text-gray-500 h-4 mb-1 flex items-center gap-1.5">
          {sharing && <><Loader2 size={12} className="animate-spin" aria-hidden="true" /> Creating share link...</>}
          {!sharing && copyingShareUrl && <><Loader2 size={12} className="animate-spin" aria-hidden="true" /> Copying share link...</>}
          {!sharing && !copyingShareUrl && copied && <><Check size={12} className="text-green-500" aria-hidden="true" /> Copied!</>}
        </div>
      )}

      {/* ── Share failure — covers both an invalid/failed API result and a
          failed clipboard write; the two are distinguished by message text
          (see SHARE_API_FAILURE_MESSAGE / SHARE_CLIPBOARD_FAILURE_MESSAGE). ── */}
      {shareError && (
        <p role="alert" className="text-xs text-red-600 mb-2">{shareError}</p>
      )}

      {/* ── Manual share-link fallback — shown whenever a token has been
          validated, so the link survives a clipboard failure (and stays
          available afterward for a manual copy) without ever requesting a
          new token just to retry the copy. ── */}
      {shareUrl && (
        <div className="card p-4 mb-4 flex items-center gap-3">
          <input
            type="text"
            readOnly
            aria-label="Share link URL"
            value={shareUrl}
            onFocus={e => e.target.select()}
            className="flex-1 text-sm border border-gray-200 rounded px-3 py-2 bg-gray-50 text-gray-700"
          />
          <button
            onClick={retryCopyShareUrl}
            disabled={sharing || copyingShareUrl}
            aria-busy={copyingShareUrl}
            aria-label="Copy share link to clipboard"
            className="btn-secondary text-sm py-2 px-4"
          >
            <Copy size={14} aria-hidden="true" /> Copy
          </button>
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
                      {/* Health-score card: label is also deterministic/read-only,
                          same reasoning as the status below — it must always match
                          qbr.healthScore/healthStatus, never an independently
                          editable copy that could drift from the authoritative
                          value shown on the cover card above. Non-health cards
                          keep their existing editable label. */}
                      {healthClasses ? (
                        <p className="text-xs text-gray-500 mb-1">{m.label}</p>
                      ) : (
                        <EditableText
                          value={m.label}
                          onSave={val => updateMetric(i, j, 'label', val)}
                          className="text-xs text-gray-500 mb-1 block"
                        />
                      )}
                      {/* Metric value is read-only for every card, health and
                          non-health alike — it is presentation copy of data
                          sourced from qbr fields (ticket counts, uptime, etc.)
                          or the health score, and editing only this display
                          string would let it silently diverge from the
                          authoritative source without changing anything it is
                          meant to represent. */}
                      <p className="text-xl font-bold text-navy-800 mb-1">{m.value}</p>
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

            {/* Roadmap — item text is editable; column labels, structure,
                ordering, and item count are unchanged from the read-only
                presentation ported from components/qbr/SlideBody.tsx / the
                public portal. */}
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
                        <li key={k} className="text-xs leading-snug flex items-start gap-1">
                          <span className="flex-shrink-0">—</span>
                          <EditableText
                            value={item}
                            onSave={val => updatePriority(i, col.key as PriorityCategory, k, val)}
                            className="text-xs leading-snug flex-1"
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {/* Recommendations — title/why/risk/benefit values are editable;
                the numbering prefix and "Why it matters:"/"Risk if
                ignored:"/"Expected benefit:" labels stay fixed, unchanged
                from the read-only presentation ported from
                components/qbr/SlideBody.tsx / the public portal. */}
            {slide.recommendations && (
              <div className="space-y-4">
                {slide.recommendations.map((rec: any, j: number) => (
                  <div key={j} className="border border-gray-100 rounded-lg p-4">
                    <p className="text-sm font-semibold text-[#0a1634] mb-2">
                      {j + 1}. <EditableText
                        value={rec.title}
                        onSave={val => updateRecommendation(i, j, 'title', val)}
                        className="text-sm font-semibold text-[#0a1634]"
                      />
                    </p>
                    <div className="space-y-1 text-xs text-gray-600">
                      <p><span className="font-medium text-gray-700">Why it matters:</span> <EditableText value={rec.why} onSave={val => updateRecommendation(i, j, 'why', val)} className="text-xs text-gray-600" /></p>
                      <p><span className="font-medium text-gray-700">Risk if ignored:</span> <EditableText value={rec.risk} onSave={val => updateRecommendation(i, j, 'risk', val)} className="text-xs text-gray-600" /></p>
                      <p><span className="font-medium text-gray-700">Expected benefit:</span> <EditableText value={rec.benefit} onSave={val => updateRecommendation(i, j, 'benefit', val)} className="text-xs text-gray-600" /></p>
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

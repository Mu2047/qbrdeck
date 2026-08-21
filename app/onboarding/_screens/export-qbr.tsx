'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Extracts a filename from a Content-Disposition header, falling back to a
// generic name if the header is missing/malformed — never blocks the
// download itself on a parsing failure.
function filenameFromContentDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback
  const match = header.match(/filename="([^"]+)"/)
  return match?.[1] ?? fallback
}

export function ExportQbrScreen() {
  const router = useRouter()
  const [exporting, setExporting] = useState<'pdf' | 'pptx' | null>(null)
  const [exported, setExported] = useState(false)
  const [limitReached, setLimitReached] = useState(false)
  const [error, setError] = useState('')
  const [continuing, setContinuing] = useState(false)
  const [skipping, setSkipping] = useState(false)

  async function doExport(format: 'pdf' | 'pptx') {
    if (exporting || continuing || skipping) return
    setExporting(format)
    setError('')
    setLimitReached(false)
    try {
      const res = await fetch('/api/onboarding/export', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ format }),
      })
      if (!res.ok) {
        const data = await res.json()
        if (data.error === 'LIMIT_REACHED') {
          setLimitReached(true)
        } else {
          setError(typeof data.error === 'string' ? data.error : 'Export failed. Please try again.')
        }
        return
      }
      const blob = await res.blob()
      const filename = filenameFromContentDisposition(
        res.headers.get('Content-Disposition'),
        `QBR.${format}`
      )
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      setExported(true)
    } catch {
      setError('Export failed. Please try again.')
    } finally {
      setExporting(null)
    }
  }

  async function handleContinue() {
    if (continuing) return
    setContinuing(true)
    setError('')
    try {
      const res = await fetch('/api/onboarding/advance', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ toStep: 'SHARE_QBR' }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to continue')
      }
      router.push('/onboarding/share-qbr')
    } catch (e: any) {
      setError(e.message)
      setContinuing(false)
    }
  }

  async function handleSkip() {
    if (skipping) return
    setSkipping(true)
    setError('')
    try {
      const res = await fetch('/api/onboarding/skip', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ step: 'EXPORT_QBR' }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to skip')
      }
      router.push('/onboarding/share-qbr')
    } catch (e: any) {
      setError(e.message)
      setSkipping(false)
    }
  }

  const busy = exporting !== null || continuing || skipping

  return (
    <div className="card p-8">
      <p className="text-xs font-medium text-gray-400 mb-3">Step 6 of 8</p>
      <h1 className="text-2xl font-bold text-navy-800 mb-2">Export your QBR</h1>
      <p className="text-gray-500 text-sm mb-6">Download a polished PDF or PowerPoint version to share with your client. You can always do this later.</p>

      {limitReached && (
        <p className="text-amber-600 text-sm mb-4">
          You&apos;ve reached your monthly export package limit. You can skip this for now and export later once your limit resets or your plan is upgraded.
        </p>
      )}
      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
      {exported && !limitReached && (
        <p className="text-green-600 text-sm mb-4">Export complete — your download should have started.</p>
      )}

      <div className="flex gap-3 mb-6">
        <button
          onClick={() => doExport('pdf')}
          disabled={busy}
          className="btn-secondary flex-1 py-3 text-sm"
        >
          {exporting === 'pdf' ? 'Exporting...' : 'Export PDF'}
        </button>
        <button
          onClick={() => doExport('pptx')}
          disabled={busy}
          className="btn-secondary flex-1 py-3 text-sm"
        >
          {exporting === 'pptx' ? 'Exporting...' : 'Export PowerPoint'}
        </button>
      </div>

      <div className="flex gap-3">
        {exported && (
          <button
            onClick={handleContinue}
            disabled={busy}
            className="btn-primary flex-1 py-3 text-sm"
          >
            {continuing ? 'Continuing...' : 'Continue'}
          </button>
        )}
        <button
          onClick={handleSkip}
          disabled={busy}
          className={exported ? 'btn-secondary flex-1 py-3 text-sm' : 'btn-primary w-full py-3 text-sm'}
        >
          {skipping ? 'Skipping...' : 'Skip for now'}
        </button>
      </div>
    </div>
  )
}

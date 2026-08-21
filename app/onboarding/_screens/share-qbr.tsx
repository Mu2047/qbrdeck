'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Props = {
  // Convenience prefill only, from the anchored Client's contactEmail — the
  // user must still explicitly click Send; nothing is ever sent
  // automatically, and an absent contactEmail never blocks this screen.
  prefillEmail: string | null
}

export function ShareQbrScreen({ prefillEmail }: Props) {
  const router = useRouter()
  const [copying, setCopying] = useState(false)
  const [copied, setCopied] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [showEmailInput, setShowEmailInput] = useState(false)
  const [email, setEmail] = useState(prefillEmail ?? '')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [continuing, setContinuing] = useState(false)
  const [skipping, setSkipping] = useState(false)

  const succeeded = copied || sent
  const busy = copying || sending || continuing || skipping

  async function copyLink() {
    if (busy) return
    setCopying(true)
    setError('')
    try {
      const res = await fetch('/api/onboarding/share', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'link' }),
      })
      const data = await res.json()
      if (!res.ok || typeof data.token !== 'string') {
        throw new Error(typeof data.error === 'string' ? data.error : 'Could not create a share link')
      }
      const url = `${window.location.origin}/portal/${data.token}`
      setShareUrl(url)
      try {
        await navigator.clipboard.writeText(url)
        setCopied(true)
      } catch {
        // Link was created but clipboard write failed — still show it below
        // so the user can copy manually, without treating this as a
        // failure of the share action itself.
        setCopied(true)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setCopying(false)
    }
  }

  async function sendEmail() {
    if (busy || !email.trim()) return
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/onboarding/share', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'email', email: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Could not send the email')
      }
      setSent(true)
      setShowEmailInput(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  async function handleContinue() {
    if (busy) return
    setContinuing(true)
    setError('')
    try {
      const res = await fetch('/api/onboarding/advance', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ toStep: 'COMPLETE' }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to continue')
      }
      router.push('/onboarding/complete')
    } catch (e: any) {
      setError(e.message)
      setContinuing(false)
    }
  }

  async function handleSkip() {
    if (busy) return
    setSkipping(true)
    setError('')
    try {
      const res = await fetch('/api/onboarding/skip', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ step: 'SHARE_QBR' }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to skip')
      }
      router.push('/onboarding/complete')
    } catch (e: any) {
      setError(e.message)
      setSkipping(false)
    }
  }

  return (
    <div className="card p-8">
      <p className="text-xs font-medium text-gray-400 mb-3">Step 7 of 8</p>
      <h1 className="text-2xl font-bold text-navy-800 mb-2">Share with your client</h1>
      <p className="text-gray-500 text-sm mb-6">Optional — you can always share this QBR later from your dashboard.</p>

      <div className="space-y-4 mb-6">
        <button
          onClick={copyLink}
          disabled={busy}
          className="btn-secondary w-full py-3 text-sm"
        >
          {copying ? 'Creating link...' : copied ? 'Copied!' : 'Copy secure client link'}
        </button>

        {shareUrl && (
          <input
            type="text"
            readOnly
            aria-label="Share link URL"
            value={shareUrl}
            onFocus={e => e.target.select()}
            className="w-full text-sm border border-gray-200 rounded px-3 py-2 bg-gray-50 text-gray-700"
          />
        )}

        {!showEmailInput && !sent && (
          <button
            onClick={() => setShowEmailInput(true)}
            disabled={busy}
            className="btn-secondary w-full py-3 text-sm"
          >
            Send by email
          </button>
        )}

        {showEmailInput && (
          <div className="flex items-center gap-3">
            <input
              type="email"
              placeholder="Client email address"
              aria-label="Client email address"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="flex-1 text-sm border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy-800"
            />
            <button
              onClick={sendEmail}
              disabled={busy || !email.trim()}
              className="btn-primary text-sm py-2 px-4"
            >
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        )}

        {sent && <p className="text-green-600 text-sm">Sent to client!</p>}
      </div>

      {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

      <div className="flex gap-3">
        {succeeded && (
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
          className={succeeded ? 'btn-secondary flex-1 py-3 text-sm' : 'btn-primary w-full py-3 text-sm'}
        >
          {skipping ? 'Skipping...' : 'Skip for now'}
        </button>
      </div>
    </div>
  )
}

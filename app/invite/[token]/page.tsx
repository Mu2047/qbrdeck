'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser, SignInButton } from '@clerk/nextjs'

// NOTE (infra token exposure): the raw invite token lives in this page's own
// URL (/invite/[token]) because that's how the emailed link identifies the
// invitation. Application code below never logs it. That does NOT mean the
// raw token is never logged anywhere: hosting/CDN/edge access logs capture
// the request path for every request, token included, by nature of how HTTP
// access logging works — outside this app's control. Do not claim "the raw
// token is never logged" without that caveat. Moving the secret out of the
// request path (e.g. a one-time exchange code) is a separate hardening task,
// not in scope here.
export default function AcceptInvitePage({ params }: { params: { token: string } }) {
  const { user, isLoaded } = useUser()
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'accepting' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')

  // Guards against firing a second acceptance POST from the same mount.
  // useUser()'s `user` reference can change across re-renders (session
  // refresh, store updates) without the signed-in identity itself changing,
  // which would otherwise re-run the effect below and double-POST. This is
  // a client-side UX guard only — app/api/workspace/invite/accept/route.ts's
  // conditional PENDING -> ACCEPTED update is the actual replay protection
  // and stays authoritative regardless of this ref. A real reload (fresh
  // mount) resets it, so a genuine retry after a real failure still works.
  const hasRequestedAccept = useRef(false)

  useEffect(() => {
    if (!isLoaded) return
    if (!user) { setStatus('loading'); return }
    if (hasRequestedAccept.current) return
    hasRequestedAccept.current = true
    setStatus('accepting')

    fetch('/api/workspace/invite/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: params.token }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          setStatus('error')
          setMessage(data.error)
        } else {
          setStatus('success')
          setTimeout(() => router.push('/dashboard'), 2000)
        }
      })
      .catch(() => {
        setStatus('error')
        setMessage('Something went wrong. Please try again.')
      })
  }, [isLoaded, user, params.token])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-8">
      <div className="card p-8 max-w-md w-full text-center">
        <div className="w-12 h-12 rounded-xl bg-navy-800 flex items-center justify-center mx-auto mb-4">
          <span className="text-gold-300 font-bold text-lg">Q</span>
        </div>

        {!isLoaded || status === 'loading' ? (
          <>
            <h1 className="text-xl font-bold text-navy-800 mb-2">Checking invitation...</h1>
            <p className="text-gray-500 text-sm">
              {!user ? 'Please sign in to accept this invitation.' : 'Verifying your invitation...'}
            </p>
            {isLoaded && !user && (
              <div className="mt-6">
                {/* forceRedirectUrl (not fallbackRedirectUrl) is required here:
                    fallbackRedirectUrl only applies when no other redirect prop,
                    env var, or search param is present, and this app sets
                    NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard globally — that
                    env var would otherwise win and strand the invite token. */}
                <SignInButton
                  mode="modal"
                  forceRedirectUrl={`/invite/${params.token}`}
                  signUpForceRedirectUrl={`/invite/${params.token}`}
                >
                  <button className="btn-primary w-full py-3">Sign in to accept</button>
                </SignInButton>
              </div>
            )}
          </>
        ) : status === 'accepting' ? (
          <>
            <h1 className="text-xl font-bold text-navy-800 mb-2">Accepting invitation...</h1>
            <p className="text-gray-500 text-sm">Just a moment.</p>
          </>
        ) : status === 'success' ? (
          <>
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <span className="text-green-600 text-xl">✓</span>
            </div>
            <h1 className="text-xl font-bold text-navy-800 mb-2">You're in!</h1>
            <p className="text-gray-500 text-sm">Invitation accepted. Redirecting to your dashboard...</p>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <span className="text-red-600 text-xl">✕</span>
            </div>
            <h1 className="text-xl font-bold text-navy-800 mb-2">Invitation error</h1>
            <p className="text-gray-500 text-sm mb-6">{message}</p>
            <a href="/dashboard" className="btn-primary w-full py-3 block">Go to dashboard</a>
          </>
        )}
      </div>
    </div>
  )
}
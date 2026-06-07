'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser, SignInButton } from '@clerk/nextjs'

export default function AcceptInvitePage({ params }: { params: { token: string } }) {
  const { user, isLoaded } = useUser()
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'accepting' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!isLoaded) return
    if (!user) { setStatus('loading'); return }
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
                <SignInButton mode="modal">
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
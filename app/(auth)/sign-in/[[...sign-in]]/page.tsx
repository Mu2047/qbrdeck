'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

function getSafeRedirect(raw: string | null) {
  if (!raw) return '/dashboard'

  if (raw.startsWith('/') && !raw.startsWith('//')) {
    return raw
  }

  try {
    const url = new URL(raw)
    if (url.origin === 'https://qbrdeck.misecuretechsolutions.com') {
      return `${url.pathname}${url.search}${url.hash}`
    }
  } catch {
    // ignore invalid URL
  }

  return '/dashboard'
}

export default function SignInPage() {
  const searchParams = useSearchParams()
  const redirectUrl = getSafeRedirect(searchParams.get('redirect_url'))

  return (
    <main className="relative z-50 min-h-screen flex items-center justify-center bg-gray-50 px-6 pointer-events-auto">
      <div className="relative z-50 w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm text-center pointer-events-auto">
        <h1 className="text-2xl font-bold text-slate-950">Sign in to QBR Deck</h1>

        <p className="mt-3 text-sm text-slate-600">
          If you already completed sign-in, continue to your dashboard.
        </p>

        <a
          href={redirectUrl}
          className="mt-6 block w-full rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Continue to dashboard
        </a>

        <a
          href="/"
          className="mt-3 block w-full rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50"
        >
          Return to homepage to sign in
        </a>

        <p className="mt-6 text-sm text-slate-600">
          New to QBR Deck?{' '}
          <Link href="/sign-up" className="font-semibold text-slate-950 underline">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  )
}
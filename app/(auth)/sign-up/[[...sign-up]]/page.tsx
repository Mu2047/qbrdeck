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

export default function SignUpPage() {
  const searchParams = useSearchParams()
  const redirectUrl = getSafeRedirect(searchParams.get('redirect_url'))

  return (
    <main className="relative z-50 min-h-screen flex items-center justify-center bg-gray-50 px-6 pointer-events-auto">
      <div className="relative z-50 w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm text-center pointer-events-auto">
        <h1 className="text-2xl font-bold text-slate-950">Create your QBR Deck account</h1>

        <p className="mt-3 text-sm text-slate-600">
          Start with the Free plan and generate professional QBRs for your clients.
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
          Return to homepage to create account
        </a>

        <p className="mt-6 text-sm text-slate-600">
          Already have an account?{' '}
          <Link href="/sign-in" className="font-semibold text-slate-950 underline">
            Sign in
          </Link>
        </p>

        <p className="mt-4 text-xs text-slate-400">
          If you already created your account, click Continue to dashboard.
        </p>
      </div>
    </main>
  )
}
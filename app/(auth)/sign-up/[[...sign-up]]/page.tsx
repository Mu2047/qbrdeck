'use client'

import { SignUpButton } from '@clerk/nextjs'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

function getSafeRedirect(raw: string | null) {
  if (!raw) return '/dashboard'
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw
  try {
    const url = new URL(raw)
    if (url.origin === 'https://qbrdeck.misecuretechsolutions.com') {
      return `${url.pathname}${url.search}${url.hash}`
    }
  } catch {}
  return '/dashboard'
}

export default function SignUpPage() {
  const searchParams = useSearchParams()
  const redirectUrl = getSafeRedirect(searchParams.get('redirect_url'))

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
      <div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm text-center">
        <h1 className="text-2xl font-bold text-slate-950">Create your QBR Deck account</h1>
        <p className="mt-3 text-sm text-slate-600">
          Start with the Free plan and generate professional QBRs for your clients.
        </p>

        <div className="mt-6">
          <SignUpButton mode="modal">
            <button className="w-full rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800">
              Get started free
            </button>
          </SignUpButton>
        </div>

        <Link
          href={redirectUrl}
          className="mt-3 block w-full rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-50"
        >
          Continue to dashboard
        </Link>

        <p className="mt-6 text-sm text-slate-600">
          Already have an account?{' '}
          <Link href="/sign-in" className="font-semibold text-slate-950 underline">
            Sign in
          </Link>
        </p>

        <p className="mt-4 text-xs text-slate-400">
          After signing up, click Continue to dashboard.
        </p>
      </div>
    </main>
  )
}
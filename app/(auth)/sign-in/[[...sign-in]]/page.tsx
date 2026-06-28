'use client'

import { SignInButton } from '@clerk/nextjs'
import Link from 'next/link'

export default function SignInPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
      <div className="w-full max-w-md rounded-2xl border bg-white p-8 shadow-sm text-center">
        <h1 className="text-2xl font-bold text-slate-950">Sign in to QBR Deck</h1>
        <p className="mt-3 text-sm text-slate-600">
          Continue to your workspace to manage clients, QBRs, exports, and billing.
        </p>

        <div className="mt-6">
          <SignInButton mode="modal">
            <button className="w-full rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800">
              Sign in
            </button>
          </SignInButton>
        </div>

        <p className="mt-6 text-sm text-slate-600">
          New to QBR Deck?{' '}
          <Link href="/sign-up" className="font-semibold text-slate-950 underline">
            Create an account
          </Link>
        </p>

        <p className="mt-4 text-xs text-slate-400">
          If the sign-in window does not open, return to the homepage and use Get started free.
        </p>
      </div>
    </main>
  )
}
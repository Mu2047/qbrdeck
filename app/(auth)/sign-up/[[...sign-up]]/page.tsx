'use client'

import { SignUpButton } from '@clerk/nextjs'
import Link from 'next/link'

export default function SignUpPage() {
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

        <p className="mt-6 text-sm text-slate-600">
          Already have an account?{' '}
          <Link href="/sign-in" className="font-semibold text-slate-950 underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  )
}
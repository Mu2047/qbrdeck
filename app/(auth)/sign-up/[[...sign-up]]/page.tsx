'use client'

import Link from 'next/link'
import { SignUp } from '@clerk/nextjs'

export default function SignUpPage() {
  return (
    <main className="relative z-50 min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6 pointer-events-auto gap-4">
      <SignUp
        path="/sign-up"
        routing="path"
        signInUrl="/sign-in"
        afterSignUpUrl="/dashboard"
      />
      <p className="text-xs text-gray-400 max-w-sm text-center">
        By creating an account, you agree to our{' '}
        <Link href="/terms" className="underline hover:text-gray-600">Terms of Service</Link> and{' '}
        <Link href="/privacy" className="underline hover:text-gray-600">Privacy Policy</Link>.
      </p>
    </main>
  )
}
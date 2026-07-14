'use client'

import { SignUp } from '@clerk/nextjs'

export default function SignUpPage() {
  return (
    <main className="relative z-50 min-h-screen flex items-center justify-center bg-gray-50 px-6 pointer-events-auto">
      <SignUp
        path="/sign-up"
        routing="path"
        signInUrl="/sign-in"
        afterSignUpUrl="/dashboard"
      />
    </main>
  )
}
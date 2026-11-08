// lib/app-origin.ts
//
// Exact origins this deployment trusts — shared by the Clerk middleware
// (authorizedParties) and the Stripe return URLs. No wildcards: Preview trusts
// only its own deployment and branch URLs, Production only the custom domain.

import type { NextRequest } from 'next/server'

export const PRODUCTION_ORIGIN = 'https://qbrdeck.misecuretechsolutions.com'

// Exact origins only; falls back to the production origin alone.
export function getAuthorizedParties(): string[] {
  const parties = [PRODUCTION_ORIGIN]

  if (process.env.VERCEL_ENV === 'preview') {
    for (const host of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]) {
      if (host) parties.push(`https://${host}`)
    }
  } else if (process.env.NODE_ENV === 'development') {
    parties.push('http://localhost:3000')
  }

  return parties
}

// The request's own origin when it is on the exact allowlist, otherwise the
// production origin. A forged Host header can only select an already-trusted origin.
export function resolveAppOrigin(req: NextRequest): string {
  const origin = req.nextUrl.origin
  return getAuthorizedParties().includes(origin) ? origin : PRODUCTION_ORIGIN
}

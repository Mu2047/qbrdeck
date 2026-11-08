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

// First value of a possibly comma-separated forwarding header.
function firstHeaderValue(req: NextRequest, name: string): string | null {
  const value = req.headers.get(name)?.split(',')[0].trim()
  return value || null
}

// The browser-visible origin when it is on the exact allowlist, otherwise the
// production origin. req.nextUrl.origin is not used: in Node route handlers Next
// builds it from the server's own address, not the host the browser requested.
// Candidates, in order: the browser-set Origin header, then x-forwarded-host,
// then host — each with x-forwarded-proto. A forged header can only select an
// already-trusted origin.
export function resolveAppOrigin(req: NextRequest): string {
  const allowed = getAuthorizedParties()
  const proto   = firstHeaderValue(req, 'x-forwarded-proto')

  const candidates = [req.headers.get('origin')]
  if (proto) {
    for (const host of [firstHeaderValue(req, 'x-forwarded-host'), firstHeaderValue(req, 'host')]) {
      if (host) candidates.push(`${proto}://${host}`)
    }
  }

  return candidates.find((c): c is string => !!c && allowed.includes(c)) ?? PRODUCTION_ORIGIN
}

import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isProtectedPage = createRouteMatcher(['/dashboard(.*)'])
const isProtectedApi = createRouteMatcher(['/api/((?!webhooks).*)'])

const PRODUCTION_ORIGIN = 'https://qbrdeck.misecuretechsolutions.com'

// Exact origins only; falls back to the production origin alone.
function getAuthorizedParties(): string[] {
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

export default clerkMiddleware(
  (auth, req) => {
    if (req.nextUrl.pathname.startsWith('/portal')) return

    if (isProtectedPage(req)) {
      auth().protect({
        unauthenticatedUrl: new URL('/', req.url).toString(),
      })
      return
    }

    if (isProtectedApi(req)) {
      auth().protect()
    }
  },
  {
    authorizedParties: getAuthorizedParties(),
  }
)

export const config = {
  matcher: [
    '/((?!.*\\..*|_next|portal).*)',
    '/',
    '/(api|trpc)(.*)',
  ],
}
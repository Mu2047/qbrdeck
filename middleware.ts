import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isProtectedPage = createRouteMatcher(['/dashboard(.*)'])
const isProtectedApi = createRouteMatcher(['/api/((?!webhooks).*)'])

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
    authorizedParties: ['https://qbrdeck.misecuretechsolutions.com'],
  }
)

export const config = {
  matcher: [
    '/((?!.*\\..*|_next|portal).*)',
    '/',
    '/(api|trpc)(.*)',
  ],
}
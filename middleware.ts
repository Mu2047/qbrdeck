
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isProtectedPage = createRouteMatcher(['/dashboard(.*)'])
const isProtectedApi  = createRouteMatcher(['/api/((?!webhooks).*)'])

export default clerkMiddleware((auth, req) => {
  if (req.nextUrl.pathname.startsWith('/portal')) return

  // Page routes: send unauthenticated users to the homepage, where the
  // working Clerk modal lives — the embedded /sign-in page is unstable
  // on the current SDK version.
  if (isProtectedPage(req)) {
    auth().protect({ unauthenticatedUrl: new URL('/', req.url).toString() })
    return
  }

  // API routes: keep existing behavior (Clerk returns 401/404 for
  // non-navigation requests rather than redirecting) — don't touch this,
  // since redirecting a fetch() call to an HTML page would break callers.
  if (isProtectedApi(req)) {
    auth().protect()
  }
})

export const config = {
  matcher: [
    '/((?!.*\\..*|_next|portal).*)',
    '/',
    '/(api|trpc)(.*)',
  ],
}
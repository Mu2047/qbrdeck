import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { getAuthorizedParties } from '@/lib/app-origin'

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
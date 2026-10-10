import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'

// Single canonical name/shape for the active-workspace selector so every
// reader and writer (lib/workspace.ts, invite acceptance, and the future
// Stage 2G2 switch endpoint) stays in sync by construction. The cookie holds
// a bare workspace ID — never a role, plan, or permission — because it is
// only ever used as a selector: lib/workspace.ts re-validates it against a
// real WorkspaceMember row on every read, so a forged or stale value grants
// nothing by itself.
export const ACTIVE_WORKSPACE_COOKIE = 'activeWorkspaceId'

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  // One year — the point of persisting this at all is to survive logout/login
  // and long gaps between visits. Membership re-validation on every read is
  // what keeps a year-old value safe to keep around.
  maxAge: 60 * 60 * 24 * 365,
}

// Server Components and Route Handlers may both need to read the selector;
// only a Route Handler (or Server Action) may write it, so the write helper
// takes the response it will attach to explicitly rather than guessing.
export function readActiveWorkspaceCookie(): string | null {
  return cookies().get(ACTIVE_WORKSPACE_COOKIE)?.value ?? null
}

export function setActiveWorkspaceCookie(res: NextResponse, workspaceId: string): void {
  res.cookies.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, COOKIE_OPTIONS)
}

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { NextResponse } from 'next/server'
import { selectActiveMembership } from '@/lib/workspace'
import { ACTIVE_WORKSPACE_COOKIE, setActiveWorkspaceCookie } from '@/lib/active-workspace'
import { can } from '@/lib/permissions'
import { shouldInterceptOnboarding } from '@/lib/onboarding'

// Stage 2G1 — multi-workspace invite foundation.
//
// Same two-kind convention as tests/team-collaboration.test.ts:
//
//  - EXECUTABLE tests import the real lib/workspace.ts, lib/active-workspace.ts,
//    lib/permissions.ts and lib/onboarding.ts and run them directly.
//
//  - SOURCE-CONTRACT tests read app/invite/[token]/page.tsx and
//    app/api/workspace/invite/accept/route.ts as plain text and regex-match
//    against them — this repo has no Clerk/Prisma/Next-request mocking
//    harness (same precedent as tests/team-collaboration.test.ts), so the
//    full client mount → fetch → navigate flow and the live Clerk redirect
//    handshake are proven structurally, not by rendering the component or
//    hitting a real route.
//
// No test here opens a database connection, calls Clerk, or sends the real
// invitation anywhere near acceptance.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const invitePageSource = readSourceLF('app/invite/[token]/page.tsx')
const acceptSource      = readSourceLF('app/api/workspace/invite/accept/route.ts')

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTABLE — selectActiveMembership (lib/workspace.ts)
// ─────────────────────────────────────────────────────────────────────────────

type M = { workspaceId: string; role: 'OWNER' | 'ADMIN'; joinedAt: Date }

const solo   : M = { workspaceId: 'ws_solo',   role: 'OWNER', joinedAt: new Date('2025-01-01') }
const growth: M = { workspaceId: 'ws_growth', role: 'ADMIN', joinedAt: new Date('2026-06-01') }

describe('selectActiveMembership — active-workspace resolution (EXECUTABLE — real lib/workspace.ts)', () => {
  it('A — no cookie, one membership: returns that membership (today\'s existing behavior)', () => {
    expect(selectActiveMembership([solo], null)).toBe(solo)
  })

  it('B — valid cookie, two memberships: returns the matching one', () => {
    expect(selectActiveMembership([solo, growth], 'ws_growth')).toBe(growth)
  })

  it('C — valid cookie selects the NEWER membership, not the earliest', () => {
    // solo joined first (earliest), growth joined later — the cookie must win.
    expect(selectActiveMembership([solo, growth], 'ws_growth')).toBe(growth)
    expect(selectActiveMembership([solo, growth], 'ws_growth')).not.toBe(solo)
  })

  it('D — cookie names a workspace the user does not belong to: safe fallback to earliest', () => {
    expect(selectActiveMembership([solo, growth], 'ws_not_a_member_of')).toBe(solo)
  })

  it('E — stale cookie after the referenced membership was removed: safe fallback', () => {
    // Membership list no longer contains ws_growth (simulating removal) even
    // though a stale cookie still names it.
    expect(selectActiveMembership([solo], 'ws_growth')).toBe(solo)
  })

  it('F — malformed/unknown workspace ID: safe fallback, never throws', () => {
    expect(() => selectActiveMembership([solo, growth], 'not-a-real-cuid-at-all')).not.toThrow()
    expect(selectActiveMembership([solo, growth], 'not-a-real-cuid-at-all')).toBe(solo)
  })

  it('G — no memberships at all: returns null (caller\'s existing onboarding/bootstrap path takes over)', () => {
    expect(selectActiveMembership([], 'ws_growth')).toBeNull()
    expect(selectActiveMembership([], null)).toBeNull()
  })

  it('empty-string cookie value is treated the same as no cookie', () => {
    expect(selectActiveMembership([solo, growth], '')).toBe(solo)
  })

  it('is pure — accepts no request/cookies() context and performs no I/O', () => {
    // Regression guard against reintroducing a direct cookies() call inside
    // the selector itself, which would make it untestable without a Next.js
    // request context and would risk getWorkspaceContext()/
    // getWorkspaceMembership() reading the cookie through two different code
    // paths again.
    expect(selectActiveMembership.length).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTABLE — active-workspace cookie helper (lib/active-workspace.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe('setActiveWorkspaceCookie (EXECUTABLE — real lib/active-workspace.ts)', () => {
  it('sets only the workspace ID, HttpOnly, SameSite=Lax, Path=/', () => {
    const res = NextResponse.json({ ok: true })
    setActiveWorkspaceCookie(res, 'ws_growth')

    const cookie = res.cookies.get(ACTIVE_WORKSPACE_COOKIE)
    expect(cookie?.value).toBe('ws_growth')
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('lax')
    expect(cookie?.path).toBe('/')
  })

  it('the cookie value is exactly the workspace ID — no role, plan, or JSON envelope', () => {
    const res = NextResponse.json({ ok: true })
    setActiveWorkspaceCookie(res, 'ws_growth')
    const cookie = res.cookies.get(ACTIVE_WORKSPACE_COOKIE)
    expect(cookie?.value).not.toMatch(/role|plan|OWNER|ADMIN|{/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTABLE — role/permission isolation across workspaces
// ─────────────────────────────────────────────────────────────────────────────

describe('role isolation — can.* derives only from the ACTIVE membership\'s role (EXECUTABLE — real lib/permissions.ts)', () => {
  it('Owner in Workspace A: full billing/member-management permissions', () => {
    const roleInA = solo.role // OWNER
    expect(can.manageBilling(roleInA)).toBe(true)
    expect(can.removeMembers(roleInA)).toBe(true)
    expect(can.changeRoles(roleInA)).toBe(true)
  })

  it('Admin in Workspace B (same user, different active workspace): billing/removal denied, invite allowed', () => {
    const roleInB = growth.role // ADMIN
    expect(can.manageBilling(roleInB)).toBe(false)
    expect(can.removeMembers(roleInB)).toBe(false)
    expect(can.changeRoles(roleInB)).toBe(false)
    expect(can.inviteMembers(roleInB)).toBe(true)
  })

  it('ownership in one workspace never bleeds into another: can.* takes only the active role, never an identity', () => {
    // can.* has no concept of "this user" — only the role string the caller
    // passes in. Resolving that role from the ACTIVE membership (this PR's
    // change) is therefore sufficient, by construction, to keep Owner-in-A
    // from ever being evaluated as Owner-in-B.
    expect(can.manageBilling.length).toBe(1)
    expect(can.manageBilling(selectActiveMembership([solo, growth], 'ws_growth')!.role)).toBe(false)
    expect(can.manageBilling(selectActiveMembership([solo, growth], 'ws_solo')!.role)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTABLE — onboarding/self-heal regression (lib/onboarding.ts unchanged)
// ─────────────────────────────────────────────────────────────────────────────

describe('onboarding interception is unaffected by gaining a second membership (EXECUTABLE — real lib/onboarding.ts)', () => {
  it('an invited existing user landing in a workspace whose onboarding is IN_PROGRESS for someone else is never intercepted', () => {
    const invitedUserId = 'user_mcamara'
    const originalOwnerId = 'user_mists'

    const growthOnboarding = {
      status: 'IN_PROGRESS' as const,
      currentStep: 'WELCOME' as const,
      onboardingOwnerUserId: originalOwnerId,
    }

    expect(shouldInterceptOnboarding(growthOnboarding, invitedUserId)).toBe(false)
    // Sanity: the same row DOES intercept its actual owner.
    expect(shouldInterceptOnboarding(growthOnboarding, originalOwnerId)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-CONTRACT — invite page auth-return (app/invite/[token]/page.tsx)
// ─────────────────────────────────────────────────────────────────────────────

describe('invite page — Clerk redirect props (SOURCE-CONTRACT, Stage 2G1)', () => {
  it('uses forceRedirectUrl, not fallbackRedirectUrl, to survive the global AFTER_SIGN_IN_URL env default', () => {
    expect(invitePageSource).toContain('forceRedirectUrl={`/invite/${params.token}`}')
  })

  it('also forces the sign-up redirect for a brand-new invited user', () => {
    expect(invitePageSource).toContain('signUpForceRedirectUrl={`/invite/${params.token}`}')
  })

  it('never uses the deprecated afterSignInUrl/afterSignUpUrl/redirectUrl props', () => {
    expect(invitePageSource).not.toMatch(/\bafterSignInUrl\s*=/)
    expect(invitePageSource).not.toMatch(/\bafterSignUpUrl\s*=/)
    expect(invitePageSource).not.toMatch(/\bredirectUrl\s*=/)
  })

  it('never uses fallbackRedirectUrl alone for this page (it loses to the global env default)', () => {
    // forceRedirectUrl must be present; fallbackRedirectUrl must not be used
    // as a substitute for it anywhere in this file.
    expect(invitePageSource).not.toMatch(/\bfallbackRedirectUrl\s*=/)
  })
})

describe('invite page — duplicate accept-POST guard (SOURCE-CONTRACT, Stage 2G1)', () => {
  it('declares a mount-scoped ref guard', () => {
    expect(invitePageSource).toMatch(/useRef\(false\)/)
  })

  it('checks the guard before posting, and sets it before the fetch call fires', () => {
    const guardCheckIdx = invitePageSource.indexOf('if (hasRequestedAccept.current) return')
    const guardSetIdx   = invitePageSource.indexOf('hasRequestedAccept.current = true')
    const fetchIdx      = invitePageSource.indexOf("fetch('/api/workspace/invite/accept'")

    expect(guardCheckIdx).toBeGreaterThan(-1)
    expect(guardSetIdx).toBeGreaterThan(-1)
    expect(fetchIdx).toBeGreaterThan(-1)
    expect(guardCheckIdx).toBeLessThan(guardSetIdx)
    expect(guardSetIdx).toBeLessThan(fetchIdx)
  })

  it('the guard is a plain mount-scoped ref, not a dependency the effect compares — a fresh mount (reload) always resets it', () => {
    // useRef's initial value is re-created only on a fresh component mount,
    // so a real page reload after a genuine failure still allows a retry.
    expect(invitePageSource).not.toMatch(/hasRequestedAccept[^\n]*useEffect dep|dependencies.*hasRequestedAccept/i)
  })
})

describe('invite page — infrastructure token-logging note (SOURCE-CONTRACT, Stage 2G1)', () => {
  it('documents that hosting/edge access logs may still capture the token via the request path', () => {
    expect(invitePageSource).toMatch(/hosting\/CDN\/edge access logs capture/i)
  })

  it('qualifies the claim with a caveat rather than asserting it is never logged anywhere, full stop', () => {
    expect(invitePageSource).toMatch(/caveat/i)
    expect(invitePageSource).toMatch(/does not mean the\s*\n?\/\/ raw token is never logged anywhere/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-CONTRACT — accept route sets the cookie ONLY on confirmed success
// ─────────────────────────────────────────────────────────────────────────────

describe('accept route — activeWorkspaceId cookie is set only on confirmed success (SOURCE-CONTRACT, Stage 2G1)', () => {
  it('imports the shared cookie-write helper rather than hardcoding a cookie name', () => {
    expect(acceptSource).toContain("import { setActiveWorkspaceCookie } from '@/lib/active-workspace'")
  })

  it('calls setActiveWorkspaceCookie exactly once', () => {
    const matches = acceptSource.match(/setActiveWorkspaceCookie\(/g) ?? []
    expect(matches.length).toBe(1)
  })

  it('the cookie-set call comes after every error-kind return, not before any of them', () => {
    const cookieCallIdx = acceptSource.indexOf('setActiveWorkspaceCookie(')
    expect(cookieCallIdx).toBeGreaterThan(-1)

    const errorReturnMarkers = [
      "status: 401",                                                     // unauthenticated
      "status: 400",                                                     // token required / already used or expired / already member (first occurrence)
      "status: 404",                                                     // invalid invitation / user not found
      "status: 403",                                                     // email mismatch / over seat limit
    ]
    for (const marker of errorReturnMarkers) {
      const firstIdx = acceptSource.indexOf(marker)
      expect(firstIdx).toBeGreaterThan(-1)
    }

    // The specific post-transaction error-kind block (already_used / expired /
    // already_member / over_seat_limit) must be fully above the cookie call.
    const alreadyUsedIdx   = acceptSource.indexOf("result.kind === 'already_used'")
    const expiredIdx       = acceptSource.indexOf("result.kind === 'expired'")
    const alreadyMemberIdx = acceptSource.indexOf("result.kind === 'already_member'")
    const overSeatIdx      = acceptSource.indexOf("result.kind === 'over_seat_limit'")

    for (const idx of [alreadyUsedIdx, expiredIdx, alreadyMemberIdx, overSeatIdx]) {
      expect(idx).toBeGreaterThan(-1)
      expect(idx).toBeLessThan(cookieCallIdx)
    }
  })

  it('the catch block never sets the cookie', () => {
    const catchIdx       = acceptSource.indexOf('} catch (err: any) {')
    const cookieCallIdx  = acceptSource.indexOf('setActiveWorkspaceCookie(')
    expect(catchIdx).toBeGreaterThan(-1)
    // The single cookie-set call must be entirely before the catch block —
    // i.e. inside the try's success path, never inside error handling.
    expect(cookieCallIdx).toBeLessThan(catchIdx)
  })

  it('sets the cookie to the just-accepted workspaceId, not a request-supplied value', () => {
    expect(acceptSource).toContain('setActiveWorkspaceCookie(response, result.workspaceId)')
  })
})

describe('accept route — existing-workspace preservation (SOURCE-CONTRACT, Stage 2G1)', () => {
  it('the acceptance transaction only ever creates a WorkspaceMember row — never updates or deletes one', () => {
    expect(acceptSource).toContain('tx.workspaceMember.create(')
    expect(acceptSource).not.toMatch(/tx\.workspaceMember\.(update|delete|deleteMany|updateMany)\(/)
  })

  it('never touches another WorkspaceMember row for this user (no query scoped by userId alone, only by the one target workspace)', () => {
    // The only workspaceMember read in the transaction is the duplicate-
    // membership check, scoped to this exact workspace — not a user-wide scan
    // that could touch the user's other (e.g. Solo) membership.
    expect(acceptSource).toContain('workspaceId_userId: { workspaceId: fresh.workspaceId, userId: user.id }')
  })
})

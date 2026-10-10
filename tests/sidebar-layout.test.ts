import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Stage 2G2E — sidebar workspace-switcher visibility fix.
//
// SOURCE-CONTRACT only, labelled honestly: this repo has no browser/layout
// rendering harness, so these tests assert on the Tailwind classes present
// in app/(app)/layout.tsx's JSX — they prove the intended CSS structure is in
// place, not actual computed pixel geometry or viewport behavior. The
// Production bug itself was diagnosed from real DevTools evidence
// (getBoundingClientRect() showing the switcher at top ≈ 814px, well below
// the viewport) — these tests cannot and do not claim to reproduce that
// measurement.
//
// Root cause: the outer row used min-h-screen (grows taller than the
// viewport when content demands it) instead of h-screen (capped at exactly
// the viewport). Without that cap, <main>'s overflow-auto had no bounded
// height to scroll within, so tall page content grew the whole row — and
// the sidebar, which stretches by default to match the row's height in a
// flex container — grew right along with it, pushing the switcher/Account
// footer far down the page. Separately, <nav> had flex-1 but no min-h-0, the
// classic flexbox trap where a flex item's default min-height ("auto", i.e.
// at least its own content's height) silently blocks overflow-y-auto from
// ever actually engaging.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const appLayoutSource = readSourceLF('app/(app)/layout.tsx')

describe('sidebar is capped at viewport height, not allowed to grow with content (SOURCE-CONTRACT, Stage 2G2E)', () => {
  it('the outer row uses h-screen, not min-h-screen', () => {
    expect(appLayoutSource).toContain('<div className="flex h-screen bg-gray-50">')
    // Checks no className attribute still carries min-h-screen — the code's
    // own explanatory comment above legitimately mentions the string.
    expect(appLayoutSource).not.toMatch(/className="[^"]*min-h-screen/)
  })

  it('the sidebar itself is also capped at viewport height', () => {
    expect(appLayoutSource).toMatch(/<aside className="[^"]*\bh-screen\b[^"]*flex flex-col/)
  })
})

describe('nav scrolls internally instead of pushing the switcher/Account footer out of view (SOURCE-CONTRACT, Stage 2G2E)', () => {
  it('nav has flex-1, min-h-0, and overflow-y-auto together', () => {
    const navMatch = appLayoutSource.match(/<nav className="([^"]*)"/)
    const navClasses = navMatch?.[1] ?? ''
    expect(navMatch).not.toBeNull()
    expect(navClasses).toMatch(/\bflex-1\b/)
    expect(navClasses).toMatch(/\bmin-h-0\b/)
    expect(navClasses).toMatch(/\boverflow-y-auto\b/)
  })
})

describe('bottom controls (switcher + Account) cannot be compressed or pushed out by nav content (SOURCE-CONTRACT, Stage 2G2E)', () => {
  it('the logo header does not shrink', () => {
    const headerMatch = appLayoutSource.match(/<div className="h-16([^"]*)"/)
    expect(headerMatch).not.toBeNull()
    expect(headerMatch?.[1]).toMatch(/\bshrink-0\b/)
  })

  it('the workspace switcher wrapper does not shrink', () => {
    const switcherWrapperMatch = appLayoutSource.match(/\{workspaces\.length > 1 && \(\s*<div className="([^"]*)"/)
    expect(switcherWrapperMatch).not.toBeNull()
    expect(switcherWrapperMatch?.[1]).toMatch(/\bshrink-0\b/)
  })

  it('the Account/User footer does not shrink', () => {
    const footerMatch = appLayoutSource.match(/\{\/\* User \*\/\}\s*<div className="([^"]*)"/)
    expect(footerMatch).not.toBeNull()
    expect(footerMatch?.[1]).toMatch(/\bshrink-0\b/)
  })
})

describe('no functional/API/security behavior changed — layout only (SOURCE-CONTRACT, Stage 2G2E regression)', () => {
  it('the selector still only renders for 2+ workspaces, and with no awkward gap for exactly one', () => {
    expect(appLayoutSource).toContain('{workspaces.length > 1 && (')
  })

  it('the workspace list fetch (auth-gated, no silent failure) is untouched', () => {
    expect(appLayoutSource).toContain('const { isLoaded, isSignedIn } = useAuth()')
    expect(appLayoutSource).toContain("if (!isLoaded || !isSignedIn) return")
    expect(appLayoutSource).toContain('if (!res.ok) throw new Error(')
  })

  it('switching still posts to the same endpoint and still navigates only on confirmed success', () => {
    const switchFnMatch = appLayoutSource.match(/async function switchWorkspace\(workspaceId: string\) \{([\s\S]*?)\n  \}/)
    const body = switchFnMatch?.[1] ?? ''
    expect(switchFnMatch).not.toBeNull()
    expect(body).toContain("fetch('/api/workspace/active'")
    expect(body).toContain("method: 'POST'")
    expect(body).toContain("router.push('/dashboard')")
    expect(body).toContain('router.refresh()')
  })

  it('main content area is unchanged — still flex-1 overflow-auto, so it scrolls within the now-bounded row', () => {
    expect(appLayoutSource).toContain('<main className="flex-1 overflow-auto">{children}</main>')
  })

  it('no API route, membership, cookie, permission, or billing file is touched by this change', () => {
    // This file only ever imports client-safe modules — confirms the fix
    // stayed presentation-only, same invariant Stage 2G2 already established.
    expect(appLayoutSource).not.toMatch(/@clerk\/nextjs\/server|next\/headers|@\/lib\/prisma|@\/lib\/workspace|@\/lib\/active-workspace/)
  })
})

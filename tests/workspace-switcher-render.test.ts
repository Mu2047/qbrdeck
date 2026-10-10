import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Stage 2G2C — workspace switcher UI rendering bug.
//
// Source-contract tests (same precedent as every other *.test.ts in this
// repo — no component-rendering harness, no Clerk-client mocking harness):
// they read app/(app)/layout.tsx as plain text and regex-match against it.
//
// Root cause (confirmed from source, not guessed): the switcher's list fetch
// ran in a useEffect with an empty dependency array, before Clerk's
// client-side auth state was known to be ready, AND never checked
// `response.ok` before parsing. fetch() only rejects on a network failure —
// a resolved non-200 response (e.g. 401) parses its JSON body fine, so
// `data.workspaces ?? []` silently produced an empty array with no error
// ever thrown, no .catch() ever reached, and — because the effect had no
// dependencies — no way to ever run again. That exactly explains: the
// manually-hit API works once auth is clearly established, but the
// sidebar's own identical fetch can silently and permanently resolve to
// "no workspaces" if it ever raced ahead of session readiness once, and a
// hard refresh does not change the race, so it keeps reproducing.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const appLayoutSource = readSourceLF('app/(app)/layout.tsx')

function effectBody(source: string): string {
  const match = source.match(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[isLoaded, isSignedIn\]\)/)
  return match?.[1] ?? ''
}

describe('switcher list fetch waits for Clerk auth readiness (SOURCE-CONTRACT, Stage 2G2C)', () => {
  it('imports useAuth and destructures isLoaded/isSignedIn', () => {
    expect(appLayoutSource).toContain("import { UserButton, useAuth } from '@clerk/nextjs'")
    expect(appLayoutSource).toContain('const { isLoaded, isSignedIn } = useAuth()')
  })

  it('the effect bails out before fetching when auth is not yet loaded or not signed in', () => {
    const body = effectBody(appLayoutSource)
    expect(body).not.toBe('')
    const guardIdx = body.indexOf('if (!isLoaded || !isSignedIn) return')
    const fetchIdx = body.indexOf("fetch('/api/workspace/active'")
    expect(guardIdx).toBeGreaterThan(-1)
    expect(fetchIdx).toBeGreaterThan(guardIdx)
  })

  it('the effect re-runs when isLoaded/isSignedIn change — not a fire-once empty dependency array', () => {
    expect(appLayoutSource).toMatch(/\}, \[isLoaded, isSignedIn\]\)/)
    // Regression guard against reverting to the old fire-once-forever effect.
    expect(appLayoutSource).not.toMatch(/fetch\('\/api\/workspace\/active'\)\s*\n\s*\.then\(r => r\.json\(\)\)/)
  })
})

describe('switcher list fetch no longer silently treats errors as success (SOURCE-CONTRACT, Stage 2G2C)', () => {
  it('checks response.ok before parsing JSON', () => {
    const body = effectBody(appLayoutSource)
    const okCheckIdx = body.indexOf('if (!res.ok)')
    const jsonIdx    = body.indexOf('res.json()')
    expect(okCheckIdx).toBeGreaterThan(-1)
    expect(okCheckIdx).toBeLessThan(jsonIdx)
  })

  it('a non-OK response throws rather than being parsed as a successful empty list', () => {
    const body = effectBody(appLayoutSource)
    expect(body).toMatch(/if \(!res\.ok\) throw new Error\(/)
  })

  it('on failure, the switcher safely falls back to hidden (empty list) — never crashes the layout', () => {
    const body = effectBody(appLayoutSource)
    const catchMatch = body.match(/\.catch\(\(\) => \{([\s\S]*?)\n      \}\)/)
    const catchBody = catchMatch?.[1] ?? ''
    expect(catchMatch).not.toBeNull()
    expect(catchBody).toMatch(/setWorkspaces\(\[\]\)/)
  })

  it('requests with explicit same-origin credentials and no-store caching', () => {
    expect(appLayoutSource).toContain("credentials: 'same-origin', cache: 'no-store'")
  })

  it('guards against a late-resolving fetch setting state after the effect was cleaned up', () => {
    const body = effectBody(appLayoutSource)
    expect(body).toMatch(/let cancelled = false/)
    expect(body).toMatch(/return \(\) => \{ cancelled = true \}/)
  })
})

describe('server-side authorization is untouched by this client-side fix (SOURCE-CONTRACT, Stage 2G2C)', () => {
  it('the comment explicitly disclaims duplicating server auth client-side', () => {
    expect(appLayoutSource).toMatch(/server route still independently re-checks auth\(\)/)
  })
})

describe('existing switcher behavior is unchanged by this fix (SOURCE-CONTRACT, Stage 2G2C regression)', () => {
  it('still renders the selector only for 2+ workspaces', () => {
    expect(appLayoutSource).toContain('{workspaces.length > 1 && (')
  })

  it('still never renders the raw workspaceId as visible text', () => {
    expect(appLayoutSource).toContain('key={w.workspaceId}')
    expect(appLayoutSource).toContain('value={w.workspaceId}')
    expect(appLayoutSource).not.toMatch(/>\{w\.workspaceId\}|\{w\.workspaceId\}<\//)
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

  it('switching still shows a sane error and does not navigate on failure', () => {
    const switchFnMatch = appLayoutSource.match(/async function switchWorkspace\(workspaceId: string\) \{([\s\S]*?)\n  \}/)
    const body = switchFnMatch?.[1] ?? ''
    expect(body).toContain('setSwitchError(')
    const errIdx  = body.indexOf('if (!res.ok || data.error)')
    const pushIdx = body.indexOf("router.push('/dashboard')")
    expect(errIdx).toBeGreaterThan(-1)
    expect(errIdx).toBeLessThan(pushIdx)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// EXECUTABLE tests for lib/app-origin.ts — the exact-origin allowlist shared by
// the Clerk middleware (authorizedParties) and the Stripe return URLs.

import { PRODUCTION_ORIGIN, getAuthorizedParties, resolveAppOrigin } from '@/lib/app-origin'

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const PREVIEW_HOST = 'qbrdeck-jql1ygh2r-techtonits-7492s-projects.vercel.app'
const BRANCH_HOST  = 'qbrdeck-git-feat-regional-pricing-techtonits-7492s-projects.vercel.app'

function request(origin: string) {
  const url = `${origin}/api/billing/checkout`
  return { url, nextUrl: new URL(url) } as any
}

function production() {
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('VERCEL_URL', 'qbrdeck-prod123-techtonits-7492s-projects.vercel.app')
}

function preview() {
  vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('VERCEL_URL', PREVIEW_HOST)
  vi.stubEnv('VERCEL_BRANCH_URL', BRANCH_HOST)
}

function development() {
  vi.stubEnv('NODE_ENV', 'development')
}

beforeEach(() => {
  // Never inherit Vercel variables from the shell running the tests.
  vi.stubEnv('VERCEL_ENV', undefined)
  vi.stubEnv('VERCEL_URL', undefined)
  vi.stubEnv('VERCEL_BRANCH_URL', undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('getAuthorizedParties', () => {
  it('production trusts only the production domain, even when VERCEL_URL is set', () => {
    production()
    expect(getAuthorizedParties()).toEqual([PRODUCTION_ORIGIN])
    expect(PRODUCTION_ORIGIN).toBe('https://qbrdeck.misecuretechsolutions.com')
  })

  it('preview adds the exact deployment and branch origins', () => {
    preview()
    expect(getAuthorizedParties()).toEqual([
      PRODUCTION_ORIGIN,
      `https://${PREVIEW_HOST}`,
      `https://${BRANCH_HOST}`,
    ])
  })

  it('preview with only VERCEL_URL adds just that origin', () => {
    preview()
    vi.stubEnv('VERCEL_BRANCH_URL', undefined)
    expect(getAuthorizedParties()).toEqual([PRODUCTION_ORIGIN, `https://${PREVIEW_HOST}`])
  })

  it('preview without Vercel URLs fails closed to production only', () => {
    preview()
    vi.stubEnv('VERCEL_URL', undefined)
    vi.stubEnv('VERCEL_BRANCH_URL', undefined)
    expect(getAuthorizedParties()).toEqual([PRODUCTION_ORIGIN])
  })

  it('development adds http://localhost:3000', () => {
    development()
    expect(getAuthorizedParties()).toEqual([PRODUCTION_ORIGIN, 'http://localhost:3000'])
  })

  it('localhost is never trusted outside development', () => {
    production()
    expect(getAuthorizedParties()).not.toContain('http://localhost:3000')
    vi.unstubAllEnvs()
    preview()
    expect(getAuthorizedParties()).not.toContain('http://localhost:3000')
  })

  it('no environment, unknown VERCEL_ENV → production only', () => {
    vi.stubEnv('NODE_ENV', 'test')
    expect(getAuthorizedParties()).toEqual([PRODUCTION_ORIGIN])
    vi.stubEnv('VERCEL_ENV', 'staging')
    vi.stubEnv('VERCEL_URL', PREVIEW_HOST)
    expect(getAuthorizedParties()).toEqual([PRODUCTION_ORIGIN])
  })

  it('never contains a wildcard', () => {
    for (const env of [production, preview, development]) {
      vi.unstubAllEnvs()
      env()
      for (const party of getAuthorizedParties()) expect(party).not.toMatch(/\*/)
    }
  })
})

describe('resolveAppOrigin', () => {
  it('production request → production origin', () => {
    production()
    expect(resolveAppOrigin(request(PRODUCTION_ORIGIN))).toBe(PRODUCTION_ORIGIN)
  })

  it('production ignores its own *.vercel.app deployment URL', () => {
    production()
    expect(resolveAppOrigin(request('https://qbrdeck-prod123-techtonits-7492s-projects.vercel.app'))).toBe(PRODUCTION_ORIGIN)
  })

  it('preview deployment URL → that exact deployment URL', () => {
    preview()
    expect(resolveAppOrigin(request(`https://${PREVIEW_HOST}`))).toBe(`https://${PREVIEW_HOST}`)
  })

  it('preview branch URL → that exact branch URL', () => {
    preview()
    expect(resolveAppOrigin(request(`https://${BRANCH_HOST}`))).toBe(`https://${BRANCH_HOST}`)
  })

  it('localhost works in development only', () => {
    development()
    expect(resolveAppOrigin(request('http://localhost:3000'))).toBe('http://localhost:3000')
    vi.unstubAllEnvs()
    production()
    expect(resolveAppOrigin(request('http://localhost:3000'))).toBe(PRODUCTION_ORIGIN)
  })

  it.each([
    ['another preview deployment',     'https://qbrdeck-other999-techtonits-7492s-projects.vercel.app'],
    ['another Vercel project',         'https://attacker.vercel.app'],
    ['arbitrary host',                 'https://evil.example'],
    ['look-alike subdomain',           `https://${PREVIEW_HOST}.evil.example`],
    ['http downgrade of preview host', `http://${PREVIEW_HOST}`],
    ['wrong port on localhost',        'http://localhost:4000'],
  ])('preview: untrusted origin (%s) falls back to production', (_label, origin) => {
    preview()
    expect(resolveAppOrigin(request(origin))).toBe(PRODUCTION_ORIGIN)
  })

  it('a wildcard-looking VERCEL_URL is matched literally, never as a pattern', () => {
    preview()
    vi.stubEnv('VERCEL_URL', '*.vercel.app')
    vi.stubEnv('VERCEL_BRANCH_URL', undefined)
    expect(resolveAppOrigin(request('https://attacker.vercel.app'))).toBe(PRODUCTION_ORIGIN)
  })
})

describe('middleware uses the shared allowlist', () => {
  const middlewareSource = readSourceLF('middleware.ts')

  it('imports getAuthorizedParties and passes it to clerkMiddleware', () => {
    expect(middlewareSource).toMatch(/import \{ getAuthorizedParties \} from '@\/lib\/app-origin'/)
    expect(middlewareSource).toMatch(/authorizedParties: getAuthorizedParties\(\)/)
  })
})

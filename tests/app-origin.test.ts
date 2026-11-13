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
const PREVIEW      = `https://${PREVIEW_HOST}`
const BRANCH       = `https://${BRANCH_HOST}`

// nextUrl is deliberately the server's internal address, as Next builds it in
// a Node route handler — resolveAppOrigin must never read it.
function request(headers: Record<string, string> = {}) {
  const url = 'http://localhost:3000/api/billing/checkout'
  return { url, nextUrl: new URL(url), headers: new Headers(headers) } as any
}

// What a browser POST through Vercel carries: Origin from the browser, the
// forwarding headers from Vercel.
function vercelHeaders(host: string, origin = `https://${host}`) {
  return { origin, host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https' }
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
    expect(getAuthorizedParties()).toEqual([PRODUCTION_ORIGIN, PREVIEW, BRANCH])
  })

  it('preview with only VERCEL_URL adds just that origin', () => {
    preview()
    vi.stubEnv('VERCEL_BRANCH_URL', undefined)
    expect(getAuthorizedParties()).toEqual([PRODUCTION_ORIGIN, PREVIEW])
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

describe('resolveAppOrigin — trusted origins', () => {
  it('production request → production origin', () => {
    production()
    expect(resolveAppOrigin(request(vercelHeaders('qbrdeck.misecuretechsolutions.com')))).toBe(PRODUCTION_ORIGIN)
  })

  it('production ignores its own *.vercel.app deployment URL', () => {
    production()
    expect(resolveAppOrigin(request(vercelHeaders('qbrdeck-prod123-techtonits-7492s-projects.vercel.app')))).toBe(PRODUCTION_ORIGIN)
  })

  it('preview deployment host → that exact deployment origin', () => {
    preview()
    expect(resolveAppOrigin(request(vercelHeaders(PREVIEW_HOST)))).toBe(PREVIEW)
  })

  it('preview branch host → that exact branch origin', () => {
    preview()
    expect(resolveAppOrigin(request(vercelHeaders(BRANCH_HOST)))).toBe(BRANCH)
  })

  it('localhost works in development (Origin header)', () => {
    development()
    expect(resolveAppOrigin(request({ origin: 'http://localhost:3000' }))).toBe('http://localhost:3000')
  })

  it('localhost works in development (host + x-forwarded-proto, as Next dev sets them)', () => {
    development()
    expect(resolveAppOrigin(request({ host: 'localhost:3000', 'x-forwarded-host': 'localhost:3000', 'x-forwarded-proto': 'http' })))
      .toBe('http://localhost:3000')
  })

  it('localhost outside development → production', () => {
    production()
    expect(resolveAppOrigin(request({ origin: 'http://localhost:3000', host: 'localhost:3000', 'x-forwarded-proto': 'http' })))
      .toBe(PRODUCTION_ORIGIN)
    vi.unstubAllEnvs()
    preview()
    expect(resolveAppOrigin(request({ origin: 'http://localhost:3000' }))).toBe(PRODUCTION_ORIGIN)
  })

  it('never reads req.nextUrl.origin, even when it would be trusted', () => {
    development()
    expect(resolveAppOrigin(request({ origin: 'https://evil.example' }))).toBe(PRODUCTION_ORIGIN)
  })
})

describe('resolveAppOrigin — candidate order', () => {
  it('Origin header wins when trusted', () => {
    preview()
    expect(resolveAppOrigin(request({ ...vercelHeaders(PREVIEW_HOST), origin: BRANCH }))).toBe(BRANCH)
  })

  it('untrusted Origin falls through to a trusted x-forwarded-host', () => {
    preview()
    expect(resolveAppOrigin(request(vercelHeaders(PREVIEW_HOST, 'https://evil.example')))).toBe(PREVIEW)
  })

  it('missing Origin falls through to x-forwarded-host', () => {
    preview()
    expect(resolveAppOrigin(request({ 'x-forwarded-host': PREVIEW_HOST, 'x-forwarded-proto': 'https' }))).toBe(PREVIEW)
  })

  it('missing Origin and x-forwarded-host falls through to host', () => {
    preview()
    expect(resolveAppOrigin(request({ host: BRANCH_HOST, 'x-forwarded-proto': 'https' }))).toBe(BRANCH)
  })

  it('untrusted x-forwarded-host falls through to a trusted host', () => {
    preview()
    expect(resolveAppOrigin(request({ host: PREVIEW_HOST, 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' })))
      .toBe(PREVIEW)
  })

  it('uses only the first value of comma-separated forwarding headers', () => {
    preview()
    expect(resolveAppOrigin(request({ 'x-forwarded-host': `${PREVIEW_HOST}, evil.example`, 'x-forwarded-proto': 'https, http' })))
      .toBe(PREVIEW)
    expect(resolveAppOrigin(request({ 'x-forwarded-host': `evil.example, ${PREVIEW_HOST}`, 'x-forwarded-proto': 'https' })))
      .toBe(PRODUCTION_ORIGIN)
  })
})

describe('resolveAppOrigin — fails closed to production', () => {
  it.each([
    ['malicious origin',             { origin: 'https://evil.example' }],
    ['malicious host',               { host: 'evil.example', 'x-forwarded-proto': 'https' }],
    ['malicious x-forwarded-host',   { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }],
    ['all three malicious',          { origin: 'https://evil.example', host: 'evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }],
    ['missing headers',              {}],
    ['host without x-forwarded-proto', { host: PREVIEW_HOST, 'x-forwarded-host': PREVIEW_HOST }],
    ['opaque "null" origin',         { origin: 'null' }],
    ['another preview deployment',   vercelHeaders('qbrdeck-other999-techtonits-7492s-projects.vercel.app')],
    ['another Vercel project',       vercelHeaders('attacker.vercel.app')],
    ['look-alike subdomain',         vercelHeaders(`${PREVIEW_HOST}.evil.example`)],
    ['HTTP downgrade (origin)',      { origin: `http://${PREVIEW_HOST}` }],
    ['HTTP downgrade (proto)',       { host: PREVIEW_HOST, 'x-forwarded-host': PREVIEW_HOST, 'x-forwarded-proto': 'http' }],
    ['wrong port (origin)',          { origin: `${PREVIEW}:8443` }],
    ['wrong port (host)',            { host: `${PREVIEW_HOST}:8443`, 'x-forwarded-proto': 'https' }],
    ['origin with a path',           { origin: `${PREVIEW}/dashboard` }],
    ['wildcard-looking origin',      { origin: 'https://*.vercel.app' }],
    ['wildcard-looking host',        { host: '*.vercel.app', 'x-forwarded-host': '*.vercel.app', 'x-forwarded-proto': 'https' }],
  ])('preview: %s → production', (_label, headers) => {
    preview()
    expect(resolveAppOrigin(request(headers as Record<string, string>))).toBe(PRODUCTION_ORIGIN)
  })

  it('localhost on the wrong port in development → production', () => {
    development()
    expect(resolveAppOrigin(request({ origin: 'http://localhost:4000', host: 'localhost:4000', 'x-forwarded-proto': 'http' })))
      .toBe(PRODUCTION_ORIGIN)
  })

  it('a wildcard-looking VERCEL_URL is matched literally, never as a pattern', () => {
    preview()
    vi.stubEnv('VERCEL_URL', '*.vercel.app')
    vi.stubEnv('VERCEL_BRANCH_URL', undefined)
    expect(resolveAppOrigin(request(vercelHeaders('attacker.vercel.app')))).toBe(PRODUCTION_ORIGIN)
  })
})

describe('middleware uses the shared allowlist', () => {
  const middlewareSource = readSourceLF('middleware.ts')

  it('imports getAuthorizedParties and passes it to clerkMiddleware', () => {
    expect(middlewareSource).toMatch(/import \{ getAuthorizedParties \} from '@\/lib\/app-origin'/)
    expect(middlewareSource).toMatch(/authorizedParties: getAuthorizedParties\(\)/)
  })
})

describe('checkout route carries no temporary origin debugging', () => {
  it('no [checkout-origin-debug] logging remains', () => {
    expect(readSourceLF('app/api/billing/checkout/route.ts')).not.toMatch(/checkout-origin-debug/)
  })
})

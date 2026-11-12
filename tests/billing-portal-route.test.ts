import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// EXECUTABLE tests for POST /api/billing/portal. Clerk, Prisma, the workspace
// resolver and the Stripe client are all mocked — no database connection, no
// Stripe call, no real portal session. lib/permissions and lib/billing/* run
// for real.

const mocks = vi.hoisted(() => ({
  auth:                   vi.fn(),
  getWorkspaceMembership: vi.fn(),
  subscriptionFindUnique: vi.fn(),
  portalSessionsCreate:   vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }))
vi.mock('@/lib/workspace', () => ({ getWorkspaceMembership: mocks.getWorkspaceMembership }))
vi.mock('@/lib/prisma', () => ({
  prisma: { subscription: { findUnique: mocks.subscriptionFindUnique } },
}))
vi.mock('@/lib/stripe', () => ({
  stripe: { billingPortal: { sessions: { create: mocks.portalSessionsCreate } } },
}))

import { POST } from '@/app/api/billing/portal/route'

// The return origin comes from the request, checked against lib/app-origin.ts.
// NEXT_PUBLIC_APP_URL is set to something else to prove it is no longer read.
const APP_URL        = 'https://qbrdeck.misecuretechsolutions.com'
const PREVIEW_ORIGIN = 'https://qbrdeck-jql1ygh2r-techtonits-7492s-projects.vercel.app'
const BRANCH_ORIGIN  = 'https://qbrdeck-git-feat-regional-pricing-techtonits-7492s-projects.vercel.app'
const ENV = {
  NEXT_PUBLIC_APP_URL: 'https://app.example',
  STRIPE_PRICE_SOLO_USD: 'price_usd_solo', STRIPE_PRICE_GROWTH_USD: 'price_usd_growth', STRIPE_PRICE_AGENCY_USD: 'price_usd_agency',
  STRIPE_PRICE_SOLO_GMD: 'price_gmd_solo', STRIPE_PRICE_GROWTH_GMD: 'price_gmd_growth', STRIPE_PRICE_AGENCY_GMD: 'price_gmd_agency',
  STRIPE_PRICE_SOLO_XOF: 'price_xof_solo', STRIPE_PRICE_GROWTH_XOF: 'price_xof_growth', STRIPE_PRICE_AGENCY_XOF: 'price_xof_agency',
  STRIPE_PORTAL_CONFIG_USD: 'bpc_usd',
  STRIPE_PORTAL_CONFIG_GMD: 'bpc_gmd',
  STRIPE_PORTAL_CONFIG_XOF: 'bpc_xof',
}
const ENV_KEYS = [
  ...Object.keys(ENV),
  ...['SOLO', 'GROWTH', 'AGENCY'].map(p => `STRIPE_PRICE_${p}`),
]
const savedEnv: Record<string, string | undefined> = {}

function row(stripePriceId: string | null, stripeCustomerId = 'cus_active') {
  return { stripeCustomerId, stripePriceId }
}

// The route must not read the body or query; they exist to prove it. `url` is
// the browser-visible URL: its origin becomes the Origin/host/x-forwarded-*
// headers a browser POST through Vercel carries. nextUrl is the server's
// internal address, as Next builds it in a Node route handler.
function request(body: unknown = {}, url = `${APP_URL}/api/billing/portal`, headers?: Record<string, string>) {
  const { origin, host, protocol } = new URL(url)
  const internal = `http://localhost:3000${new URL(url).pathname}`
  return {
    json:    vi.fn(async () => body),
    url:     internal,
    nextUrl: new URL(internal),
    headers: new Headers(headers ?? { origin, host, 'x-forwarded-host': host, 'x-forwarded-proto': protocol.replace(':', '') }),
  } as any
}

async function call(req = request()) {
  const res = await POST(req)
  return { status: res.status, data: await res.json() }
}

function sessionArgs() {
  expect(mocks.portalSessionsCreate).toHaveBeenCalledTimes(1)
  return mocks.portalSessionsCreate.mock.calls[0][0]
}

beforeEach(() => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k] }
  Object.assign(process.env, ENV)
  vi.stubEnv('VERCEL_ENV', undefined)
  vi.stubEnv('VERCEL_URL', undefined)
  vi.stubEnv('VERCEL_BRANCH_URL', undefined)

  mocks.auth.mockReturnValue({ userId: 'clerk_owner' })
  mocks.getWorkspaceMembership.mockResolvedValue({ workspaceId: 'ws_active', role: 'OWNER' })
  mocks.subscriptionFindUnique.mockResolvedValue(row('price_usd_growth'))
  mocks.portalSessionsCreate.mockResolvedValue({ url: 'https://portal.example/session' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('currency-specific portal configuration', () => {
  it.each([
    ['price_usd_solo',   'bpc_usd'],
    ['price_usd_growth', 'bpc_usd'],
    ['price_usd_agency', 'bpc_usd'],
    ['price_gmd_solo',   'bpc_gmd'],
    ['price_gmd_agency', 'bpc_gmd'],
    ['price_xof_growth', 'bpc_xof'],
    ['price_xof_agency', 'bpc_xof'],
  ])('stored price %s → configuration %s', async (priceId, configuration) => {
    mocks.subscriptionFindUnique.mockResolvedValue(row(priceId))
    const { status, data } = await call()
    expect(status).toBe(200)
    expect(data.url).toBe('https://portal.example/session')
    expect(sessionArgs().configuration).toBe(configuration)
  })

  it('USD: existing behaviour preserved — stored customer, settings return URL, USD config', async () => {
    const { status } = await call()
    expect(status).toBe(200)
    expect(sessionArgs()).toEqual({
      customer:      'cus_active',
      configuration: 'bpc_usd',
      return_url:    `${APP_URL}/dashboard/settings`,
    })
  })

  it.each(['XOF_ZONE', 'GM,XOF_ZONE'])('U. Preview + %j: every XOF price opens STRIPE_PORTAL_CONFIG_XOF only', async (flag) => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('BILLING_PREVIEW_REGIONS', flag)
    for (const priceId of ['price_xof_solo', 'price_xof_growth', 'price_xof_agency']) {
      mocks.portalSessionsCreate.mockClear()
      mocks.subscriptionFindUnique.mockResolvedValue(row(priceId, 'cus_xof'))
      expect((await call()).status).toBe(200)
      expect(sessionArgs()).toMatchObject({ customer: 'cus_xof', configuration: 'bpc_xof' })
    }
  })

  it('U. client-supplied USD/GMD configuration cannot redirect an XOF subscriber', async () => {
    mocks.subscriptionFindUnique.mockResolvedValue(row('price_xof_agency', 'cus_xof'))
    const req = request(
      { currency: 'GMD', configuration: 'bpc_gmd' },
      `${APP_URL}/api/billing/portal?currency=USD&configuration=bpc_usd`,
    )
    expect((await call(req)).status).toBe(200)
    expect(req.json).not.toHaveBeenCalled()
    expect(sessionArgs()).toMatchObject({ customer: 'cus_xof', configuration: 'bpc_xof' })
  })

  it('USD subscriptions on legacy STRIPE_PRICE_{PLAN} names still resolve', async () => {
    delete process.env.STRIPE_PRICE_SOLO_USD
    process.env.STRIPE_PRICE_SOLO = 'price_legacy_solo'
    mocks.subscriptionFindUnique.mockResolvedValue(row('price_legacy_solo'))
    expect((await call()).status).toBe(200)
    expect(sessionArgs().configuration).toBe('bpc_usd')
  })
})

describe('return_url — exact trusted origin only', () => {
  const portalUrl = (origin: string) => `${origin}/api/billing/portal`

  function preview() {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_URL', new URL(PREVIEW_ORIGIN).host)
    vi.stubEnv('VERCEL_BRANCH_URL', new URL(BRANCH_ORIGIN).host)
  }

  it('production → production domain', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NODE_ENV', 'production')
    await call(request({}, portalUrl(APP_URL)))
    expect(sessionArgs().return_url).toBe(`${APP_URL}/dashboard/settings`)
  })

  it('preview deployment URL → that exact deployment URL', async () => {
    preview()
    await call(request({}, portalUrl(PREVIEW_ORIGIN)))
    expect(sessionArgs().return_url).toBe(`${PREVIEW_ORIGIN}/dashboard/settings`)
  })

  it('preview branch URL → that exact branch URL', async () => {
    preview()
    await call(request({}, portalUrl(BRANCH_ORIGIN)))
    expect(sessionArgs().return_url).toBe(`${BRANCH_ORIGIN}/dashboard/settings`)
  })

  it('localhost works in development only', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    await call(request({}, portalUrl('http://localhost:3000')))
    expect(sessionArgs().return_url).toBe('http://localhost:3000/dashboard/settings')
  })

  it('localhost outside development → production domain', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NODE_ENV', 'production')
    await call(request({}, portalUrl('http://localhost:3000')))
    expect(sessionArgs().return_url).toBe(`${APP_URL}/dashboard/settings`)
  })

  it.each([
    'https://evil.example',
    'https://app.example',
    'https://qbrdeck-other999-techtonits-7492s-projects.vercel.app',
    `http://${new URL(PREVIEW_ORIGIN).host}`,
  ])('preview: untrusted origin %s → production domain', async origin => {
    preview()
    await call(request({}, portalUrl(origin)))
    expect(sessionArgs().return_url).toBe(`${APP_URL}/dashboard/settings`)
  })

  it('preview: malicious Origin header with a trusted Vercel host → that trusted host', async () => {
    preview()
    const host = new URL(PREVIEW_ORIGIN).host
    await call(request({}, portalUrl(PREVIEW_ORIGIN), { origin: 'https://evil.example', host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https' }))
    expect(sessionArgs().return_url).toBe(`${PREVIEW_ORIGIN}/dashboard/settings`)
  })

  it('preview: malicious host and x-forwarded-host → production domain', async () => {
    preview()
    await call(request({}, portalUrl(PREVIEW_ORIGIN), { host: 'evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }))
    expect(sessionArgs().return_url).toBe(`${APP_URL}/dashboard/settings`)
  })

  it('preview: no origin headers at all → production domain', async () => {
    preview()
    await call(request({}, portalUrl(PREVIEW_ORIGIN), {}))
    expect(sessionArgs().return_url).toBe(`${APP_URL}/dashboard/settings`)
  })
})

describe('fails closed — no portal session', () => {
  it.each([
    ['GMD', 'price_gmd_growth'],
    ['XOF', 'price_xof_growth'],
  ])('%s portal config missing → 503, never the USD config', async (currency, priceId) => {
    delete process.env[`STRIPE_PORTAL_CONFIG_${currency}`]
    mocks.subscriptionFindUnique.mockResolvedValue(row(priceId))
    const { status, data } = await call()
    expect(status).toBe(503)
    expect(data.error).not.toMatch(/bpc_|cus_|price_|ws_/)
    expect(mocks.portalSessionsCreate).not.toHaveBeenCalled()
  })

  it('USD portal config missing → 503 (no silent Stripe default)', async () => {
    delete process.env.STRIPE_PORTAL_CONFIG_USD
    expect((await call()).status).toBe(503)
    expect(mocks.portalSessionsCreate).not.toHaveBeenCalled()
  })

  it.each([
    ['GMD', 'bpc_gmd'],
    ['USD', 'bpc_usd'],
  ])('W. XOF configured with the %s config ID → 503 for XOF, no portal session', async (_other, sharedId) => {
    process.env.STRIPE_PORTAL_CONFIG_XOF = sharedId
    mocks.subscriptionFindUnique.mockResolvedValue(row('price_xof_growth'))
    expect((await call()).status).toBe(503)
    expect(mocks.portalSessionsCreate).not.toHaveBeenCalled()
  })

  it('GMD configured with the USD config ID → 503', async () => {
    process.env.STRIPE_PORTAL_CONFIG_GMD = 'bpc_usd'
    mocks.subscriptionFindUnique.mockResolvedValue(row('price_gmd_growth'))
    expect((await call()).status).toBe(503)
    expect(mocks.portalSessionsCreate).not.toHaveBeenCalled()
  })

  it('unknown stored Stripe Price ID → 503', async () => {
    mocks.subscriptionFindUnique.mockResolvedValue(row('price_retired_unmapped'))
    expect((await call()).status).toBe(503)
    expect(mocks.portalSessionsCreate).not.toHaveBeenCalled()
  })

  it('missing stored Price ID on a real customer (e.g. canceled) → 404', async () => {
    mocks.subscriptionFindUnique.mockResolvedValue(row(null))
    const { status, data } = await call()
    expect(status).toBe(404)
    expect(data.error).toBe('No active subscription')
    expect(mocks.portalSessionsCreate).not.toHaveBeenCalled()
  })

  it('invalid price table config → 503', async () => {
    process.env.STRIPE_PRICE_SOLO_GMD = 'price_usd_solo'
    expect((await call()).status).toBe(503)
    expect(mocks.portalSessionsCreate).not.toHaveBeenCalled()
  })
})

describe('FREE / placeholder state', () => {
  it('free_ placeholder customer is never sent to Stripe', async () => {
    mocks.subscriptionFindUnique.mockResolvedValue(row(null, 'free_ws_active'))
    expect((await call()).status).toBe(404)
    expect(mocks.portalSessionsCreate).not.toHaveBeenCalled()
  })

  it('free_ placeholder is refused even if a Price ID is somehow present', async () => {
    mocks.subscriptionFindUnique.mockResolvedValue(row('price_usd_growth', 'free_ws_active'))
    expect((await call()).status).toBe(404)
    expect(mocks.portalSessionsCreate).not.toHaveBeenCalled()
  })

  it('no Subscription row → 404', async () => {
    mocks.subscriptionFindUnique.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(mocks.portalSessionsCreate).not.toHaveBeenCalled()
  })
})

describe('access control', () => {
  it('Owner can open the portal', async () => {
    expect((await call()).status).toBe(200)
  })

  it.each(['ADMIN', 'MEMBER', 'VIEWER'])('%s → 403 before any lookup or Stripe call', async role => {
    mocks.getWorkspaceMembership.mockResolvedValue({ workspaceId: 'ws_active', role })
    expect((await call()).status).toBe(403)
    expect(mocks.subscriptionFindUnique).not.toHaveBeenCalled()
    expect(mocks.portalSessionsCreate).not.toHaveBeenCalled()
  })

  it('unauthenticated → 401', async () => {
    mocks.auth.mockReturnValue({ userId: null })
    expect((await call()).status).toBe(401)
    expect(mocks.portalSessionsCreate).not.toHaveBeenCalled()
  })

  it('no workspace membership → 404', async () => {
    mocks.getWorkspaceMembership.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(mocks.portalSessionsCreate).not.toHaveBeenCalled()
  })

  it('uses only the active workspace membership and its stored customer', async () => {
    await call()
    expect(mocks.getWorkspaceMembership).toHaveBeenCalledWith('clerk_owner')
    expect(mocks.subscriptionFindUnique.mock.calls[0][0].where).toEqual({ workspaceId: 'ws_active' })
    expect(sessionArgs().customer).toBe('cus_active')
  })

  it('client-supplied currency, configuration, customer or workspace are ignored', async () => {
    mocks.subscriptionFindUnique.mockResolvedValue(row('price_gmd_growth'))
    const req = request(
      { currency: 'USD', configuration: 'bpc_usd', customer: 'cus_other', workspaceId: 'ws_other', return_url: 'https://evil.example' },
      `${APP_URL}/api/billing/portal?currency=USD&configuration=bpc_usd&workspaceId=ws_other`,
    )
    expect((await call(req)).status).toBe(200)
    expect(req.json).not.toHaveBeenCalled()
    expect(sessionArgs()).toEqual({
      customer:      'cus_active',
      configuration: 'bpc_gmd',
      return_url:    `${APP_URL}/dashboard/settings`,
    })
    expect(mocks.subscriptionFindUnique.mock.calls[0][0].where).toEqual({ workspaceId: 'ws_active' })
  })

  it('Stripe failure → 500 with a generic message', async () => {
    mocks.portalSessionsCreate.mockRejectedValue(new Error('No such customer: cus_active'))
    const { status, data } = await call()
    expect(status).toBe(500)
    expect(data.error).toBe('Internal server error')
  })
})

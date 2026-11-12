import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// EXECUTABLE tests for POST /api/billing/checkout. Clerk, Prisma, the
// workspace resolver and the Stripe client are all mocked — no database
// connection, no Stripe call, no real checkout session. lib/permissions and
// lib/billing/* run for real.

const mocks = vi.hoisted(() => ({
  auth:                     vi.fn(),
  getWorkspaceMembership:   vi.fn(),
  userFindUnique:           vi.fn(),
  subscriptionFindUnique:   vi.fn(),
  createOrRetrieveCustomer: vi.fn(),
  sessionsCreate:           vi.fn(),
  pricesRetrieve:           vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }))
vi.mock('@/lib/workspace', () => ({ getWorkspaceMembership: mocks.getWorkspaceMembership }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user:         { findUnique: mocks.userFindUnique },
    subscription: { findUnique: mocks.subscriptionFindUnique },
  },
}))
vi.mock('@/lib/stripe', () => ({
  stripe: {
    checkout: { sessions: { create: mocks.sessionsCreate } },
    prices:   { retrieve: mocks.pricesRetrieve },
  },
  createOrRetrieveCustomer: mocks.createOrRetrieveCustomer,
}))

import { POST } from '@/app/api/billing/checkout/route'

const PRICE_ENV = {
  STRIPE_PRICE_SOLO:   'price_live_solo',
  STRIPE_PRICE_GROWTH: 'price_live_growth',
  STRIPE_PRICE_AGENCY: 'price_live_agency',
}
const ENV_KEYS = [
  ...Object.keys(PRICE_ENV),
  ...['SOLO', 'GROWTH', 'AGENCY'].flatMap(p => ['USD', 'GMD', 'XOF'].map(c => `STRIPE_PRICE_${p}_${c}`)),
]
const savedEnv: Record<string, string | undefined> = {}

const FREE_SUB = { plan: 'FREE', status: 'active', stripeStatus: null, stripeSubscriptionId: null }

const PRODUCTION_ORIGIN = 'https://qbrdeck.misecuretechsolutions.com'
const PREVIEW_ORIGIN    = 'https://qbrdeck-jql1ygh2r-techtonits-7492s-projects.vercel.app'
const BRANCH_ORIGIN     = 'https://qbrdeck-git-feat-regional-pricing-techtonits-7492s-projects.vercel.app'

// The headers a browser POST through Vercel carries for `origin`. nextUrl is the
// server's internal address, as Next builds it in a Node route handler.
function browserHeaders(origin: string): Record<string, string> {
  const { host, protocol } = new URL(origin)
  return { origin, host, 'x-forwarded-host': host, 'x-forwarded-proto': protocol.replace(':', '') }
}

function request(body: unknown, headers: Record<string, string> = browserHeaders(PRODUCTION_ORIGIN)) {
  const url = 'http://localhost:3000/api/billing/checkout'
  return { json: async () => body, url, nextUrl: new URL(url), headers: new Headers(headers) } as any
}

async function call(body: unknown, origin?: string | Record<string, string>) {
  const headers = typeof origin === 'string' ? browserHeaders(origin) : origin
  const res  = await POST(request(body, headers))
  return { status: res.status, data: await res.json() }
}

beforeEach(() => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k] }
  Object.assign(process.env, PRICE_ENV)
  vi.stubEnv('VERCEL_ENV', undefined)
  vi.stubEnv('VERCEL_URL', undefined)
  vi.stubEnv('VERCEL_BRANCH_URL', undefined)
  vi.stubEnv('BILLING_PREVIEW_REGIONS', undefined)

  mocks.auth.mockReturnValue({ userId: 'clerk_owner' })
  mocks.getWorkspaceMembership.mockResolvedValue({ workspaceId: 'ws_active', role: 'OWNER' })
  mocks.userFindUnique.mockResolvedValue({ id: 'u1', email: 'owner@example.com', name: 'Owner' })
  mocks.subscriptionFindUnique.mockResolvedValue(FREE_SUB)
  mocks.createOrRetrieveCustomer.mockResolvedValue('cus_123')
  mocks.sessionsCreate.mockResolvedValue({ url: 'https://checkout.example/session' })
})

afterEach(() => {
  vi.unstubAllEnvs()
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  vi.clearAllMocks()
})

function expectNoStripe() {
  expect(mocks.createOrRetrieveCustomer).not.toHaveBeenCalled()
  expect(mocks.sessionsCreate).not.toHaveBeenCalled()
}

// ── Preview-only GMD certification fixtures ──────────────────────────────────

const GMD_ENV = {
  STRIPE_PRICE_SOLO_GMD:   'price_gmd_solo',
  STRIPE_PRICE_GROWTH_GMD: 'price_gmd_growth',
  STRIPE_PRICE_AGENCY_GMD: 'price_gmd_agency',
}
const GMD_AMOUNTS: Record<string, number> = {
  price_gmd_solo: 200_000, price_gmd_growth: 400_000, price_gmd_agency: 750_000,
}

// A correct Stripe Price for a configured GMD Price ID.
function stripeGmdPrice(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, active: true, currency: 'gmd', unit_amount: GMD_AMOUNTS[id], type: 'recurring',
    recurring: { interval: 'month', interval_count: 1 },
    ...overrides,
  }
}

// `null` = BILLING_PREVIEW_REGIONS unset (undefined would hit the default).
function previewWithGm(flag: string | null = 'GM') {
  vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('BILLING_PREVIEW_REGIONS', flag ?? undefined)
  Object.assign(process.env, GMD_ENV)
  mocks.pricesRetrieve.mockImplementation(async (id: string) => stripeGmdPrice(id))
}

// ── Preview-only XOF certification fixtures ──────────────────────────────────

const XOF_ENV = {
  STRIPE_PRICE_SOLO_XOF:   'price_xof_solo',
  STRIPE_PRICE_GROWTH_XOF: 'price_xof_growth',
  STRIPE_PRICE_AGENCY_XOF: 'price_xof_agency',
}
// XOF is zero-decimal: unit_amount is the whole-franc amount.
const XOF_AMOUNTS: Record<string, number> = {
  price_xof_solo: 15_000, price_xof_growth: 30_000, price_xof_agency: 55_000,
}

function stripeXofPrice(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, active: true, currency: 'xof', unit_amount: XOF_AMOUNTS[id], type: 'recurring',
    recurring: { interval: 'month', interval_count: 1 },
    ...overrides,
  }
}

// Each configured regional Price ID resolves to its own correct Stripe Price.
function stripeRegionalPrice(id: string) {
  return id in XOF_AMOUNTS ? stripeXofPrice(id) : stripeGmdPrice(id)
}

// `null` = BILLING_PREVIEW_REGIONS unset. GMD prices are configured too, so
// every XOF test also exercises the full multi-currency table.
function previewWithXof(flag: string | null = 'XOF_ZONE') {
  vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('BILLING_PREVIEW_REGIONS', flag ?? undefined)
  Object.assign(process.env, GMD_ENV, XOF_ENV)
  mocks.pricesRetrieve.mockImplementation(async (id: string) => stripeRegionalPrice(id))
}

describe('canonical { plan, region, currency } — USD', () => {
  it.each([
    ['SOLO',   'price_live_solo'],
    ['GROWTH', 'price_live_growth'],
    ['AGENCY', 'price_live_agency'],
  ])('Owner + FREE workspace + %s/GLOBAL/USD → checkout with the server-side Price', async (plan, priceId) => {
    const { status, data } = await call({ plan, region: 'GLOBAL', currency: 'USD' })
    expect(status).toBe(200)
    expect(data.url).toBe('https://checkout.example/session')
    expect(mocks.sessionsCreate).toHaveBeenCalledTimes(1)
    const args = mocks.sessionsCreate.mock.calls[0][0]
    expect(args.line_items).toEqual([{ price: priceId, quantity: 1 }])
    expect(args.mode).toBe('subscription')
    expect(args.customer).toBe('cus_123')
  })

  it('new *_USD env names are used when set', async () => {
    delete process.env.STRIPE_PRICE_AGENCY
    process.env.STRIPE_PRICE_AGENCY_USD = 'price_new_agency'
    const { status } = await call({ plan: 'AGENCY', region: 'GLOBAL', currency: 'USD' })
    expect(status).toBe(200)
    expect(mocks.sessionsCreate.mock.calls[0][0].line_items[0].price).toBe('price_new_agency')
  })
})

describe('success_url / cancel_url — exact trusted origin only', () => {
  const USD_SOLO = { plan: 'SOLO', region: 'GLOBAL', currency: 'USD' }

  function returnUrls() {
    expect(mocks.sessionsCreate).toHaveBeenCalledTimes(1)
    const { success_url, cancel_url } = mocks.sessionsCreate.mock.calls[0][0]
    return { success_url, cancel_url }
  }

  function preview() {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_URL', new URL(PREVIEW_ORIGIN).host)
    vi.stubEnv('VERCEL_BRANCH_URL', new URL(BRANCH_ORIGIN).host)
  }

  it('production → production domain', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NODE_ENV', 'production')
    expect((await call(USD_SOLO, PRODUCTION_ORIGIN)).status).toBe(200)
    expect(returnUrls()).toEqual({
      success_url: `${PRODUCTION_ORIGIN}/dashboard/billing?success=true`,
      cancel_url:  `${PRODUCTION_ORIGIN}/dashboard/billing`,
    })
  })

  it('NEXT_PUBLIC_APP_URL no longer decides the return origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example')
    await call(USD_SOLO, PRODUCTION_ORIGIN)
    expect(returnUrls().success_url).toBe(`${PRODUCTION_ORIGIN}/dashboard/billing?success=true`)
  })

  it('preview deployment URL → that exact deployment URL', async () => {
    preview()
    await call(USD_SOLO, PREVIEW_ORIGIN)
    expect(returnUrls()).toEqual({
      success_url: `${PREVIEW_ORIGIN}/dashboard/billing?success=true`,
      cancel_url:  `${PREVIEW_ORIGIN}/dashboard/billing`,
    })
  })

  it('preview branch URL → that exact branch URL', async () => {
    preview()
    await call(USD_SOLO, BRANCH_ORIGIN)
    expect(returnUrls()).toEqual({
      success_url: `${BRANCH_ORIGIN}/dashboard/billing?success=true`,
      cancel_url:  `${BRANCH_ORIGIN}/dashboard/billing`,
    })
  })

  it('localhost works in development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    await call(USD_SOLO, 'http://localhost:3000')
    expect(returnUrls()).toEqual({
      success_url: 'http://localhost:3000/dashboard/billing?success=true',
      cancel_url:  'http://localhost:3000/dashboard/billing',
    })
  })

  it('localhost outside development → production domain', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NODE_ENV', 'production')
    await call(USD_SOLO, 'http://localhost:3000')
    expect(returnUrls().cancel_url).toBe(`${PRODUCTION_ORIGIN}/dashboard/billing`)
  })

  it.each([
    'https://evil.example',
    'https://qbrdeck-other999-techtonits-7492s-projects.vercel.app',
    'https://attacker.vercel.app',
    `http://${new URL(PREVIEW_ORIGIN).host}`,
  ])('preview: untrusted origin %s → production domain', async origin => {
    preview()
    await call(USD_SOLO, origin)
    expect(returnUrls()).toEqual({
      success_url: `${PRODUCTION_ORIGIN}/dashboard/billing?success=true`,
      cancel_url:  `${PRODUCTION_ORIGIN}/dashboard/billing`,
    })
  })

  it('preview: malicious Origin header with a trusted Vercel host → that trusted host', async () => {
    preview()
    await call(USD_SOLO, { ...browserHeaders(PREVIEW_ORIGIN), origin: 'https://evil.example' })
    expect(returnUrls().success_url).toBe(`${PREVIEW_ORIGIN}/dashboard/billing?success=true`)
  })

  it('preview: malicious host and x-forwarded-host → production domain', async () => {
    preview()
    await call(USD_SOLO, { host: 'evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' })
    expect(returnUrls().cancel_url).toBe(`${PRODUCTION_ORIGIN}/dashboard/billing`)
  })

  it('preview: no origin headers at all → production domain', async () => {
    preview()
    await call(USD_SOLO, {})
    expect(returnUrls()).toEqual({
      success_url: `${PRODUCTION_ORIGIN}/dashboard/billing?success=true`,
      cancel_url:  `${PRODUCTION_ORIGIN}/dashboard/billing`,
    })
  })

  it('client-supplied success_url / cancel_url are rejected, never honoured', async () => {
    const { status } = await call({ ...USD_SOLO, success_url: 'https://evil.example', cancel_url: 'https://evil.example' })
    expect(status).toBe(400)
    expectNoStripe()
  })
})

describe('workspace isolation', () => {
  it('checkout is created for the authenticated ACTIVE workspace only', async () => {
    await call({ plan: 'GROWTH', region: 'GLOBAL', currency: 'USD' })
    expect(mocks.getWorkspaceMembership).toHaveBeenCalledWith('clerk_owner')
    expect(mocks.subscriptionFindUnique.mock.calls[0][0].where).toEqual({ workspaceId: 'ws_active' })
    expect(mocks.createOrRetrieveCustomer.mock.calls[0][0].workspaceId).toBe('ws_active')
    expect(mocks.sessionsCreate.mock.calls[0][0].metadata.workspaceId).toBe('ws_active')
  })

  it('a customer ownership conflict fails closed: 500, no checkout session', async () => {
    mocks.createOrRetrieveCustomer.mockRejectedValue(new Error('Billing account ownership conflict — contact support'))
    const { status, data } = await call({ plan: 'GROWTH', region: 'GLOBAL', currency: 'USD' })
    expect(status).toBe(500)
    expect(data.error).not.toMatch(/cus_|ws_/)
    expect(mocks.sessionsCreate).not.toHaveBeenCalled()
  })

  it('a workspaceId in the body is rejected, not honoured', async () => {
    const { status } = await call({ plan: 'GROWTH', region: 'GLOBAL', currency: 'USD', workspaceId: 'ws_other' })
    expect(status).toBe(400)
    expectNoStripe()
  })
})

describe('authorization', () => {
  it('unauthenticated → 401', async () => {
    mocks.auth.mockReturnValue({ userId: null })
    expect((await call({ plan: 'SOLO', region: 'GLOBAL', currency: 'USD' })).status).toBe(401)
    expectNoStripe()
  })

  it.each(['ADMIN', 'MEMBER', 'VIEWER'])('%s → 403', async role => {
    mocks.getWorkspaceMembership.mockResolvedValue({ workspaceId: 'ws_active', role })
    expect((await call({ plan: 'SOLO', region: 'GLOBAL', currency: 'USD' })).status).toBe(403)
    expectNoStripe()
  })
})

describe('request validation', () => {
  it.each([
    ['invalid plan',             { plan: 'ENTERPRISE', region: 'GLOBAL', currency: 'USD' }],
    ['FREE is not purchasable',  { plan: 'FREE', region: 'GLOBAL', currency: 'USD' }],
    ['invalid region',           { plan: 'SOLO', region: 'NG', currency: 'USD' }],
    ['invalid currency',         { plan: 'SOLO', region: 'GLOBAL', currency: 'EUR' }],
    ['region/currency mismatch', { plan: 'SOLO', region: 'GLOBAL', currency: 'GMD' }],
    ['GM/XOF mismatch',          { plan: 'SOLO', region: 'GM', currency: 'XOF' }],
    ['GMD disabled',             { plan: 'SOLO', region: 'GM', currency: 'GMD' }],
    ['XOF disabled',             { plan: 'AGENCY', region: 'XOF_ZONE', currency: 'XOF' }],
    ['arbitrary amount',         { plan: 'SOLO', region: 'GLOBAL', currency: 'USD', amount: 1 }],
    ['arbitrary unit_amount',    { plan: 'SOLO', region: 'GLOBAL', currency: 'USD', unit_amount: 100 }],
    ['priceId mixed with plan',  { plan: 'SOLO', region: 'GLOBAL', currency: 'USD', priceId: 'price_live_solo' }],
    ['arbitrary Stripe priceId', { priceId: 'price_attacker_cheap' }],
    ['non-string priceId',       { priceId: 123 }],
    ['empty body',               {}],
    ['null body',                null],
    ['array body',               ['SOLO']],
  ])('%s → 400, no Stripe call', async (_label, body) => {
    const { status } = await call(body)
    expect(status).toBe(400)
    expectNoStripe()
  })

  it('GMD/XOF stay rejected even when Price ID env vars are set', async () => {
    process.env.STRIPE_PRICE_SOLO_GMD = 'price_gmd_solo'
    process.env.STRIPE_PRICE_SOLO_XOF = 'price_xof_solo'
    expect((await call({ plan: 'SOLO', region: 'GM', currency: 'GMD' })).status).toBe(400)
    expect((await call({ plan: 'SOLO', region: 'XOF_ZONE', currency: 'XOF' })).status).toBe(400)
    expect((await call({ priceId: 'price_gmd_solo' })).status).toBe(400)
    expectNoStripe()
  })

  it('conflicting USD env config fails closed with 500 and no Stripe call', async () => {
    process.env.STRIPE_PRICE_SOLO_USD = 'price_different'
    expect((await call({ plan: 'SOLO', region: 'GLOBAL', currency: 'USD' })).status).toBe(500)
    expectNoStripe()
  })
})

describe('legacy { priceId } compatibility (transition release)', () => {
  it('accepts an exact configured USD Price ID', async () => {
    const { status } = await call({ priceId: 'price_live_growth' })
    expect(status).toBe(200)
    expect(mocks.sessionsCreate.mock.calls[0][0].line_items[0].price).toBe('price_live_growth')
  })

  it('rejects when that Price ID is no longer configured', async () => {
    delete process.env.STRIPE_PRICE_GROWTH
    expect((await call({ priceId: 'price_live_growth' })).status).toBe(400)
    expectNoStripe()
  })
})

describe('paid-subscription guard', () => {
  it('FREE workspace with a canceled former subscription may check out', async () => {
    mocks.subscriptionFindUnique.mockResolvedValue({ plan: 'FREE', status: 'canceled', stripeStatus: 'canceled', stripeSubscriptionId: null })
    expect((await call({ plan: 'SOLO', region: 'GLOBAL', currency: 'USD' })).status).toBe(200)
  })

  it('workspace with no subscription row may check out', async () => {
    mocks.subscriptionFindUnique.mockResolvedValue(null)
    expect((await call({ plan: 'SOLO', region: 'GLOBAL', currency: 'USD' })).status).toBe(200)
  })

  it.each(['SOLO', 'GROWTH', 'AGENCY'])('%s workspace → 409 before any Stripe call', async plan => {
    mocks.subscriptionFindUnique.mockResolvedValue({ plan, status: 'active', stripeStatus: 'active', stripeSubscriptionId: 'sub_1' })
    const { status, data } = await call({ plan: 'AGENCY', region: 'GLOBAL', currency: 'USD' })
    expect(status).toBe(409)
    expect(data.code).toBe('SUBSCRIPTION_EXISTS')
    expect(data.error).toMatch(/Manage Subscription/)
    expectNoStripe()
  })

  it('past_due paid workspace is also rejected', async () => {
    mocks.subscriptionFindUnique.mockResolvedValue({ plan: 'GROWTH', status: 'past_due', stripeStatus: 'past_due', stripeSubscriptionId: 'sub_1' })
    expect((await call({ plan: 'GROWTH', region: 'GLOBAL', currency: 'USD' })).status).toBe(409)
    expectNoStripe()
  })

  it('a live Stripe subscription is rejected even if the local plan reads FREE', async () => {
    mocks.subscriptionFindUnique.mockResolvedValue({ plan: 'FREE', status: 'active', stripeStatus: 'active', stripeSubscriptionId: 'sub_1' })
    expect((await call({ plan: 'SOLO', region: 'GLOBAL', currency: 'USD' })).status).toBe(409)
    expectNoStripe()
  })

  it('the legacy priceId path is guarded too', async () => {
    mocks.subscriptionFindUnique.mockResolvedValue({ plan: 'SOLO', status: 'active', stripeStatus: 'active', stripeSubscriptionId: 'sub_1' })
    expect((await call({ priceId: 'price_live_agency' })).status).toBe(409)
    expectNoStripe()
  })
})

describe('Preview-only GMD checkout (VERCEL_ENV=preview AND BILLING_PREVIEW_REGIONS=GM)', () => {
  const GM_SOLO   = { plan: 'SOLO',   region: 'GM', currency: 'GMD' }
  const GM_GROWTH = { plan: 'GROWTH', region: 'GM', currency: 'GMD' }

  function expectNoStripeAtAll() {
    expectNoStripe()
    expect(mocks.pricesRetrieve).not.toHaveBeenCalled()
  }

  it('A. Production rejects GM even with BILLING_PREVIEW_REGIONS=GM and all GMD prices set', async () => {
    previewWithGm()
    vi.stubEnv('VERCEL_ENV', 'production')
    expect((await call(GM_SOLO)).status).toBe(400)
    expectNoStripeAtAll()
  })

  it.each([null, ''])('B. Preview without the flag (%j) rejects GM', async (flag) => {
    previewWithGm(flag)
    expect((await call(GM_SOLO)).status).toBe(400)
    expectNoStripeAtAll()
  })

  it.each([undefined, 'development', 'staging', 'Preview'])('B. VERCEL_ENV=%j with the flag still rejects GM', async (vercelEnv) => {
    previewWithGm()
    vi.stubEnv('VERCEL_ENV', vercelEnv)
    expect((await call(GM_SOLO)).status).toBe(400)
    expectNoStripeAtAll()
  })

  it('C. Preview + flag + complete valid config accepts GM and creates a GMD session', async () => {
    previewWithGm()
    const { status, data } = await call(GM_GROWTH, browserHeaders(PREVIEW_ORIGIN))
    expect(status).toBe(200)
    expect(data.url).toBe('https://checkout.example/session')
    expect(mocks.pricesRetrieve).toHaveBeenCalledWith('price_gmd_growth')
    const session = mocks.sessionsCreate.mock.calls[0][0]
    expect(session.line_items).toEqual([{ price: 'price_gmd_growth', quantity: 1 }])
    expect(session.metadata).toMatchObject({ plan: 'GROWTH', region: 'GM', currency: 'GMD' })
  })

  it.each(['GM', 'XOF'])('D. flag %j does not enable XOF', async (flag) => {
    previewWithGm(flag)
    Object.assign(process.env, XOF_ENV)
    expect((await call({ plan: 'SOLO', region: 'XOF_ZONE', currency: 'XOF' })).status).toBe(400)
    expectNoStripeAtAll()
  })

  it.each(['gm', 'Gm', 'GMD', 'GAMBIA', '*', 'ALL', 'GLOBAL'])('E. unknown or inexact flag value %j does not enable GM', async (flag) => {
    previewWithGm(flag)
    expect((await call(GM_SOLO)).status).toBe(400)
    expectNoStripeAtAll()
  })

  it('E. flag parsing tolerates whitespace around exact codes', async () => {
    previewWithGm(' GLOBAL , GM ')
    expect((await call(GM_SOLO)).status).toBe(200)
  })

  it.each(['STRIPE_PRICE_SOLO_GMD', 'STRIPE_PRICE_GROWTH_GMD', 'STRIPE_PRICE_AGENCY_GMD'])(
    'F. missing %s rejects every GM plan, not just that one',
    async (missing) => {
      previewWithGm()
      delete process.env[missing]
      for (const plan of ['SOLO', 'GROWTH', 'AGENCY']) {
        expect((await call({ plan, region: 'GM', currency: 'GMD' })).status).toBe(400)
      }
      expectNoStripeAtAll()
    },
  )

  it('G. a GMD price duplicating a USD price fails closed (500) for GM and USD alike', async () => {
    previewWithGm()
    process.env.STRIPE_PRICE_GROWTH_GMD = 'price_live_growth'
    expect((await call(GM_GROWTH)).status).toBe(500)
    expect((await call({ plan: 'GROWTH', region: 'GLOBAL', currency: 'USD' })).status).toBe(500)
    expectNoStripeAtAll()
  })

  it('G. two GMD plans sharing one price fails closed (500)', async () => {
    previewWithGm()
    process.env.STRIPE_PRICE_AGENCY_GMD = 'price_gmd_solo'
    expect((await call(GM_SOLO)).status).toBe(500)
    expectNoStripeAtAll()
  })

  it.each([
    ['H. USD currency',        { currency: 'usd' }],
    ['I. wrong amount',        { unit_amount: 40_000 }],
    ['I. null amount',         { unit_amount: null }],
    ['J. inactive',            { active: false }],
    ['J. yearly interval',     { recurring: { interval: 'year', interval_count: 1 } }],
    ['J. every 3 months',      { recurring: { interval: 'month', interval_count: 3 } }],
    ['J. one-time price',      { type: 'one_time', recurring: null }],
  ])('%s on the Stripe Price → 500, no customer or session', async (_label, overrides) => {
    previewWithGm()
    mocks.pricesRetrieve.mockImplementation(async (id: string) => stripeGmdPrice(id, overrides))
    const { status, data } = await call(GM_GROWTH)
    expect(status).toBe(500)
    expect(data.error).toBe('Billing is temporarily unavailable')
    expect(mocks.pricesRetrieve).toHaveBeenCalledWith('price_gmd_growth')
    expectNoStripe()
  })

  it('J. a Stripe error retrieving the price fails closed', async () => {
    previewWithGm()
    mocks.pricesRetrieve.mockRejectedValue(Object.assign(new Error('No such price'), { code: 'resource_missing' }))
    expect((await call(GM_SOLO)).status).toBe(500)
    expectNoStripe()
  })

  it('K. paid USD workspace → 409 SUBSCRIPTION_EXISTS, no Stripe call of any kind', async () => {
    previewWithGm()
    mocks.subscriptionFindUnique.mockResolvedValue({ plan: 'GROWTH', status: 'active', stripeStatus: 'active', stripeSubscriptionId: 'sub_usd' })
    const { status, data } = await call(GM_SOLO)
    expect(status).toBe(409)
    expect(data.code).toBe('SUBSCRIPTION_EXISTS')
    expectNoStripeAtAll()
  })

  it('L. Free workspace → exactly one GMD Checkout Session', async () => {
    previewWithGm()
    mocks.subscriptionFindUnique.mockResolvedValue(FREE_SUB)
    expect((await call(GM_SOLO)).status).toBe(200)
    expect(mocks.createOrRetrieveCustomer).toHaveBeenCalledTimes(1)
    expect(mocks.sessionsCreate).toHaveBeenCalledTimes(1)
    expect(mocks.sessionsCreate.mock.calls[0][0].line_items[0].price).toBe('price_gmd_solo')
  })

  it('currency mismatches stay rejected in Preview', async () => {
    previewWithGm()
    expect((await call({ plan: 'SOLO', region: 'GM', currency: 'USD' })).status).toBe(400)
    expect((await call({ plan: 'SOLO', region: 'GLOBAL', currency: 'GMD' })).status).toBe(400)
    expectNoStripeAtAll()
  })

  it('the legacy { priceId } path never accepts a GMD price, even in Preview', async () => {
    previewWithGm()
    expect((await call({ priceId: 'price_gmd_solo' })).status).toBe(400)
    expectNoStripeAtAll()
  })

  it('USD checkout in Preview is unchanged: no Stripe price lookup', async () => {
    previewWithGm()
    expect((await call({ plan: 'SOLO', region: 'GLOBAL', currency: 'USD' })).status).toBe(200)
    expect(mocks.pricesRetrieve).not.toHaveBeenCalled()
    expect(mocks.sessionsCreate.mock.calls[0][0].line_items[0].price).toBe('price_live_solo')
  })
})

describe('Preview-only XOF checkout (VERCEL_ENV=preview AND BILLING_PREVIEW_REGIONS lists XOF_ZONE)', () => {
  const XOF_SOLO   = { plan: 'SOLO',   region: 'XOF_ZONE', currency: 'XOF' }
  const XOF_GROWTH = { plan: 'GROWTH', region: 'XOF_ZONE', currency: 'XOF' }
  const XOF_PLANS  = ['SOLO', 'GROWTH', 'AGENCY'].map(plan => ({ plan, region: 'XOF_ZONE', currency: 'XOF' }))

  function expectNoStripeAtAll() {
    expectNoStripe()
    expect(mocks.pricesRetrieve).not.toHaveBeenCalled()
  }

  it.each(['XOF_ZONE', 'GM,XOF_ZONE'])('A. Production rejects XOF with flag %j and all XOF prices set', async (flag) => {
    previewWithXof(flag)
    vi.stubEnv('VERCEL_ENV', 'production')
    for (const body of XOF_PLANS) expect((await call(body)).status).toBe(400)
    expectNoStripeAtAll()
  })

  it.each([null, '', 'GM'])('B. Preview with flag %j (no XOF_ZONE) rejects XOF', async (flag) => {
    previewWithXof(flag)
    for (const body of XOF_PLANS) expect((await call(body)).status).toBe(400)
    expectNoStripeAtAll()
  })

  it.each([undefined, 'development', 'staging', 'Preview'])('B. VERCEL_ENV=%j with XOF_ZONE still rejects XOF', async (vercelEnv) => {
    previewWithXof()
    vi.stubEnv('VERCEL_ENV', vercelEnv)
    expect((await call(XOF_SOLO)).status).toBe(400)
    expectNoStripeAtAll()
  })

  it.each([
    ['SOLO',   'price_xof_solo'],
    ['GROWTH', 'price_xof_growth'],
    ['AGENCY', 'price_xof_agency'],
  ])('C/S. Preview + XOF_ZONE + complete config accepts %s/XOF with XOF-only metadata', async (plan, priceId) => {
    previewWithXof()
    const { status, data } = await call({ plan, region: 'XOF_ZONE', currency: 'XOF' }, browserHeaders(PREVIEW_ORIGIN))
    expect(status).toBe(200)
    expect(data.url).toBe('https://checkout.example/session')
    expect(mocks.pricesRetrieve).toHaveBeenCalledTimes(1)
    expect(mocks.pricesRetrieve).toHaveBeenCalledWith(priceId)
    const session = mocks.sessionsCreate.mock.calls[0][0]
    expect(session.line_items).toEqual([{ price: priceId, quantity: 1 }])
    expect(session.metadata).toEqual({ workspaceId: 'ws_active', plan, region: 'XOF_ZONE', currency: 'XOF' })
  })

  it.each(['GM,XOF_ZONE', 'XOF_ZONE,GM'])('D. Preview + %j enables GMD and XOF, each with its own price; USD unchanged', async (flag) => {
    previewWithXof(flag)

    expect((await call({ plan: 'AGENCY', region: 'GM', currency: 'GMD' })).status).toBe(200)
    expect((await call({ plan: 'AGENCY', region: 'XOF_ZONE', currency: 'XOF' })).status).toBe(200)
    expect((await call({ plan: 'AGENCY', region: 'GLOBAL', currency: 'USD' })).status).toBe(200)

    const sessions = mocks.sessionsCreate.mock.calls.map(c => c[0])
    expect(sessions.map(s => s.line_items[0].price)).toEqual(['price_gmd_agency', 'price_xof_agency', 'price_live_agency'])
    expect(sessions.map(s => s.metadata.currency)).toEqual(['GMD', 'XOF', 'USD'])
    // Only the two regional prices are certified against Stripe; USD is not.
    expect(mocks.pricesRetrieve.mock.calls.map(c => c[0])).toEqual(['price_gmd_agency', 'price_xof_agency'])
  })

  it.each(['XOF', 'xof', 'xof_zone', 'Xof_Zone', 'XOF ZONE', 'XOF-ZONE', 'CFA', '*', 'ALL', 'GLOBAL', 'XOF_ZONE;GM'])(
    'E. unknown or inexact flag value %j does not enable XOF',
    async (flag) => {
      previewWithXof(flag)
      expect((await call(XOF_SOLO)).status).toBe(400)
      expectNoStripeAtAll()
    },
  )

  it('E. flag parsing tolerates whitespace around exact codes', async () => {
    previewWithXof(' GM , XOF_ZONE ')
    expect((await call(XOF_SOLO)).status).toBe(200)
  })

  it.each(Object.keys(XOF_ENV))('F. missing %s rejects every XOF plan, not just that one; GM still works', async (missing) => {
    previewWithXof('GM,XOF_ZONE')
    delete process.env[missing]
    for (const body of XOF_PLANS) expect((await call(body)).status).toBe(400)
    expectNoStripeAtAll()
    expect((await call({ plan: 'SOLO', region: 'GM', currency: 'GMD' })).status).toBe(200)
  })

  it('G. an XOF price duplicating a USD price fails closed (500) for XOF, GM and USD alike', async () => {
    previewWithXof('GM,XOF_ZONE')
    process.env.STRIPE_PRICE_GROWTH_XOF = 'price_live_growth'
    expect((await call(XOF_GROWTH)).status).toBe(500)
    expect((await call({ plan: 'GROWTH', region: 'GM', currency: 'GMD' })).status).toBe(500)
    expect((await call({ plan: 'GROWTH', region: 'GLOBAL', currency: 'USD' })).status).toBe(500)
    expectNoStripeAtAll()
  })

  it('H. an XOF price duplicating a GMD price fails closed (500) for XOF and GM alike', async () => {
    previewWithXof('GM,XOF_ZONE')
    process.env.STRIPE_PRICE_AGENCY_XOF = 'price_gmd_agency'
    expect((await call({ plan: 'AGENCY', region: 'XOF_ZONE', currency: 'XOF' })).status).toBe(500)
    expect((await call({ plan: 'AGENCY', region: 'GM', currency: 'GMD' })).status).toBe(500)
    expectNoStripeAtAll()
  })

  it('I. two XOF plans sharing one price fails closed (500)', async () => {
    previewWithXof()
    process.env.STRIPE_PRICE_AGENCY_XOF = 'price_xof_solo'
    expect((await call(XOF_SOLO)).status).toBe(500)
    expectNoStripeAtAll()
  })

  it.each([
    ['J. USD currency',              { currency: 'usd' }],
    ['J. GMD currency',              { currency: 'gmd' }],
    ['J. uppercase XOF currency',    { currency: 'XOF' }],
    ['K. ×100 amount (3,000,000)',   { unit_amount: 3_000_000 }],
    ['L. wrong amount (30,001)',     { unit_amount: 30_001 }],
    ['L. Solo amount on Growth',     { unit_amount: 15_000 }],
    ['L. null amount',               { unit_amount: null }],
    ['M. inactive',                  { active: false }],
    ['N. yearly interval',           { recurring: { interval: 'year', interval_count: 1 } }],
    ['N. weekly interval',           { recurring: { interval: 'week', interval_count: 1 } }],
    ['N. every 3 months',            { recurring: { interval: 'month', interval_count: 3 } }],
    ['O. one-time price',            { type: 'one_time', recurring: null }],
  ])('%s on the XOF Stripe Price → 500, no customer or session', async (_label, overrides) => {
    previewWithXof()
    mocks.pricesRetrieve.mockImplementation(async (id: string) => stripeXofPrice(id, overrides))
    const { status, data } = await call(XOF_GROWTH)
    expect(status).toBe(500)
    expect(data.error).toBe('Billing is temporarily unavailable')
    expect(mocks.pricesRetrieve).toHaveBeenCalledWith('price_xof_growth')
    expectNoStripe()
  })

  it('P. a Stripe error retrieving the XOF price fails closed', async () => {
    previewWithXof()
    mocks.pricesRetrieve.mockRejectedValue(Object.assign(new Error('No such price'), { code: 'resource_missing' }))
    const { status, data } = await call(XOF_SOLO)
    expect(status).toBe(500)
    expect(data.error).toBe('Billing is temporarily unavailable')
    expectNoStripe()
  })

  it.each([
    ['paid USD Growth', { plan: 'GROWTH', status: 'active',   stripeStatus: 'active',   stripeSubscriptionId: 'sub_usd' }],
    ['paid GMD Agency', { plan: 'AGENCY', status: 'active',   stripeStatus: 'active',   stripeSubscriptionId: 'sub_gmd' }],
    ['paid XOF Solo',   { plan: 'SOLO',   status: 'active',   stripeStatus: 'active',   stripeSubscriptionId: 'sub_xof' }],
    ['past_due XOF',    { plan: 'SOLO',   status: 'past_due', stripeStatus: 'past_due', stripeSubscriptionId: 'sub_xof' }],
  ])('Q. %s workspace → 409 SUBSCRIPTION_EXISTS for XOF, no Stripe call of any kind', async (_label, sub) => {
    previewWithXof('GM,XOF_ZONE')
    mocks.subscriptionFindUnique.mockResolvedValue(sub)
    const { status, data } = await call(XOF_SOLO)
    expect(status).toBe(409)
    expect(data.code).toBe('SUBSCRIPTION_EXISTS')
    expectNoStripeAtAll()
  })

  it('R. Free workspace → exactly one XOF Checkout Session', async () => {
    previewWithXof('GM,XOF_ZONE')
    mocks.subscriptionFindUnique.mockResolvedValue(FREE_SUB)
    expect((await call(XOF_SOLO)).status).toBe(200)
    expect(mocks.createOrRetrieveCustomer).toHaveBeenCalledTimes(1)
    expect(mocks.createOrRetrieveCustomer).toHaveBeenCalledWith({ workspaceId: 'ws_active', email: 'owner@example.com', name: 'Owner' })
    expect(mocks.sessionsCreate).toHaveBeenCalledTimes(1)
    expect(mocks.sessionsCreate.mock.calls[0][0].line_items).toEqual([{ price: 'price_xof_solo', quantity: 1 }])
  })

  it('currency mismatches stay rejected with XOF enabled', async () => {
    previewWithXof('GM,XOF_ZONE')
    expect((await call({ plan: 'SOLO', region: 'XOF_ZONE', currency: 'USD' })).status).toBe(400)
    expect((await call({ plan: 'SOLO', region: 'XOF_ZONE', currency: 'GMD' })).status).toBe(400)
    expect((await call({ plan: 'SOLO', region: 'GM',       currency: 'XOF' })).status).toBe(400)
    expect((await call({ plan: 'SOLO', region: 'GLOBAL',   currency: 'XOF' })).status).toBe(400)
    expectNoStripeAtAll()
  })

  it('the legacy { priceId } path never accepts an XOF price, even with XOF enabled', async () => {
    previewWithXof()
    expect((await call({ priceId: 'price_xof_solo' })).status).toBe(400)
    expectNoStripeAtAll()
  })

  it('client-supplied amount or price fields are rejected for XOF', async () => {
    previewWithXof()
    expect((await call({ ...XOF_SOLO, amount: 1 })).status).toBe(400)
    expect((await call({ ...XOF_SOLO, unit_amount: 1 })).status).toBe(400)
    expect((await call({ ...XOF_SOLO, priceId: 'price_xof_solo' })).status).toBe(400)
    expectNoStripeAtAll()
  })
})

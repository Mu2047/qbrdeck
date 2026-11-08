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
  stripe: { checkout: { sessions: { create: mocks.sessionsCreate } } },
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

function request(body: unknown, origin = PRODUCTION_ORIGIN) {
  const url = `${origin}/api/billing/checkout`
  return { json: async () => body, url, nextUrl: new URL(url) } as any
}

async function call(body: unknown, origin?: string) {
  const res  = await POST(request(body, origin))
  return { status: res.status, data: await res.json() }
}

beforeEach(() => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k] }
  Object.assign(process.env, PRICE_ENV)
  vi.stubEnv('VERCEL_ENV', undefined)
  vi.stubEnv('VERCEL_URL', undefined)
  vi.stubEnv('VERCEL_BRANCH_URL', undefined)

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
  ])('preview: untrusted origin %s → production domain', async origin => {
    preview()
    await call(USD_SOLO, origin)
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

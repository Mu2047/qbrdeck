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

function request(body: unknown) {
  return { json: async () => body } as any
}

async function call(body: unknown) {
  const res  = await POST(request(body))
  return { status: res.status, data: await res.json() }
}

beforeEach(() => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k] }
  Object.assign(process.env, PRICE_ENV)

  mocks.auth.mockReturnValue({ userId: 'clerk_owner' })
  mocks.getWorkspaceMembership.mockResolvedValue({ workspaceId: 'ws_active', role: 'OWNER' })
  mocks.userFindUnique.mockResolvedValue({ id: 'u1', email: 'owner@example.com', name: 'Owner' })
  mocks.subscriptionFindUnique.mockResolvedValue(FREE_SUB)
  mocks.createOrRetrieveCustomer.mockResolvedValue('cus_123')
  mocks.sessionsCreate.mockResolvedValue({ url: 'https://checkout.example/session' })
})

afterEach(() => {
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

describe('workspace isolation', () => {
  it('checkout is created for the authenticated ACTIVE workspace only', async () => {
    await call({ plan: 'GROWTH', region: 'GLOBAL', currency: 'USD' })
    expect(mocks.getWorkspaceMembership).toHaveBeenCalledWith('clerk_owner')
    expect(mocks.subscriptionFindUnique.mock.calls[0][0].where).toEqual({ workspaceId: 'ws_active' })
    expect(mocks.createOrRetrieveCustomer.mock.calls[0][0].workspaceId).toBe('ws_active')
    expect(mocks.sessionsCreate.mock.calls[0][0].metadata.workspaceId).toBe('ws_active')
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

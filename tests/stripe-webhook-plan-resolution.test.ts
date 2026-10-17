import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// EXECUTABLE tests for the Stripe webhook's plan resolution. The Stripe client
// (signature verification, subscription/customer retrieval) and Prisma are
// mocked — no database connection, no Stripe call, no real subscription.

const mocks = vi.hoisted(() => ({
  constructEvent:         vi.fn(),
  subscriptionsRetrieve:  vi.fn(),
  customersRetrieve:      vi.fn(),
  stripeEventFindUnique:  vi.fn(),
  stripeEventUpsert:      vi.fn(),
  stripeEventUpdate:      vi.fn(),
  subscriptionFindUnique: vi.fn(),
  subscriptionUpdate:     vi.fn(),
  subscriptionUpsert:     vi.fn(),
}))

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks:      { constructEvent: mocks.constructEvent },
    subscriptions: { retrieve: mocks.subscriptionsRetrieve },
    customers:     { retrieve: mocks.customersRetrieve },
  },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    stripeEvent:  { findUnique: mocks.stripeEventFindUnique, upsert: mocks.stripeEventUpsert, update: mocks.stripeEventUpdate },
    subscription: { findUnique: mocks.subscriptionFindUnique, update: mocks.subscriptionUpdate, upsert: mocks.subscriptionUpsert },
  },
}))

import { POST } from '@/app/api/webhooks/stripe/route'

const PRICE_ENV = {
  STRIPE_PRICE_SOLO:   'price_live_solo',
  STRIPE_PRICE_GROWTH: 'price_live_growth',
  STRIPE_PRICE_AGENCY: 'price_live_agency',
}
const savedEnv: Record<string, string | undefined> = {}

function subscription(priceId: string | undefined, status = 'active') {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status,
    cancel_at_period_end: false,
    current_period_start: 1_700_000_000,
    current_period_end:   1_702_592_000,
    items: { data: priceId ? [{ price: { id: priceId } }] : [] },
  }
}

function deliver(event: { id: string; type: string; object: unknown }) {
  mocks.constructEvent.mockReturnValue({ id: event.id, type: event.type, data: { object: event.object } })
  const req = { text: async () => '{}', headers: { get: () => 'sig' } } as any
  return POST(req)
}

function lastEventStatus() {
  return mocks.stripeEventUpdate.mock.calls.at(-1)?.[0].data.status
}

beforeEach(() => {
  for (const k of Object.keys(PRICE_ENV)) savedEnv[k] = process.env[k]
  Object.assign(process.env, PRICE_ENV)
  mocks.stripeEventFindUnique.mockResolvedValue(null)
  mocks.subscriptionFindUnique.mockImplementation(async ({ where }: any) =>
    where.stripeCustomerId ? { workspaceId: 'ws_1' } : { periodStart: new Date(0), stripeCurrentPeriodStart: new Date(0), pastDueAt: null }
  )
})

afterEach(() => {
  for (const k of Object.keys(PRICE_ENV)) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  vi.clearAllMocks()
})

describe('recognized USD Price IDs map to their plan', () => {
  it.each([
    ['price_live_solo',   'SOLO'],
    ['price_live_growth', 'GROWTH'],
    ['price_live_agency', 'AGENCY'],
  ])('customer.subscription.updated with %s → %s', async (priceId, plan) => {
    const res = await deliver({ id: `evt_${plan}`, type: 'customer.subscription.updated', object: subscription(priceId) })
    expect(res.status).toBe(200)
    expect(mocks.subscriptionUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.subscriptionUpdate.mock.calls[0][0].data.plan).toBe(plan)
    expect(lastEventStatus()).toBe('PROCESSED')
  })

  it('checkout.session.completed with the Agency price writes AGENCY', async () => {
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription('price_live_agency'))
    const res = await deliver({
      id: 'evt_co', type: 'checkout.session.completed',
      object: { customer: 'cus_1', subscription: 'sub_1', metadata: { workspaceId: 'ws_1' } },
    })
    expect(res.status).toBe(200)
    expect(mocks.subscriptionUpsert.mock.calls[0][0].update.plan).toBe('AGENCY')
  })
})

describe('unknown Price ID fails closed — no FREE downgrade', () => {
  it('customer.subscription.updated: event FAILED, 500 for Stripe retry, Subscription untouched', async () => {
    const res = await deliver({ id: 'evt_unknown', type: 'customer.subscription.updated', object: subscription('price_not_configured') })
    expect(res.status).toBe(500)
    expect(lastEventStatus()).toBe('FAILED')
    expect(mocks.stripeEventUpdate.mock.calls.at(-1)?.[0].data.errorMessage).toMatch(/Unrecognized Stripe Price ID/)
    expect(mocks.subscriptionUpdate).not.toHaveBeenCalled()
    expect(mocks.subscriptionUpsert).not.toHaveBeenCalled()
  })

  it('customer.subscription.created: same fail-closed behavior', async () => {
    const res = await deliver({ id: 'evt_unknown_c', type: 'customer.subscription.created', object: subscription('price_not_configured') })
    expect(res.status).toBe(500)
    expect(mocks.subscriptionUpdate).not.toHaveBeenCalled()
  })

  it('checkout.session.completed: no upsert, no FREE row', async () => {
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription('price_not_configured'))
    const res = await deliver({
      id: 'evt_co_unknown', type: 'checkout.session.completed',
      object: { customer: 'cus_1', subscription: 'sub_1', metadata: { workspaceId: 'ws_1' } },
    })
    expect(res.status).toBe(500)
    expect(lastEventStatus()).toBe('FAILED')
    expect(mocks.subscriptionUpsert).not.toHaveBeenCalled()
  })

  it('a subscription with no Price is also refused rather than written as FREE', async () => {
    const res = await deliver({ id: 'evt_noprice', type: 'customer.subscription.updated', object: subscription(undefined) })
    expect(res.status).toBe(500)
    expect(mocks.subscriptionUpdate).not.toHaveBeenCalled()
  })

  it('a removed Price env var makes its ID unknown — fail closed, not FREE', async () => {
    delete process.env.STRIPE_PRICE_GROWTH
    const res = await deliver({ id: 'evt_removed', type: 'customer.subscription.updated', object: subscription('price_live_growth') })
    expect(res.status).toBe(500)
    expect(mocks.subscriptionUpdate).not.toHaveBeenCalled()
  })

  it('a FAILED event is retried and succeeds once the Price is configured', async () => {
    mocks.stripeEventFindUnique.mockResolvedValue({ status: 'FAILED' })
    const res = await deliver({ id: 'evt_retry', type: 'customer.subscription.updated', object: subscription('price_live_solo') })
    expect(res.status).toBe(200)
    expect(mocks.subscriptionUpdate.mock.calls[0][0].data.plan).toBe('SOLO')
  })
})

describe('lifecycle paths unchanged', () => {
  it('customer.subscription.deleted still returns the workspace to FREE regardless of price', async () => {
    const res = await deliver({ id: 'evt_del', type: 'customer.subscription.deleted', object: subscription('price_not_configured', 'canceled') })
    expect(res.status).toBe(200)
    const data = mocks.subscriptionUpdate.mock.calls[0][0].data
    expect(data.plan).toBe('FREE')
    expect(data.stripeSubscriptionId).toBeNull()
    expect(data.stripePriceId).toBeNull()
  })

  it('invoice.paid does not touch plan, so an unknown price cannot downgrade there either', async () => {
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription('price_not_configured'))
    const res = await deliver({ id: 'evt_inv', type: 'invoice.paid', object: { customer: 'cus_1', subscription: 'sub_1' } })
    expect(res.status).toBe(200)
    expect(mocks.subscriptionUpdate.mock.calls[0][0].data).not.toHaveProperty('plan')
  })

  it('an already-PROCESSED event is acknowledged idempotently without re-processing', async () => {
    mocks.stripeEventFindUnique.mockResolvedValue({ status: 'PROCESSED' })
    const res = await deliver({ id: 'evt_dup', type: 'customer.subscription.updated', object: subscription('price_live_solo') })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true, idempotent: true })
    expect(mocks.subscriptionUpdate).not.toHaveBeenCalled()
  })

  it('an in-flight PROCESSING event is not processed twice', async () => {
    mocks.stripeEventFindUnique.mockResolvedValue({ status: 'PROCESSING' })
    const res = await deliver({ id: 'evt_busy', type: 'customer.subscription.updated', object: subscription('price_live_solo') })
    expect(await res.json()).toEqual({ received: true, processing: true })
    expect(mocks.subscriptionUpdate).not.toHaveBeenCalled()
  })
})

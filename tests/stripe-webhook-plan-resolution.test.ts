import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// EXECUTABLE tests for the Stripe webhook's plan resolution and subscription
// authority. The Stripe client (signature verification, subscription/customer
// retrieval, subscription listing), Prisma and Resend are mocked — no database
// connection, no Stripe call, no real subscription, no email.
//
// Prisma's Subscription row is a small in-memory object (`stored`) so the
// conditional updateMany guard behaves as it would against a real row.

const mocks = vi.hoisted(() => ({
  constructEvent:         vi.fn(),
  subscriptionsRetrieve:  vi.fn(),
  subscriptionsList:      vi.fn(),
  customersRetrieve:      vi.fn(),
  stripeEventFindUnique:  vi.fn(),
  stripeEventUpsert:      vi.fn(),
  stripeEventUpdate:      vi.fn(),
  subscriptionFindUnique: vi.fn(),
  subscriptionUpdate:     vi.fn(),
  subscriptionUpsert:     vi.fn(),
  subscriptionUpdateMany: vi.fn(),
  subscriptionCreate:     vi.fn(),
  workspaceFindUnique:    vi.fn(),
  resendSend:             vi.fn(),
}))

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks:      { constructEvent: mocks.constructEvent },
    subscriptions: { retrieve: mocks.subscriptionsRetrieve, list: mocks.subscriptionsList },
    customers:     { retrieve: mocks.customersRetrieve },
  },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    stripeEvent:  { findUnique: mocks.stripeEventFindUnique, upsert: mocks.stripeEventUpsert, update: mocks.stripeEventUpdate },
    subscription: {
      findUnique: mocks.subscriptionFindUnique,
      update:     mocks.subscriptionUpdate,
      upsert:     mocks.subscriptionUpsert,
      updateMany: mocks.subscriptionUpdateMany,
      create:     mocks.subscriptionCreate,
    },
    workspace:    { findUnique: mocks.workspaceFindUnique },
  },
}))
vi.mock('resend', () => ({
  Resend: class { emails = { send: mocks.resendSend } },
}))

import { POST } from '@/app/api/webhooks/stripe/route'
import { PAYMENT_GRACE_PERIOD_DAYS, hasPaidAccess, type SubscriptionAccess } from '@/lib/subscription-access'
import type { InvoiceParent } from '@/lib/stripe-invoice-subscription'
import type Stripe from 'stripe'

const PRICE_ENV = {
  STRIPE_PRICE_SOLO:   'price_live_solo',
  STRIPE_PRICE_GROWTH: 'price_live_growth',
  STRIPE_PRICE_AGENCY: 'price_live_agency',
}
const savedEnv: Record<string, string | undefined> = {}

// The production incident's real ids.
const SUB_OLD = 'sub_1UZNcSQZ9Ibszi22hK56jixU'
const SUB_NEW = 'sub_1UZRvUQZ9Ibszi22uB2F0BbR'

function subscription(
  priceId: string | undefined,
  status = 'active',
  overrides: { id?: string; created?: number; cancel_at_period_end?: boolean } = {},
) {
  return {
    id:       overrides.id ?? 'sub_1',
    customer: 'cus_1',
    status,
    created:  overrides.created ?? 1_690_000_000,
    cancel_at_period_end: overrides.cancel_at_period_end ?? false,
    current_period_start: 1_700_000_000,
    current_period_end:   1_702_592_000,
    items: { data: priceId ? [{ price: { id: priceId } }] : [] },
  }
}

// Stripe's CURRENT state, keyed by subscription id. Takes precedence over
// any webhook payload, which is what the handlers re-fetch.
let stripeState: Map<string, any>
// The workspace's Subscription row (null = no row).
let stored: Record<string, any> | null

function storedRow(overrides: Record<string, any> = {}) {
  return {
    workspaceId: 'ws_1', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1',
    plan: 'SOLO', status: 'active', stripeStatus: 'active', qbrCount: 3, exportCount: 1,
    periodStart: new Date(0), stripeCurrentPeriodStart: new Date(0), pastDueAt: null, graceEndsAt: null,
    ...overrides,
  }
}

function deliver(event: { id: string; type: string; object: any }) {
  const obj = event.object
  if (typeof obj?.id === 'string' && obj.id.startsWith('sub_') && !stripeState.has(obj.id)) {
    stripeState.set(obj.id, obj)
  }
  mocks.constructEvent.mockReturnValue({ id: event.id, type: event.type, data: { object: obj } })
  const req = { text: async () => '{}', headers: { get: () => 'sig' } } as any
  return POST(req)
}

function lastEventStatus() {
  return mocks.stripeEventUpdate.mock.calls.at(-1)?.[0].data.status
}

function writes() {
  return mocks.subscriptionUpdateMany.mock.calls.map(c => c[0])
}

// No Subscription write through ANY Prisma method — so a regression to an
// unconditional update/upsert cannot pass these tests vacuously.
function expectNoSubscriptionWrite() {
  expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled()
  expect(mocks.subscriptionUpdate).not.toHaveBeenCalled()
  expect(mocks.subscriptionUpsert).not.toHaveBeenCalled()
  expect(mocks.subscriptionCreate).not.toHaveBeenCalled()
}

beforeEach(() => {
  for (const k of Object.keys(PRICE_ENV)) savedEnv[k] = process.env[k]
  Object.assign(process.env, PRICE_ENV)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})

  stripeState = new Map()
  stored = storedRow()

  mocks.stripeEventFindUnique.mockResolvedValue(null)
  mocks.subscriptionFindUnique.mockImplementation(async ({ where }: any) => {
    if (where.stripeCustomerId) return stored ? { workspaceId: stored.workspaceId } : { workspaceId: 'ws_1' }
    return stored ? { ...stored } : null
  })
  mocks.subscriptionUpdateMany.mockImplementation(async ({ where, data }: any) => {
    if (!stored || stored.workspaceId !== where.workspaceId) return { count: 0 }
    if ((stored.stripeSubscriptionId ?? null) !== (where.stripeSubscriptionId ?? null)) return { count: 0 }
    stored = { ...stored, ...data }
    return { count: 1 }
  })
  mocks.subscriptionCreate.mockImplementation(async ({ data }: any) => { stored = { ...data }; return stored })
  mocks.subscriptionsRetrieve.mockImplementation(async (id: string) => {
    const sub = stripeState.get(id)
    if (!sub) throw Object.assign(new Error(`No such subscription: '${id}'`), { code: 'resource_missing', statusCode: 404 })
    return sub
  })
  mocks.subscriptionsList.mockResolvedValue({ data: [], has_more: false })
  mocks.workspaceFindUnique.mockResolvedValue({ members: [{ user: { email: 'owner@example.com' } }] })
  mocks.resendSend.mockResolvedValue({})
})

afterEach(() => {
  for (const k of Object.keys(PRICE_ENV)) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('recognized USD Price IDs map to their plan', () => {
  it.each([
    ['price_live_solo',   'SOLO'],
    ['price_live_growth', 'GROWTH'],
    ['price_live_agency', 'AGENCY'],
  ])('customer.subscription.updated with %s → %s', async (priceId, plan) => {
    const res = await deliver({ id: `evt_${plan}`, type: 'customer.subscription.updated', object: subscription(priceId) })
    expect(res.status).toBe(200)
    expect(mocks.subscriptionUpdateMany).toHaveBeenCalledTimes(1)
    expect(writes()[0].data.plan).toBe(plan)
    expect(lastEventStatus()).toBe('PROCESSED')
  })

  it('checkout.session.completed with the Agency price writes AGENCY', async () => {
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription('price_live_agency'))
    const res = await deliver({
      id: 'evt_co', type: 'checkout.session.completed',
      object: { customer: 'cus_1', subscription: 'sub_1', metadata: { workspaceId: 'ws_1' } },
    })
    expect(res.status).toBe(200)
    expect(writes()[0].data.plan).toBe('AGENCY')
  })

  it('checkout.session.completed with no existing row creates it with fresh usage', async () => {
    stored = null
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription('price_live_growth'))
    const res = await deliver({
      id: 'evt_co_new', type: 'checkout.session.completed',
      object: { customer: 'cus_1', subscription: 'sub_1', metadata: { workspaceId: 'ws_1' } },
    })
    expect(res.status).toBe(200)
    const data = mocks.subscriptionCreate.mock.calls[0][0].data
    expect(data).toMatchObject({ workspaceId: 'ws_1', plan: 'GROWTH', stripeSubscriptionId: 'sub_1', qbrCount: 0, exportCount: 0, exportedQbrIds: '[]' })
    expect(mocks.subscriptionUpsert).not.toHaveBeenCalled()
  })
})

describe('unknown Price ID fails closed — no FREE downgrade', () => {
  it('customer.subscription.updated: event FAILED, 500 for Stripe retry, Subscription untouched', async () => {
    const res = await deliver({ id: 'evt_unknown', type: 'customer.subscription.updated', object: subscription('price_not_configured') })
    expect(res.status).toBe(500)
    expect(lastEventStatus()).toBe('FAILED')
    expect(mocks.stripeEventUpdate.mock.calls.at(-1)?.[0].data.errorMessage).toMatch(/Unrecognized Stripe Price ID/)
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled()
    expect(mocks.subscriptionUpdate).not.toHaveBeenCalled()
    expect(mocks.subscriptionUpsert).not.toHaveBeenCalled()
  })

  it('customer.subscription.created: same fail-closed behavior', async () => {
    const res = await deliver({ id: 'evt_unknown_c', type: 'customer.subscription.created', object: subscription('price_not_configured') })
    expect(res.status).toBe(500)
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled()
  })

  it('checkout.session.completed: no write, no FREE row', async () => {
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription('price_not_configured'))
    const res = await deliver({
      id: 'evt_co_unknown', type: 'checkout.session.completed',
      object: { customer: 'cus_1', subscription: 'sub_1', metadata: { workspaceId: 'ws_1' } },
    })
    expect(res.status).toBe(500)
    expect(lastEventStatus()).toBe('FAILED')
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled()
    expect(mocks.subscriptionCreate).not.toHaveBeenCalled()
    expect(mocks.subscriptionUpsert).not.toHaveBeenCalled()
  })

  it('a subscription with no Price is also refused rather than written as FREE', async () => {
    const res = await deliver({ id: 'evt_noprice', type: 'customer.subscription.updated', object: subscription(undefined) })
    expect(res.status).toBe(500)
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled()
  })

  it('a removed Price env var makes its ID unknown — fail closed, not FREE', async () => {
    delete process.env.STRIPE_PRICE_GROWTH
    const res = await deliver({ id: 'evt_removed', type: 'customer.subscription.updated', object: subscription('price_live_growth') })
    expect(res.status).toBe(500)
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled()
  })

  it('a FAILED event is retried and succeeds once the Price is configured', async () => {
    mocks.stripeEventFindUnique.mockResolvedValue({ status: 'FAILED' })
    const res = await deliver({ id: 'evt_retry', type: 'customer.subscription.updated', object: subscription('price_live_solo') })
    expect(res.status).toBe(200)
    expect(writes()[0].data.plan).toBe('SOLO')
  })
})

describe('lifecycle paths unchanged', () => {
  it('customer.subscription.deleted still returns the workspace to FREE regardless of price', async () => {
    const res = await deliver({ id: 'evt_del', type: 'customer.subscription.deleted', object: subscription('price_not_configured', 'canceled') })
    expect(res.status).toBe(200)
    const data = writes()[0].data
    expect(data.plan).toBe('FREE')
    expect(data.status).toBe('canceled')
    expect(data.stripeStatus).toBe('canceled')
    expect(data.stripeSubscriptionId).toBeNull()
    expect(data.cancelAtPeriodEnd).toBe(false)
    // Last recognized Price is retained as billing history (portal currency),
    // and the deleted subscription's own Price is never written.
    expect(data).not.toHaveProperty('stripePriceId')
  })

  it('invoice.paid does not touch plan, so an unknown price cannot downgrade there either', async () => {
    mocks.subscriptionsRetrieve.mockResolvedValue(subscription('price_not_configured'))
    const res = await deliver({ id: 'evt_inv', type: 'invoice.paid', object: { customer: 'cus_1', subscription: 'sub_1' } })
    expect(res.status).toBe(200)
    expect(writes()[0].data).not.toHaveProperty('plan')
  })

  it('an already-PROCESSED event is acknowledged idempotently without re-processing', async () => {
    mocks.stripeEventFindUnique.mockResolvedValue({ status: 'PROCESSED' })
    const res = await deliver({ id: 'evt_dup', type: 'customer.subscription.updated', object: subscription('price_live_solo') })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true, idempotent: true })
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled()
  })

  it('an in-flight PROCESSING event is not processed twice', async () => {
    mocks.stripeEventFindUnique.mockResolvedValue({ status: 'PROCESSING' })
    const res = await deliver({ id: 'evt_busy', type: 'customer.subscription.updated', object: subscription('price_live_solo') })
    expect(await res.json()).toEqual({ received: true, processing: true })
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled()
  })
})

describe('stale / out-of-order subscription events — subscription authority', () => {
  it('A. stale delete for the old subscription does not downgrade the newer one (production incident)', async () => {
    stored = storedRow({ stripeSubscriptionId: SUB_NEW, plan: 'GROWTH' })
    const res = await deliver({
      id: 'evt_old_deleted', type: 'customer.subscription.deleted',
      object: subscription('price_live_growth', 'canceled', { id: SUB_OLD }),
    })
    expect(res.status).toBe(200)
    expect(lastEventStatus()).toBe('PROCESSED')   // acknowledged — Stripe stops retrying
    expectNoSubscriptionWrite()
    expect(mocks.subscriptionsList).not.toHaveBeenCalled()
    expect(stored).toMatchObject({ stripeSubscriptionId: SUB_NEW, plan: 'GROWTH' })
  })

  it('B. deleting the current subscription with no replacement → FREE, guarded on the current id', async () => {
    const res = await deliver({ id: 'evt_del_cur', type: 'customer.subscription.deleted', object: subscription('price_live_solo', 'canceled') })
    expect(res.status).toBe(200)
    expect(mocks.subscriptionsList).toHaveBeenCalledWith({ customer: 'cus_1', limit: 100 })
    expect(writes()).toHaveLength(1)
    expect(writes()[0].where).toEqual({ workspaceId: 'ws_1', stripeSubscriptionId: 'sub_1' })
    expect(writes()[0].data).toMatchObject({ plan: 'FREE', status: 'canceled', stripeStatus: 'canceled', stripeSubscriptionId: null })
    expect(writes()[0].data).not.toHaveProperty('stripePriceId')
    expect(stored).toMatchObject({ plan: 'FREE', stripeSubscriptionId: null })
  })

  it('C. duplicate delete: same event id is idempotent; a new event id for the same subscription changes nothing', async () => {
    const del = subscription('price_live_solo', 'canceled')
    await deliver({ id: 'evt_del_1', type: 'customer.subscription.deleted', object: del })
    expect(stored).toMatchObject({ plan: 'FREE', stripeSubscriptionId: null })

    mocks.stripeEventFindUnique.mockResolvedValueOnce({ status: 'PROCESSED' })
    const same = await deliver({ id: 'evt_del_1', type: 'customer.subscription.deleted', object: del })
    expect(await same.json()).toEqual({ received: true, idempotent: true })

    const other = await deliver({ id: 'evt_del_2', type: 'customer.subscription.deleted', object: del })
    expect(other.status).toBe(200)
    expect(lastEventStatus()).toBe('PROCESSED')
    expect(mocks.subscriptionUpdateMany).toHaveBeenCalledTimes(1)
    expect(mocks.subscriptionsList).toHaveBeenCalledTimes(1)
  })

  it('D. stale payload for the current subscription → fresh Stripe state is written', async () => {
    stripeState.set('sub_1', subscription('price_live_growth', 'active', { cancel_at_period_end: false }))
    const res = await deliver({
      id: 'evt_stale_payload', type: 'customer.subscription.updated',
      object: subscription('price_live_solo', 'active', { cancel_at_period_end: true }),
    })
    expect(res.status).toBe(200)
    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith('sub_1')
    expect(writes()[0].data).toMatchObject({ plan: 'GROWTH', cancelAtPeriodEnd: false })
  })

  it('E. old subscription.updated while old AND new are both active → newer stored subscription stays authoritative', async () => {
    stored = storedRow({ stripeSubscriptionId: SUB_NEW, plan: 'GROWTH' })
    stripeState.set(SUB_NEW, subscription('price_live_growth', 'active', { id: SUB_NEW, created: 2000 }))
    stripeState.set(SUB_OLD, subscription('price_live_solo',   'active', { id: SUB_OLD, created: 1000 }))

    const res = await deliver({ id: 'evt_old_upd', type: 'customer.subscription.updated', object: stripeState.get(SUB_OLD) })
    expect(res.status).toBe(200)
    expect(lastEventStatus()).toBe('PROCESSED')
    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith(SUB_OLD)
    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith(SUB_NEW)
    expectNoSubscriptionWrite()
    expect(stored).toMatchObject({ stripeSubscriptionId: SUB_NEW, plan: 'GROWTH' })
  })

  it('F. current subscription deleted while a newer live subscription exists → adopted directly, never FREE', async () => {
    stored = storedRow({ stripeSubscriptionId: SUB_OLD, plan: 'GROWTH', qbrCount: 5 })
    mocks.subscriptionsList.mockResolvedValue({
      data: [
        subscription('price_live_agency', 'active', { id: SUB_NEW, created: 2000 }),
        subscription('price_live_growth', 'past_due', { id: 'sub_other', created: 3000 }),
      ],
      has_more: false,
    })
    const res = await deliver({
      id: 'evt_del_adopt', type: 'customer.subscription.deleted',
      object: subscription('price_live_growth', 'canceled', { id: SUB_OLD, created: 1000 }),
    })
    expect(res.status).toBe(200)
    expect(writes()).toHaveLength(1)
    expect(writes()[0].where).toEqual({ workspaceId: 'ws_1', stripeSubscriptionId: SUB_OLD })
    expect(writes()[0].data).toMatchObject({ plan: 'AGENCY', stripeSubscriptionId: SUB_NEW, qbrCount: 0, exportCount: 0 })
    expect(writes().some(w => w.data.plan === 'FREE')).toBe(false)
    expect(stored).toMatchObject({ plan: 'AGENCY', stripeSubscriptionId: SUB_NEW })
  })

  it.each([
    ['now canceled',            subscription('price_live_solo', 'canceled', { id: SUB_OLD, created: 1000 })],
    ['still active but older',  subscription('price_live_solo', 'active',   { id: SUB_OLD, created: 1000 })],
  ])('G. delayed checkout for an old subscription (%s) → no overwrite, no usage reset', async (_label, oldSub) => {
    stored = storedRow({ stripeSubscriptionId: SUB_NEW, plan: 'GROWTH', qbrCount: 7, exportCount: 2 })
    stripeState.set(SUB_NEW, subscription('price_live_growth', 'active', { id: SUB_NEW, created: 2000 }))
    stripeState.set(SUB_OLD, oldSub)

    const res = await deliver({
      id: 'evt_old_checkout', type: 'checkout.session.completed',
      object: { customer: 'cus_1', subscription: SUB_OLD, metadata: { workspaceId: 'ws_1' } },
    })
    expect(res.status).toBe(200)
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled()
    expect(mocks.subscriptionCreate).not.toHaveBeenCalled()
    expect(mocks.subscriptionUpsert).not.toHaveBeenCalled()
    expect(stored).toMatchObject({ stripeSubscriptionId: SUB_NEW, plan: 'GROWTH', qbrCount: 7, exportCount: 2 })
  })

  it.each(['invoice.paid', 'invoice.payment_failed'])(
    'H. %s for an obsolete subscription → no status, grace or email effects',
    async (type) => {
      stored = storedRow({ stripeSubscriptionId: SUB_NEW })
      const res = await deliver({ id: `evt_${type}_old`, type, object: { customer: 'cus_1', subscription: SUB_OLD } })
      expect(res.status).toBe(200)
      expect(lastEventStatus()).toBe('PROCESSED')
      expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled()
      expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled()
      expect(mocks.subscriptionUpdate).not.toHaveBeenCalled()
      expect(mocks.resendSend).not.toHaveBeenCalled()
      expect(stored).toMatchObject({ status: 'active', pastDueAt: null, graceEndsAt: null })
    },
  )

  it('H (control). invoice.payment_failed for the current subscription still sets grace and emails the owner', async () => {
    stripeState.set('sub_1', subscription('price_live_solo', 'past_due'))
    const res = await deliver({ id: 'evt_pf_cur', type: 'invoice.payment_failed', object: { customer: 'cus_1', subscription: 'sub_1' } })
    expect(res.status).toBe(200)
    expect(writes()[0].where).toEqual({ workspaceId: 'ws_1', stripeSubscriptionId: 'sub_1' })
    expect(writes()[0].data.status).toBe('past_due')
    expect(writes()[0].data.pastDueAt).toBeInstanceOf(Date)
    expect(mocks.resendSend).toHaveBeenCalledTimes(1)
  })

  it('I. equal created timestamps → the stored live subscription is preserved', async () => {
    stored = storedRow({ stripeSubscriptionId: 'sub_a', plan: 'SOLO' })
    stripeState.set('sub_a', subscription('price_live_solo',   'active', { id: 'sub_a', created: 1500 }))
    stripeState.set('sub_b', subscription('price_live_agency', 'active', { id: 'sub_b', created: 1500 }))

    const res = await deliver({ id: 'evt_tie', type: 'customer.subscription.updated', object: stripeState.get('sub_b') })
    expect(res.status).toBe(200)
    expectNoSubscriptionWrite()
    expect(stored).toMatchObject({ stripeSubscriptionId: 'sub_a', plan: 'SOLO' })
  })

  it('I2. deletion with ambiguous equal-newest live replacements → event FAILED, no FREE write', async () => {
    stored = storedRow({ stripeSubscriptionId: SUB_OLD, plan: 'GROWTH' })
    mocks.subscriptionsList.mockResolvedValue({
      data: [
        subscription('price_live_solo',   'active',   { id: 'sub_x', created: 3000 }),
        subscription('price_live_agency', 'trialing', { id: 'sub_y', created: 3000 }),
      ],
      has_more: false,
    })
    const res = await deliver({
      id: 'evt_del_ambiguous', type: 'customer.subscription.deleted',
      object: subscription('price_live_growth', 'canceled', { id: SUB_OLD }),
    })
    expect(res.status).toBe(500)
    expect(lastEventStatus()).toBe('FAILED')
    expect(mocks.stripeEventUpdate.mock.calls.at(-1)?.[0].data.errorMessage).toMatch(/ambiguous/)
    expectNoSubscriptionWrite()
    expect(stored).toMatchObject({ stripeSubscriptionId: SUB_OLD, plan: 'GROWTH' })
  })

  it('I2 (variant). more subscriptions than one page → event FAILED, no FREE write', async () => {
    mocks.subscriptionsList.mockResolvedValue({ data: [], has_more: true })
    const res = await deliver({ id: 'evt_del_more', type: 'customer.subscription.deleted', object: subscription('price_live_solo', 'canceled') })
    expect(res.status).toBe(500)
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled()
  })

  it('J. stored subscription missing in Stripe → a live incoming subscription is adopted', async () => {
    stored = storedRow({ stripeSubscriptionId: 'sub_gone', plan: 'SOLO', qbrCount: 4 })
    stripeState.set(SUB_NEW, subscription('price_live_growth', 'active', { id: SUB_NEW, created: 2000 }))

    const res = await deliver({ id: 'evt_adopt_missing', type: 'customer.subscription.updated', object: stripeState.get(SUB_NEW) })
    expect(res.status).toBe(200)
    expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith('sub_gone')
    expect(writes()[0].where).toEqual({ workspaceId: 'ws_1', stripeSubscriptionId: 'sub_gone' })
    expect(stored).toMatchObject({ stripeSubscriptionId: SUB_NEW, plan: 'GROWTH', qbrCount: 0 })
  })

  it('J2. Stripe error retrieving the stored subscription → event FAILED, nothing written', async () => {
    stored = storedRow({ stripeSubscriptionId: 'sub_stored' })
    stripeState.set(SUB_NEW, subscription('price_live_growth', 'active', { id: SUB_NEW, created: 2000 }))
    mocks.subscriptionsRetrieve.mockImplementation(async (id: string) => {
      if (id === 'sub_stored') throw Object.assign(new Error('Stripe API unavailable'), { statusCode: 500 })
      return stripeState.get(id)
    })

    const res = await deliver({ id: 'evt_stripe_down', type: 'customer.subscription.updated', object: stripeState.get(SUB_NEW) })
    expect(res.status).toBe(500)
    expect(lastEventStatus()).toBe('FAILED')
    expectNoSubscriptionWrite()
    expect(stored).toMatchObject({ stripeSubscriptionId: 'sub_stored' })
  })

  it('K. conditional write misses (count 0) → event FAILED so Stripe retries against fresh state', async () => {
    mocks.subscriptionUpdateMany.mockResolvedValueOnce({ count: 0 })
    const res = await deliver({ id: 'evt_lost_race', type: 'customer.subscription.updated', object: subscription('price_live_solo') })
    expect(res.status).toBe(500)
    expect(lastEventStatus()).toBe('FAILED')
    expect(mocks.stripeEventUpdate.mock.calls.at(-1)?.[0].data.errorMessage).toMatch(/stale write/)
  })

  it('L. strictly newer live subscription → adopted with usage reset exactly once', async () => {
    stored = storedRow({ stripeSubscriptionId: SUB_NEW, plan: 'GROWTH', qbrCount: 4, exportCount: 2 })
    stripeState.set(SUB_NEW,      subscription('price_live_growth', 'active', { id: SUB_NEW, created: 2000 }))
    stripeState.set('sub_newer', subscription('price_live_agency', 'active', { id: 'sub_newer', created: 3000 }))

    await deliver({ id: 'evt_newer_1', type: 'customer.subscription.updated', object: stripeState.get('sub_newer') })
    expect(writes()[0].data).toMatchObject({ plan: 'AGENCY', stripeSubscriptionId: 'sub_newer', qbrCount: 0, exportCount: 0 })

    stored = { ...stored!, qbrCount: 1 }
    await deliver({ id: 'evt_newer_2', type: 'customer.subscription.updated', object: stripeState.get('sub_newer') })
    expect(writes()).toHaveLength(2)
    expect(writes()[1].data).not.toHaveProperty('qbrCount')
    expect(writes()[1].data).not.toHaveProperty('exportCount')
    expect(stored).toMatchObject({ stripeSubscriptionId: 'sub_newer', qbrCount: 1 })
  })

  it('M. retried checkout for the already-current subscription → no usage reset', async () => {
    stored = storedRow({ stripeSubscriptionId: 'sub_1', qbrCount: 3, exportCount: 1 })
    stripeState.set('sub_1', subscription('price_live_solo'))
    const res = await deliver({
      id: 'evt_co_retry', type: 'checkout.session.completed',
      object: { customer: 'cus_1', subscription: 'sub_1', metadata: { workspaceId: 'ws_1' } },
    })
    expect(res.status).toBe(200)
    expect(writes()[0].data).not.toHaveProperty('qbrCount')
    expect(writes()[0].data).not.toHaveProperty('exportCount')
    expect(writes()[0].data).not.toHaveProperty('periodStart')
    expect(stored).toMatchObject({ qbrCount: 3, exportCount: 1 })
  })
})

// ─── Invoice webhooks across Stripe API versions ────────────────────────────
// legacy:  invoice.subscription (≤ 2024-04-10; the installed stripe@15 types)
// current: invoice.parent.subscription_details.subscription, no top-level
//          `subscription` key (2025-03-31.basil+; this account's webhook
//          endpoint is on 2026-04-22.dahlia)

type InvoiceFixture = Pick<Stripe.Invoice, 'id' | 'object' | 'customer' | 'billing_reason' | 'status'> & {
  subscription?: string | null
  parent?:       InvoiceParent | null
}

type InvoiceShape = 'legacy' | 'current'
const SHAPES: [string, InvoiceShape][] = [
  ['legacy invoice.subscription', 'legacy'],
  ['current invoice.parent.subscription_details', 'current'],
]

function invoice(shape: InvoiceShape, subscriptionId: string | null, overrides: Partial<InvoiceFixture> = {}): InvoiceFixture {
  const base: InvoiceFixture = { id: 'in_1', object: 'invoice', customer: 'cus_1', billing_reason: 'subscription_cycle', status: 'open' }
  const link: Partial<InvoiceFixture> = shape === 'legacy'
    ? { subscription: subscriptionId }
    : { parent: subscriptionId ? { type: 'subscription_details', subscription_details: { subscription: subscriptionId, metadata: {} } } : null }
  return { ...base, ...link, ...overrides }
}

const DAY_MS = 24 * 60 * 60 * 1000

// Access as the app computes it from the stored row.
function storedAccess(): SubscriptionAccess {
  const row = stored!
  return {
    plan: row.plan, status: row.status, stripeStatus: row.stripeStatus,
    pastDueAt: row.pastDueAt, graceEndsAt: row.graceEndsAt, cancelAtPeriodEnd: row.cancelAtPeriodEnd ?? false,
  }
}

function expectNoInvoiceEffects() {
  expectNoSubscriptionWrite()
  expect(mocks.resendSend).not.toHaveBeenCalled()
}

describe('invoice webhooks — Stripe API-version compatibility', () => {
  describe.each(SHAPES)('%s', (_label, shape) => {
    it('A/B/D. invoice.payment_failed on the current subscription → past_due, grace started, owner emailed once', async () => {
      stripeState.set('sub_1', subscription('price_live_solo', 'past_due'))
      const res = await deliver({ id: 'evt_pf', type: 'invoice.payment_failed', object: invoice(shape, 'sub_1') })

      expect(res.status).toBe(200)
      expect(lastEventStatus()).toBe('PROCESSED')
      expect(mocks.subscriptionsRetrieve).toHaveBeenCalledWith('sub_1')
      expect(writes()).toHaveLength(1)
      expect(writes()[0].where).toEqual({ workspaceId: 'ws_1', stripeSubscriptionId: 'sub_1' })
      expect(writes()[0].data).not.toHaveProperty('plan')
      expect(stored).toMatchObject({ status: 'past_due', stripeStatus: 'past_due', plan: 'SOLO' })
      expect(stored!.pastDueAt).toBeInstanceOf(Date)
      expect(stored!.graceEndsAt.getTime() - stored!.pastDueAt.getTime()).toBe(PAYMENT_GRACE_PERIOD_DAYS * DAY_MS)
      expect(mocks.resendSend).toHaveBeenCalledTimes(1)
      expect(mocks.resendSend.mock.calls[0][0].to).toBe('owner@example.com')
      // Grace keeps paid access — the failure does not revoke the plan.
      expect(hasPaidAccess(storedAccess())).toBe(true)
    })

    it('E. invoice.paid on the current subscription clears grace and records recovery', async () => {
      stored = storedRow({ status: 'past_due', stripeStatus: 'past_due', pastDueAt: new Date(), graceEndsAt: new Date(Date.now() + DAY_MS) })
      stripeState.set('sub_1', subscription('price_live_solo', 'active'))
      const res = await deliver({ id: 'evt_paid', type: 'invoice.paid', object: invoice(shape, 'sub_1', { status: 'paid' }) })

      expect(res.status).toBe(200)
      expect(lastEventStatus()).toBe('PROCESSED')
      expect(writes()).toHaveLength(1)
      expect(writes()[0].where).toEqual({ workspaceId: 'ws_1', stripeSubscriptionId: 'sub_1' })
      expect(writes()[0].data).not.toHaveProperty('plan')
      expect(stored).toMatchObject({ status: 'active', stripeStatus: 'active', pastDueAt: null, graceEndsAt: null, plan: 'SOLO' })
      expect(mocks.resendSend).not.toHaveBeenCalled()
    })

    it.each(['invoice.paid', 'invoice.payment_failed'])(
      'F. %s for an old subscription cannot modify the newer current one',
      async (type) => {
        const pastDueAt   = new Date(1_700_000_000_000)
        const graceEndsAt = new Date(1_700_000_000_000 + 7 * DAY_MS)
        stored = storedRow({ stripeSubscriptionId: SUB_NEW, status: 'past_due', stripeStatus: 'past_due', pastDueAt, graceEndsAt })
        const before = { ...stored }
        const res = await deliver({ id: `evt_old_${type}`, type, object: invoice(shape, SUB_OLD) })

        expect(res.status).toBe(200)
        expect(lastEventStatus()).toBe('PROCESSED')
        expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled()
        expectNoInvoiceEffects()
        expect(stored).toEqual(before)
      },
    )

    it.each(['invoice.paid', 'invoice.payment_failed'])(
      'G. %s whose current subscription Stripe does not know → event FAILED, nothing written',
      async (type) => {
        // stored owns sub_1 but Stripe has no such subscription
        const res = await deliver({ id: `evt_unknown_${type}`, type, object: invoice(shape, 'sub_1') })
        expect(res.status).toBe(500)
        expect(lastEventStatus()).toBe('FAILED')
        expectNoInvoiceEffects()
      },
    )

    it.each(['invoice.paid', 'invoice.payment_failed'])(
      'G. %s whose subscription belongs to another customer → event FAILED, nothing written',
      async (type) => {
        stripeState.set('sub_1', { ...subscription('price_live_solo', 'past_due'), customer: 'cus_other' })
        const res = await deliver({ id: `evt_foreign_${type}`, type, object: invoice(shape, 'sub_1') })
        expect(res.status).toBe(500)
        expect(lastEventStatus()).toBe('FAILED')
        expectNoInvoiceEffects()
      },
    )

    it.each(['invoice.paid', 'invoice.payment_failed'])(
      'H. %s: Stripe error retrieving the subscription → event FAILED; the retry then succeeds',
      async (type) => {
        mocks.subscriptionsRetrieve.mockRejectedValueOnce(Object.assign(new Error('connection reset'), { type: 'StripeConnectionError' }))
        const first = await deliver({ id: `evt_retry_${type}`, type, object: invoice(shape, 'sub_1') })
        expect(first.status).toBe(500)
        expect(lastEventStatus()).toBe('FAILED')
        expectNoInvoiceEffects()

        stripeState.set('sub_1', subscription('price_live_solo', type === 'invoice.paid' ? 'active' : 'past_due'))
        mocks.stripeEventFindUnique.mockResolvedValue({ status: 'FAILED' })
        const retry = await deliver({ id: `evt_retry_${type}`, type, object: invoice(shape, 'sub_1') })
        expect(retry.status).toBe(200)
        expect(lastEventStatus()).toBe('PROCESSED')
        expect(writes()).toHaveLength(1)
      },
    )

    it.each(['PROCESSED', 'PROCESSING'])('I. a duplicate %s event id is not processed again', async (status) => {
      stripeState.set('sub_1', subscription('price_live_solo', 'past_due'))
      mocks.stripeEventFindUnique.mockResolvedValue({ status })
      const res = await deliver({ id: 'evt_dup_pf', type: 'invoice.payment_failed', object: invoice(shape, 'sub_1') })
      expect(res.status).toBe(200)
      expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled()
      expectNoInvoiceEffects()
    })

    it('J. a redelivered payment_failed event sends no second email; a later failed attempt keeps the original grace window', async () => {
      // Stateful StripeEvent table so redelivery hits the real idempotency guard.
      const events = new Map<string, { status: string }>()
      mocks.stripeEventFindUnique.mockImplementation(async ({ where }: any) => events.get(where.stripeEventId) ?? null)
      mocks.stripeEventUpsert.mockImplementation(async ({ where }: any) => { events.set(where.stripeEventId, { status: 'PROCESSING' }) })
      mocks.stripeEventUpdate.mockImplementation(async ({ where, data }: any) => { events.set(where.stripeEventId, { status: data.status }) })
      stripeState.set('sub_1', subscription('price_live_solo', 'past_due'))

      await deliver({ id: 'evt_pf_once', type: 'invoice.payment_failed', object: invoice(shape, 'sub_1') })
      const { pastDueAt, graceEndsAt } = stored!
      const again = await deliver({ id: 'evt_pf_once', type: 'invoice.payment_failed', object: invoice(shape, 'sub_1') })

      expect(await again.json()).toEqual({ received: true, idempotent: true })
      expect(mocks.resendSend).toHaveBeenCalledTimes(1)
      expect(writes()).toHaveLength(1)

      // A distinct failed retry attempt (new event id) is a new notification,
      // as before, but never restarts or extends the grace period.
      await deliver({ id: 'evt_pf_attempt_2', type: 'invoice.payment_failed', object: invoice(shape, 'sub_1') })
      expect(writes()[1].data).not.toHaveProperty('pastDueAt')
      expect(writes()[1].data).not.toHaveProperty('graceEndsAt')
      expect(stored).toMatchObject({ pastDueAt, graceEndsAt })
      expect(mocks.resendSend).toHaveBeenCalledTimes(2)
    })
  })

  describe('C. a missing or unsafe subscription relationship fails the event — never a 200 no-op', () => {
    const cases: [string, InvoiceFixture][] = [
      ['current shape, parent null',                          invoice('current', null)],
      ['current shape, subscription_details without an id',   invoice('current', null, { parent: { type: 'subscription_details', subscription_details: { metadata: {} } } })],
      ['current shape, quote_details parent',                 invoice('current', null, { parent: { type: 'quote_details', quote_details: { quote: 'qt_1' } }, billing_reason: 'quote_accept' })],
      ['legacy shape, subscription null',                     invoice('legacy', null)],
      ['both shapes, disagreeing',                            { ...invoice('current', 'sub_1'), subscription: SUB_OLD }],
      ['malformed subscription reference',                    invoice('current', 'in_not_a_subscription')],
    ]

    describe.each(['invoice.paid', 'invoice.payment_failed'])('%s', (type) => {
      it.each(cases)('%s → 500, FAILED, no lookup, write, grace or email', async (_label, object) => {
        stored = storedRow({ status: 'past_due', stripeStatus: 'past_due', pastDueAt: new Date(1), graceEndsAt: new Date(2) })
        const before = { ...stored }
        const res = await deliver({ id: `evt_c_${type}`, type, object })

        expect(res.status).toBe(500)
        expect(lastEventStatus()).toBe('FAILED')
        expect(mocks.stripeEventUpdate.mock.calls.at(-1)?.[0].data.errorMessage).toMatch(/invoice in_1/)
        expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled()
        expect(mocks.customersRetrieve).not.toHaveBeenCalled()
        expectNoInvoiceEffects()
        expect(stored).toEqual(before)
      })
    })

    it.each(['invoice.paid', 'invoice.payment_failed'])(
      'control: %s for an invoice Stripe marks manual (unrelated to a subscription) is acknowledged with no effect',
      async (type) => {
        const res = await deliver({ id: `evt_manual_${type}`, type, object: invoice('current', null, { billing_reason: 'manual' }) })
        expect(res.status).toBe(200)
        expect(lastEventStatus()).toBe('PROCESSED')
        expect(mocks.subscriptionsRetrieve).not.toHaveBeenCalled()
        expectNoInvoiceEffects()
      },
    )
  })

  it('regression: the current-shape failure path no longer drops paid access without grace', async () => {
    // Stripe sends subscription.updated (past_due) and invoice.payment_failed
    // for one failed renewal. Before the fix only the first took effect,
    // leaving past_due with no grace window → no paid access.
    stripeState.set('sub_1', subscription('price_live_solo', 'past_due'))
    await deliver({ id: 'evt_su_pd', type: 'customer.subscription.updated', object: stripeState.get('sub_1') })
    expect(hasPaidAccess(storedAccess())).toBe(false)

    await deliver({ id: 'evt_pf_pd', type: 'invoice.payment_failed', object: invoice('current', 'sub_1') })
    expect(stored).toMatchObject({ stripeStatus: 'past_due', plan: 'SOLO' })
    expect(hasPaidAccess(storedAccess())).toBe(true)
    expect(mocks.resendSend).toHaveBeenCalledTimes(1)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// EXECUTABLE lifecycle tests: a paid workspace's subscription is deleted via
// the real webhook handler, then the real portal route is called against the
// SAME in-memory Subscription row. Clerk, Prisma, the workspace resolver and
// the Stripe client are mocked — no database, no Stripe call. lib/billing/*,
// lib/permissions and lib/subscription-access run for real.

type Row = {
  workspaceId:          string
  stripeCustomerId:     string
  stripeSubscriptionId: string | null
  stripePriceId:        string | null
  plan:                 SubscriptionAccess['plan']
  status:              string
  stripeStatus:         string | null
  pastDueAt:            Date | null
  graceEndsAt:          Date | null
  cancelAtPeriodEnd:    boolean
}

const mocks = vi.hoisted(() => ({
  rows:                  new Map<string, any>(),
  auth:                  vi.fn(),
  getWorkspaceMembership: vi.fn(),
  constructEvent:        vi.fn(),
  subscriptionsRetrieve: vi.fn(),
  customersRetrieve:     vi.fn(),
  portalSessionsCreate:  vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }))
vi.mock('@/lib/workspace', () => ({ getWorkspaceMembership: mocks.getWorkspaceMembership }))
vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks:      { constructEvent: mocks.constructEvent },
    subscriptions: { retrieve: mocks.subscriptionsRetrieve },
    customers:     { retrieve: mocks.customersRetrieve },
    billingPortal: { sessions: { create: mocks.portalSessionsCreate } },
  },
}))
vi.mock('@/lib/prisma', () => {
  const find = ({ where }: any) => {
    if (where.workspaceId) return mocks.rows.get(where.workspaceId) ?? null
    return Array.from(mocks.rows.values()).find(row => row.stripeCustomerId === where.stripeCustomerId) ?? null
  }
  return {
    prisma: {
      stripeEvent: {
        findUnique: vi.fn(async () => null),
        upsert:     vi.fn(async () => ({})),
        update:     vi.fn(async () => ({})),
      },
      subscription: {
        findUnique: vi.fn(async (args: any) => find(args)),
        update: vi.fn(async ({ where, data }: any) => {
          const next = { ...mocks.rows.get(where.workspaceId), ...data }
          mocks.rows.set(where.workspaceId, next)
          return next
        }),
        upsert: vi.fn(async ({ where, update, create }: any) => {
          const current = mocks.rows.get(where.workspaceId)
          const next = current ? { ...current, ...update } : { ...create }
          mocks.rows.set(where.workspaceId, next)
          return next
        }),
      },
    },
  }
})

import { POST as webhook } from '@/app/api/webhooks/stripe/route'
import { POST as portal } from '@/app/api/billing/portal/route'
import { getEffectivePlan, hasPaidAccess, type SubscriptionAccess } from '@/lib/subscription-access'
import { hasLivePaidSubscription } from '@/lib/billing/checkout-request'

const WS = 'ws_active'
const APP_URL = 'https://qbrdeck.misecuretechsolutions.com'
const ENV = {
  NEXT_PUBLIC_APP_URL: 'https://app.example',
  STRIPE_PRICE_SOLO_USD: 'price_usd_solo', STRIPE_PRICE_GROWTH_USD: 'price_usd_growth', STRIPE_PRICE_AGENCY_USD: 'price_usd_agency',
  STRIPE_PRICE_SOLO_GMD: 'price_gmd_solo', STRIPE_PRICE_GROWTH_GMD: 'price_gmd_growth', STRIPE_PRICE_AGENCY_GMD: 'price_gmd_agency',
  STRIPE_PRICE_SOLO_XOF: 'price_xof_solo', STRIPE_PRICE_GROWTH_XOF: 'price_xof_growth', STRIPE_PRICE_AGENCY_XOF: 'price_xof_agency',
  STRIPE_PORTAL_CONFIG_USD: 'bpc_usd',
  STRIPE_PORTAL_CONFIG_GMD: 'bpc_gmd',
  STRIPE_PORTAL_CONFIG_XOF: 'bpc_xof',
}
const ENV_KEYS = [...Object.keys(ENV), ...['SOLO', 'GROWTH', 'AGENCY'].map(p => `STRIPE_PRICE_${p}`)]
const savedEnv: Record<string, string | undefined> = {}

function paidRow(plan: Row['plan'], stripePriceId: string): Row {
  return {
    workspaceId: WS, stripeCustomerId: 'cus_paid', stripeSubscriptionId: 'sub_1', stripePriceId,
    plan, status: 'active', stripeStatus: 'active', pastDueAt: null, graceEndsAt: null, cancelAtPeriodEnd: true,
  }
}

function stripeSubscription(priceId: string | undefined, status: string) {
  return {
    id: 'sub_1', customer: 'cus_paid', status, cancel_at_period_end: false,
    current_period_start: 1_700_000_000, current_period_end: 1_702_592_000,
    items: { data: priceId ? [{ price: { id: priceId } }] : [] },
  }
}

async function deliver(type: string, object: unknown, id = `evt_${type}`) {
  mocks.constructEvent.mockReturnValue({ id, type, data: { object } })
  const res = await webhook({ text: async () => '{}', headers: { get: () => 'sig' } } as any)
  expect(res.status).toBe(200)
}

async function openPortal() {
  const url = `${APP_URL}/api/billing/portal`
  const res = await portal({ json: async () => ({}), url, nextUrl: new URL(url) } as any)
  return { status: res.status, data: await res.json() }
}

const row = () => mocks.rows.get(WS) as Row

beforeEach(() => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k] }
  Object.assign(process.env, ENV)
  mocks.rows.clear()
  mocks.auth.mockReturnValue({ userId: 'clerk_owner' })
  mocks.getWorkspaceMembership.mockResolvedValue({ workspaceId: WS, role: 'OWNER' })
  mocks.portalSessionsCreate.mockResolvedValue({ url: 'https://portal.example/session' })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('formerly-paid FREE workspace keeps its currency-specific portal', () => {
  it.each([
    ['USD', 'SOLO',   'price_usd_solo',   'bpc_usd'],
    ['GMD', 'GROWTH', 'price_gmd_growth', 'bpc_gmd'],
    ['XOF', 'AGENCY', 'price_xof_agency', 'bpc_xof'],
  ])('%s: subscription.deleted → FREE entitlements, last Price kept, %s portal still opens', async (_c, plan, priceId, configuration) => {
    mocks.rows.set(WS, paidRow(plan as Row['plan'], priceId))

    await deliver('customer.subscription.deleted', stripeSubscription(priceId, 'canceled'))

    // Canonical lifecycle reset
    expect(row().plan).toBe('FREE')
    expect(row().status).toBe('canceled')
    expect(row().stripeStatus).toBe('canceled')
    expect(row().stripeSubscriptionId).toBeNull()
    expect(row().cancelAtPeriodEnd).toBe(false)
    // History retained
    expect(row().stripePriceId).toBe(priceId)
    expect(row().stripeCustomerId).toBe('cus_paid')

    // Retained Price grants nothing
    expect(hasPaidAccess(row())).toBe(false)
    expect(getEffectivePlan(row())).toBe('FREE')
    expect(getEffectivePlan({ ...row(), plan: plan as Row['plan'] })).toBe('FREE')  // even a stale paid plan stays FREE once canceled
    expect(hasLivePaidSubscription(row())).toBe(false)                      // new checkout allowed, as before

    const { status, data } = await openPortal()
    expect(status).toBe(200)
    expect(data.url).toBe('https://portal.example/session')
    expect(mocks.portalSessionsCreate).toHaveBeenCalledWith({
      customer:      'cus_paid',
      configuration,
      return_url:    `${APP_URL}/dashboard/settings`,
    })
  })

  it.each([
    ['price_gmd_growth', 'bpc_gmd'],
    ['price_xof_growth', 'bpc_xof'],
  ])('former %s subscriber never gets the USD configuration', async (priceId, configuration) => {
    mocks.rows.set(WS, paidRow('GROWTH', priceId))
    await deliver('customer.subscription.deleted', stripeSubscription(priceId, 'canceled'))
    await openPortal()
    expect(mocks.portalSessionsCreate.mock.calls[0][0].configuration).toBe(configuration)
    expect(mocks.portalSessionsCreate.mock.calls[0][0].configuration).not.toBe('bpc_usd')
  })

  it('former GMD subscriber with the GMD portal config missing → fails closed, no USD fallback', async () => {
    delete process.env.STRIPE_PORTAL_CONFIG_GMD
    mocks.rows.set(WS, paidRow('GROWTH', 'price_gmd_growth'))
    await deliver('customer.subscription.deleted', stripeSubscription('price_gmd_growth', 'canceled'))
    expect((await openPortal()).status).toBe(503)
    expect(mocks.portalSessionsCreate).not.toHaveBeenCalled()
  })

  it('deletion event carrying an unknown Price does not overwrite the retained one', async () => {
    mocks.rows.set(WS, paidRow('GROWTH', 'price_gmd_growth'))
    await deliver('customer.subscription.deleted', stripeSubscription('price_not_configured', 'canceled'))
    expect(row().plan).toBe('FREE')
    expect(row().stripePriceId).toBe('price_gmd_growth')
    expect((await openPortal()).status).toBe(200)
  })

  it('resubscribing later replaces the retained Price, so the new currency is used', async () => {
    mocks.rows.set(WS, paidRow('GROWTH', 'price_gmd_growth'))
    await deliver('customer.subscription.deleted', stripeSubscription('price_gmd_growth', 'canceled'))

    mocks.subscriptionsRetrieve.mockResolvedValue({ ...stripeSubscription('price_usd_solo', 'active'), id: 'sub_2' })
    await deliver('checkout.session.completed', { customer: 'cus_paid', subscription: 'sub_2', metadata: { workspaceId: WS } })

    expect(row().plan).toBe('SOLO')
    expect(row().stripePriceId).toBe('price_usd_solo')
    expect(hasLivePaidSubscription(row())).toBe(true)
    await openPortal()
    expect(mocks.portalSessionsCreate.mock.calls[0][0].configuration).toBe('bpc_usd')
  })
})

describe('never-subscribed FREE workspace is denied the portal', () => {
  it('free_ placeholder row → 404, no Stripe call', async () => {
    mocks.rows.set(WS, {
      ...paidRow('FREE', ''), stripeCustomerId: `free_${WS}`, stripeSubscriptionId: null, stripePriceId: null,
    })
    expect(getEffectivePlan(row())).toBe('FREE')
    const { status, data } = await openPortal()
    expect(status).toBe(404)
    expect(data.error).toBe('No active subscription')
    expect(mocks.portalSessionsCreate).not.toHaveBeenCalled()
  })

  it('real customer from an abandoned checkout but no Price ever recorded → 404, no Stripe call', async () => {
    mocks.rows.set(WS, {
      ...paidRow('FREE', ''), stripeCustomerId: 'cus_never_paid', stripeSubscriptionId: null, stripePriceId: null,
    })
    expect((await openPortal()).status).toBe(404)
    expect(mocks.portalSessionsCreate).not.toHaveBeenCalled()
  })

  it('no Subscription row → 404, no Stripe call', async () => {
    expect((await openPortal()).status).toBe(404)
    expect(mocks.portalSessionsCreate).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-CONTRACT — retained stripePriceId is never entitlement evidence
// ─────────────────────────────────────────────────────────────────────────────

function readSourceLF(rel: string) {
  return readFileSync(join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
}

describe('stripePriceId is not read by entitlement, guard or billing-UI code (SOURCE-CONTRACT)', () => {
  it.each([
    'lib/subscription-access.ts',
    'lib/limits.ts',
    'app/(app)/dashboard/billing/page.tsx',
    'app/(app)/dashboard/billing/billing-button.tsx',
  ])('%s never references stripePriceId', file => {
    expect(readSourceLF(file)).not.toContain('stripePriceId')
  })

  it('duplicate-subscription guard depends on plan/status/stripeSubscriptionId only', () => {
    const src = readSourceLF('lib/billing/checkout-request.ts')
    const guard = src.slice(src.indexOf('export interface CheckoutGuardSubscription'), src.indexOf('export const EXISTING_SUBSCRIPTION_MESSAGE'))
    expect(guard).toContain('stripeSubscriptionId')
    expect(guard).not.toContain('stripePriceId')
    const checkout = readSourceLF('app/api/billing/checkout/route.ts')
    expect(checkout).toContain('select: { plan: true, status: true, stripeStatus: true, stripeSubscriptionId: true }')
  })

  it('a retained Price on a canceled FREE row does not make the guard block checkout', () => {
    expect(hasLivePaidSubscription({ plan: 'FREE', status: 'canceled', stripeStatus: 'canceled', stripeSubscriptionId: null, stripePriceId: 'price_usd_solo' } as any)).toBe(false)
  })

  it('subscription.deleted handler does not write stripePriceId and documents why', () => {
    const src = readSourceLF('app/api/webhooks/stripe/route.ts')
    const fn  = src.slice(src.indexOf('async function handleSubscriptionDeleted'), src.indexOf('async function handleInvoicePaid'))
    expect(fn).not.toMatch(/stripePriceId:/)
    expect(fn).toContain('NOT evidence of an active subscription or entitlement')
    expect(fn).toMatch(/plan:\s*'FREE'/)
    expect(fn).toMatch(/stripeSubscriptionId:\s*null/)
  })
})

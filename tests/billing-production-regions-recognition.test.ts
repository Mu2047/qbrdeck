import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// EXECUTABLE: an EXISTING GMD / XOF subscriber keeps working in Production
// while NEW checkout for its region is switched off (BILLING_PRODUCTION_REGIONS
// missing, or the workspace absent from BILLING_PRODUCTION_TEST_WORKSPACES).
// Runs the real portal route and Stripe webhook route; Clerk, Prisma, Stripe
// and Resend are mocked — no database, no Stripe call, no email.

const mocks = vi.hoisted(() => ({
  auth:                   vi.fn(),
  getWorkspaceMembership: vi.fn(),
  portalSessionsCreate:   vi.fn(),
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

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }))
vi.mock('@/lib/workspace', () => ({ getWorkspaceMembership: mocks.getWorkspaceMembership }))
vi.mock('@/lib/stripe', () => ({
  stripe: {
    billingPortal: { sessions: { create: mocks.portalSessionsCreate } },
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

import { POST as portalPOST } from '@/app/api/billing/portal/route'
import { POST as webhookPOST } from '@/app/api/webhooks/stripe/route'
import { hasPaidAccess, PAYMENT_GRACE_PERIOD_DAYS } from '@/lib/subscription-access'
import { displayRegionForStoredPrice } from '@/lib/billing/checkout-region'
import { parseCheckoutRequest } from '@/lib/billing/checkout-request'

const APP_URL = 'https://qbrdeck.misecuretechsolutions.com'
const ENV = {
  STRIPE_PRICE_SOLO_USD: 'price_usd_solo', STRIPE_PRICE_GROWTH_USD: 'price_usd_growth', STRIPE_PRICE_AGENCY_USD: 'price_usd_agency',
  STRIPE_PRICE_SOLO_GMD: 'price_gmd_solo', STRIPE_PRICE_GROWTH_GMD: 'price_gmd_growth', STRIPE_PRICE_AGENCY_GMD: 'price_gmd_agency',
  STRIPE_PRICE_SOLO_XOF: 'price_xof_solo', STRIPE_PRICE_GROWTH_XOF: 'price_xof_growth', STRIPE_PRICE_AGENCY_XOF: 'price_xof_agency',
  STRIPE_PORTAL_CONFIG_USD: 'bpc_usd', STRIPE_PORTAL_CONFIG_GMD: 'bpc_gmd', STRIPE_PORTAL_CONFIG_XOF: 'bpc_xof',
}
const ENV_KEYS = [
  ...Object.keys(ENV),
  ...['SOLO', 'GROWTH', 'AGENCY'].map(p => `STRIPE_PRICE_${p}`),
  'BILLING_PRODUCTION_REGIONS', 'BILLING_PRODUCTION_TEST_WORKSPACES', 'BILLING_PREVIEW_REGIONS',
]
const savedEnv: Record<string, string | undefined> = {}

// Regional checkout OFF for the subscriber, by each supported mechanism.
const DISABLED_SETTINGS: Array<[string, Record<string, string>]> = [
  ['BILLING_PRODUCTION_REGIONS unset',                  {}],
  ['subscriber not on the certification allow-list',     { BILLING_PRODUCTION_REGIONS: 'GM,XOF_ZONE', BILLING_PRODUCTION_TEST_WORKSPACES: 'ws_cert_only' }],
]

const SUBSCRIBERS: Array<[string, string, string, string]> = [
  // priceId, plan, currency, portal config
  ['price_gmd_growth', 'GROWTH', 'GMD', 'bpc_gmd'],
  ['price_gmd_agency', 'AGENCY', 'GMD', 'bpc_gmd'],
  ['price_xof_solo',   'SOLO',   'XOF', 'bpc_xof'],
  ['price_xof_growth', 'GROWTH', 'XOF', 'bpc_xof'],
]

function production(extra: Record<string, string>) {
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('NODE_ENV', 'production')
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v)
}

beforeEach(() => {
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k] }
  Object.assign(process.env, ENV)
  vi.stubEnv('VERCEL_URL', undefined)
  vi.stubEnv('VERCEL_BRANCH_URL', undefined)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
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

// ─────────────────────────────────────────────────────────────────────────────
// Portal
// ─────────────────────────────────────────────────────────────────────────────

function portalRequest() {
  const { host } = new URL(APP_URL)
  const internal = 'http://localhost:3000/api/billing/portal'
  return {
    json: vi.fn(async () => ({})), url: internal, nextUrl: new URL(internal),
    headers: new Headers({ origin: APP_URL, host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https' }),
  } as any
}

describe.each(DISABLED_SETTINGS)('portal while regional checkout is off (%s)', (_label, extra) => {
  beforeEach(() => {
    mocks.auth.mockReturnValue({ userId: 'clerk_owner' })
    mocks.getWorkspaceMembership.mockResolvedValue({ workspaceId: 'ws_regional_subscriber', role: 'OWNER' })
    mocks.portalSessionsCreate.mockResolvedValue({ url: 'https://portal.example/session' })
  })

  it.each(SUBSCRIBERS)('existing %s subscriber (%s/%s) → portal opens with %s', async (priceId, _plan, _currency, config) => {
    production(extra)
    mocks.subscriptionFindUnique.mockResolvedValue({ stripeCustomerId: 'cus_regional', stripePriceId: priceId })
    const res = await portalPOST(portalRequest())
    expect(res.status).toBe(200)
    expect(mocks.portalSessionsCreate).toHaveBeenCalledWith({
      customer: 'cus_regional', configuration: config, return_url: `${APP_URL}/dashboard/settings`,
    })
  })

  it('USD subscriber → portal unchanged (bpc_usd)', async () => {
    production(extra)
    mocks.subscriptionFindUnique.mockResolvedValue({ stripeCustomerId: 'cus_usd', stripePriceId: 'price_usd_growth' })
    expect((await portalPOST(portalRequest())).status).toBe(200)
    expect(mocks.portalSessionsCreate.mock.calls[0][0].configuration).toBe('bpc_usd')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Webhook + paid access + display
// ─────────────────────────────────────────────────────────────────────────────

let stripeState: Map<string, any>
let stored: Record<string, any> | null

function subscription(priceId: string, status = 'active') {
  return {
    id: 'sub_1', customer: 'cus_1', status, created: 1_690_000_000, cancel_at_period_end: false,
    current_period_start: 1_700_000_000, current_period_end: 1_702_592_000,
    items: { data: [{ price: { id: priceId } }] },
  }
}

function deliver(event: { id: string; type: string; object: any }) {
  const obj = event.object
  if (typeof obj?.id === 'string' && obj.id.startsWith('sub_') && !stripeState.has(obj.id)) stripeState.set(obj.id, obj)
  mocks.constructEvent.mockReturnValue({ id: event.id, type: event.type, data: { object: obj } })
  return webhookPOST({ text: async () => '{}', headers: { get: () => 'sig' } } as any)
}

function access() {
  const r = stored!
  return { plan: r.plan, status: r.status, stripeStatus: r.stripeStatus, pastDueAt: r.pastDueAt, graceEndsAt: r.graceEndsAt, cancelAtPeriodEnd: false }
}

const lastEventStatus = () => mocks.stripeEventUpdate.mock.calls.at(-1)?.[0].data.status

describe.each(DISABLED_SETTINGS)('webhooks while regional checkout is off (%s)', (_label, extra) => {
  beforeEach(() => {
    stripeState = new Map()
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
    mocks.subscriptionsRetrieve.mockImplementation(async (id: string) => {
      const sub = stripeState.get(id)
      if (!sub) throw Object.assign(new Error(`No such subscription: '${id}'`), { code: 'resource_missing', statusCode: 404 })
      return sub
    })
    mocks.subscriptionsList.mockResolvedValue({ data: [], has_more: false })
    mocks.workspaceFindUnique.mockResolvedValue({ members: [{ user: { email: 'owner@example.com' } }] })
    mocks.resendSend.mockResolvedValue({})
  })

  it.each(SUBSCRIBERS)('customer.subscription.updated with %s → plan %s kept, event PROCESSED, display stays regional', async (priceId, plan, currency) => {
    production(extra)
    stored = {
      workspaceId: 'ws_1', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', stripePriceId: priceId,
      plan, status: 'active', stripeStatus: 'active', qbrCount: 2, exportCount: 1,
      periodStart: new Date(0), stripeCurrentPeriodStart: new Date(0), pastDueAt: null, graceEndsAt: null,
    }
    const res = await deliver({ id: `evt_${priceId}`, type: 'customer.subscription.updated', object: subscription(priceId) })
    expect(res.status).toBe(200)
    expect(lastEventStatus()).toBe('PROCESSED')
    expect(stored!.plan).toBe(plan)
    expect(hasPaidAccess(access() as any)).toBe(true)
    expect(displayRegionForStoredPrice(stored!.stripePriceId)).toBe(currency === 'GMD' ? 'GM' : 'XOF_ZONE')
    // …while NEW checkout for that region is refused for this very workspace.
    const region = currency === 'GMD' ? 'GM' : 'XOF_ZONE'
    expect(parseCheckoutRequest({ plan, region, currency }, process.env, 'ws_1').ok).toBe(false)
  })

  it('GMD renewal failure → grace keeps GROWTH; invoice.paid recovery → active GROWTH', async () => {
    production(extra)
    stored = {
      workspaceId: 'ws_1', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_gmd_growth',
      plan: 'GROWTH', status: 'active', stripeStatus: 'active', qbrCount: 0, exportCount: 0,
      periodStart: new Date(0), stripeCurrentPeriodStart: new Date(0), pastDueAt: null, graceEndsAt: null,
    }
    const invoice = (status: string) => ({
      id: 'in_1', object: 'invoice', customer: 'cus_1', billing_reason: 'subscription_cycle', status,
      parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1', metadata: {} } },
    })

    stripeState.set('sub_1', subscription('price_gmd_growth', 'past_due'))
    expect((await deliver({ id: 'evt_pf', type: 'invoice.payment_failed', object: invoice('open') })).status).toBe(200)
    expect(stored).toMatchObject({ plan: 'GROWTH', status: 'past_due' })
    expect(stored!.graceEndsAt.getTime() - stored!.pastDueAt.getTime()).toBe(PAYMENT_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000)
    expect(hasPaidAccess(access() as any)).toBe(true)

    stripeState.set('sub_1', subscription('price_gmd_growth', 'active'))
    expect((await deliver({ id: 'evt_paid', type: 'invoice.paid', object: invoice('paid') })).status).toBe(200)
    expect(stored).toMatchObject({ plan: 'GROWTH', status: 'active', pastDueAt: null, graceEndsAt: null })
  })

  it('USD webhook plan resolution unchanged', async () => {
    production(extra)
    stored = {
      workspaceId: 'ws_1', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', stripePriceId: 'price_usd_solo',
      plan: 'SOLO', status: 'active', stripeStatus: 'active', qbrCount: 0, exportCount: 0,
      periodStart: new Date(0), stripeCurrentPeriodStart: new Date(0), pastDueAt: null, graceEndsAt: null,
    }
    const res = await deliver({ id: 'evt_usd', type: 'customer.subscription.updated', object: subscription('price_usd_agency') })
    expect(res.status).toBe(200)
    expect(stored!.plan).toBe('AGENCY')
  })

  it('an unknown Price ID still fails closed (FAILED, no write) — unchanged', async () => {
    production(extra)
    stored = {
      workspaceId: 'ws_1', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1',
      plan: 'GROWTH', status: 'active', stripeStatus: 'active', pastDueAt: null, graceEndsAt: null,
    }
    const res = await deliver({ id: 'evt_unknown', type: 'customer.subscription.updated', object: subscription('price_not_configured') })
    expect(res.status).toBe(500)
    expect(lastEventStatus()).toBe('FAILED')
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled()
    expect(stored!.plan).toBe('GROWTH')
  })
})

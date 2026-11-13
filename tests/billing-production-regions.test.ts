import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Production regional checkout gate (BILLING_PRODUCTION_REGIONS) and the
// workspace-scoped Production certification allow-list
// (BILLING_PRODUCTION_TEST_WORKSPACES).
//  - EXECUTABLE (pure): the gate functions, called with an explicit env object.
//  - EXECUTABLE (route): POST /api/billing/checkout with Clerk, Prisma, the
//    workspace resolver and Stripe mocked; lib/billing/* runs for real.
//
// Recognition of EXISTING regional subscribers while checkout is disabled is
// covered here at the domain level and in
// billing-production-regions-recognition.test.ts at the portal/webhook routes.

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
import {
  CHECKOUT_APPROVED_REGIONS,
  PREVIEW_CHECKOUT_REGIONS,
  PRODUCTION_CHECKOUT_REGIONS,
  productionCheckoutRegions,
  productionTestWorkspaces,
  previewCheckoutRegions,
  isCheckoutApproved,
  isRegionCheckoutAllowedForWorkspace,
  getAvailableRegions,
  resolvePlanFromStripePrice,
  UnknownStripePriceError,
  MissingStripePriceError,
} from '@/lib/billing/regional-prices'
import { parseCheckoutRequest } from '@/lib/billing/checkout-request'
import {
  selectableRegions,
  resolvePageRegion,
  displayRegionForStoredPrice,
  regionSelectorLabel,
} from '@/lib/billing/checkout-region'
import { currencyForStripePrice, portalConfigurationForCurrency } from '@/lib/billing/portal-config'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const USD_ENV = {
  STRIPE_PRICE_SOLO_USD: 'price_usd_solo', STRIPE_PRICE_GROWTH_USD: 'price_usd_growth', STRIPE_PRICE_AGENCY_USD: 'price_usd_agency',
}
const GMD_ENV = {
  STRIPE_PRICE_SOLO_GMD: 'price_gmd_solo', STRIPE_PRICE_GROWTH_GMD: 'price_gmd_growth', STRIPE_PRICE_AGENCY_GMD: 'price_gmd_agency',
}
const XOF_ENV = {
  STRIPE_PRICE_SOLO_XOF: 'price_xof_solo', STRIPE_PRICE_GROWTH_XOF: 'price_xof_growth', STRIPE_PRICE_AGENCY_XOF: 'price_xof_agency',
}
const PORTAL_ENV = { STRIPE_PORTAL_CONFIG_USD: 'bpc_usd', STRIPE_PORTAL_CONFIG_GMD: 'bpc_gmd', STRIPE_PORTAL_CONFIG_XOF: 'bpc_xof' }
const ALL_PRICES = { ...USD_ENV, ...GMD_ENV, ...XOF_ENV }

// Every regional Stripe Price env var is set in all of these: price env vars
// alone must never enable anything.
const PROD          = { ...ALL_PRICES, ...PORTAL_ENV, VERCEL_ENV: 'production' } as Record<string, string | undefined>
const PROD_GM       = { ...PROD, BILLING_PRODUCTION_REGIONS: 'GM' }
const PROD_XOF      = { ...PROD, BILLING_PRODUCTION_REGIONS: 'XOF_ZONE' }
const PROD_BOTH     = { ...PROD, BILLING_PRODUCTION_REGIONS: 'GM,XOF_ZONE' }
const PROD_BOTH_CERT = { ...PROD_BOTH, BILLING_PRODUCTION_TEST_WORKSPACES: 'ws_cert_a, ws_cert_b' }

const WS_LISTED   = 'ws_cert_a'
const WS_UNLISTED = 'ws_public'

const REGIONAL_PRICES: Array<[string, string, string, string]> = [
  // priceId, plan, region, currency
  ['price_gmd_solo',   'SOLO',   'GM',       'GMD'],
  ['price_gmd_growth', 'GROWTH', 'GM',       'GMD'],
  ['price_gmd_agency', 'AGENCY', 'GM',       'GMD'],
  ['price_xof_solo',   'SOLO',   'XOF_ZONE', 'XOF'],
  ['price_xof_growth', 'GROWTH', 'XOF_ZONE', 'XOF'],
  ['price_xof_agency', 'AGENCY', 'XOF_ZONE', 'XOF'],
]
const USD_PRICES: Array<[string, string]> = [
  ['price_usd_solo', 'SOLO'], ['price_usd_growth', 'GROWTH'], ['price_usd_agency', 'AGENCY'],
]

// ─────────────────────────────────────────────────────────────────────────────
// Region-level Production gate (EXECUTABLE, pure)
// ─────────────────────────────────────────────────────────────────────────────

describe('Production regional checkout gate — BILLING_PRODUCTION_REGIONS', () => {
  it('code ceiling: GM and XOF_ZONE only; code-level approvals and the Preview ceiling unchanged', () => {
    expect(PRODUCTION_CHECKOUT_REGIONS).toEqual(['GM', 'XOF_ZONE'])
    expect(CHECKOUT_APPROVED_REGIONS).toEqual({ GLOBAL: true, GM: false, XOF_ZONE: false })
    expect(PREVIEW_CHECKOUT_REGIONS).toEqual(['GM', 'XOF_ZONE'])
  })

  it('env absent → only GLOBAL, although every regional Stripe Price env var is configured', () => {
    expect(productionCheckoutRegions(PROD)).toEqual([])
    expect(getAvailableRegions(PROD)).toEqual(['GLOBAL'])
    expect(selectableRegions(PROD, WS_UNLISTED)).toEqual(['GLOBAL'])
    expect(isCheckoutApproved('GM', PROD)).toBe(false)
    expect(isCheckoutApproved('XOF_ZONE', PROD)).toBe(false)
  })

  it.each([
    ['GM only',              PROD_GM,   ['GLOBAL', 'GM']],
    ['XOF_ZONE only',        PROD_XOF,  ['GLOBAL', 'XOF_ZONE']],
    ['both',                 PROD_BOTH, ['GLOBAL', 'GM', 'XOF_ZONE']],
    ['both, reversed order', { ...PROD, BILLING_PRODUCTION_REGIONS: 'XOF_ZONE,GM' },       ['GLOBAL', 'GM', 'XOF_ZONE']],
    ['both, whitespace',     { ...PROD, BILLING_PRODUCTION_REGIONS: '  GM ,  XOF_ZONE ' }, ['GLOBAL', 'GM', 'XOF_ZONE']],
  ])('Production %s → %j', (_label, env, expected) => {
    expect(getAvailableRegions(env)).toEqual(expected)
    expect(selectableRegions(env, WS_UNLISTED)).toEqual(expected)
  })

  it.each([
    ['empty',             ''],
    ['blank',             '  , ,'],
    ['lower-case',        'gm,xof_zone'],
    ['mixed case',        'Gm,Xof_Zone'],
    ['currency codes',    'GMD,XOF'],
    ['unsupported region','NG,GH,KE'],
    ['wildcards',         '*,ALL,true,1'],
    ['GLOBAL',            'GLOBAL'],
    ['semicolons',        'GM;XOF_ZONE'],
  ])('%s values (%j) are ignored → only GLOBAL', (_label, flag) => {
    const env = { ...PROD, BILLING_PRODUCTION_REGIONS: flag }
    expect(productionCheckoutRegions(env)).toEqual([])
    expect(getAvailableRegions(env)).toEqual(['GLOBAL'])
  })

  it('unknown values next to a valid one are dropped; the valid one survives', () => {
    expect(productionCheckoutRegions({ ...PROD, BILLING_PRODUCTION_REGIONS: 'gm,NG,XOF_ZONE,*' })).toEqual(['XOF_ZONE'])
    expect(getAvailableRegions({ ...PROD, BILLING_PRODUCTION_REGIONS: 'gm,NG,XOF_ZONE,*' })).toEqual(['GLOBAL', 'XOF_ZONE'])
  })

  it.each([
    ['undefined',     undefined],
    ['development',   'development'],
    ['preview',       'preview'],
    ['staging',       'staging'],
    ['"Production"',  'Production'],
    ['"PRODUCTION"',  'PRODUCTION'],
  ])('VERCEL_ENV=%s cannot enable Production regional checkout', (_label, vercelEnv) => {
    const env = { ...PROD_BOTH, VERCEL_ENV: vercelEnv }
    expect(productionCheckoutRegions(env)).toEqual([])
    expect(getAvailableRegions(env)).toEqual(['GLOBAL'])
    expect(parseCheckoutRequest({ plan: 'GROWTH', region: 'GM', currency: 'GMD' }, env, WS_LISTED).ok).toBe(false)
  })

  it('an enabled region still needs every paid plan configured (fail closed per region)', () => {
    for (const key of Object.keys(GMD_ENV)) {
      const env: Record<string, string | undefined> = { ...PROD_BOTH }
      delete env[key]
      expect(getAvailableRegions(env)).toEqual(['GLOBAL', 'XOF_ZONE'])
    }
  })

  it.each([
    ['GMD duplicating USD',  { STRIPE_PRICE_GROWTH_GMD: 'price_usd_growth' }],
    ['XOF duplicating GMD',  { STRIPE_PRICE_AGENCY_XOF: 'price_gmd_agency' }],
  ])('duplicate Price ID (%s) → no regions, checkout 500, recognition throws — unchanged', (_label, override) => {
    const env = { ...PROD_BOTH, ...override }
    expect(getAvailableRegions(env)).toEqual([])
    expect(parseCheckoutRequest({ plan: 'SOLO', region: 'GLOBAL', currency: 'USD' }, env, WS_LISTED))
      .toEqual({ ok: false, status: 500, error: 'Billing is temporarily unavailable' })
    expect(() => resolvePlanFromStripePrice('price_usd_solo', env)).toThrow()
  })

  it('missing / unknown Price IDs still fail closed', () => {
    expect(() => resolvePlanFromStripePrice(null, PROD_BOTH)).toThrow(MissingStripePriceError)
    expect(() => resolvePlanFromStripePrice('price_unknown', PROD_BOTH)).toThrow(UnknownStripePriceError)
    expect(() => currencyForStripePrice('price_unknown', PROD_BOTH)).toThrow(UnknownStripePriceError)
    expect(displayRegionForStoredPrice('price_unknown', PROD_BOTH)).toBe('GLOBAL')
  })
})

describe('Preview behaviour is independent of the Production envs', () => {
  const PREVIEW = { ...ALL_PRICES, VERCEL_ENV: 'preview' }

  it('Preview ignores BILLING_PRODUCTION_REGIONS', () => {
    expect(getAvailableRegions({ ...PREVIEW, BILLING_PRODUCTION_REGIONS: 'GM,XOF_ZONE' })).toEqual(['GLOBAL'])
  })

  it('Production ignores BILLING_PREVIEW_REGIONS', () => {
    expect(getAvailableRegions({ ...PROD, BILLING_PREVIEW_REGIONS: 'GM,XOF_ZONE' })).toEqual(['GLOBAL'])
    expect(previewCheckoutRegions({ ...PROD, BILLING_PREVIEW_REGIONS: 'GM,XOF_ZONE' })).toEqual([])
  })

  it('Preview certification semantics unchanged; the workspace allow-list does not apply in Preview', () => {
    const env = { ...PREVIEW, BILLING_PREVIEW_REGIONS: 'GM', BILLING_PRODUCTION_TEST_WORKSPACES: 'ws_cert_a' }
    expect(productionTestWorkspaces(env)).toEqual([])
    expect(getAvailableRegions(env)).toEqual(['GLOBAL', 'GM'])
    expect(selectableRegions(env, WS_UNLISTED)).toEqual(['GLOBAL', 'GM'])
    expect(parseCheckoutRequest({ plan: 'SOLO', region: 'GM', currency: 'GMD' }, env, WS_UNLISTED).ok).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Workspace certification allow-list (EXECUTABLE, pure)
// ─────────────────────────────────────────────────────────────────────────────

describe('Production certification allow-list — BILLING_PRODUCTION_TEST_WORKSPACES', () => {
  it('parses exact, trimmed, comma-separated workspace IDs in Production only', () => {
    expect(productionTestWorkspaces(PROD_BOTH_CERT)).toEqual(['ws_cert_a', 'ws_cert_b'])
    expect(productionTestWorkspaces({ ...PROD_BOTH_CERT, VERCEL_ENV: 'development' })).toEqual([])
  })

  it('listed workspace → enabled regions selectable and checkout accepted', () => {
    expect(selectableRegions(PROD_BOTH_CERT, WS_LISTED)).toEqual(['GLOBAL', 'GM', 'XOF_ZONE'])
    expect(selectableRegions(PROD_BOTH_CERT, 'ws_cert_b')).toEqual(['GLOBAL', 'GM', 'XOF_ZONE'])
    expect(resolvePageRegion('GM', PROD_BOTH_CERT, WS_LISTED)).toBe('GM')
    const parsed = parseCheckoutRequest({ plan: 'GROWTH', region: 'GM', currency: 'GMD' }, PROD_BOTH_CERT, WS_LISTED)
    expect(parsed).toMatchObject({ ok: true, price: { plan: 'GROWTH', region: 'GM', currency: 'GMD', stripePriceId: 'price_gmd_growth' } })
  })

  it.each([
    ['unlisted workspace',          WS_UNLISTED],
    ['no workspace',                null],
    ['case-mismatched workspace',   'WS_CERT_A'],
    ['prefix of a listed workspace','ws_cert'],
    ['padded workspace',            ' ws_cert_a'],
  ])('%s → only GLOBAL selectable; regional checkout refused; USD still accepted', (_label, ws) => {
    expect(selectableRegions(PROD_BOTH_CERT, ws)).toEqual(['GLOBAL'])
    expect(resolvePageRegion('GM', PROD_BOTH_CERT, ws)).toBe('GLOBAL')
    expect(resolvePageRegion('XOF_ZONE', PROD_BOTH_CERT, ws)).toBe('GLOBAL')
    expect(parseCheckoutRequest({ plan: 'SOLO', region: 'GM', currency: 'GMD' }, PROD_BOTH_CERT, ws))
      .toEqual({ ok: false, status: 400, error: 'Checkout is not available for this billing region yet' })
    expect(parseCheckoutRequest({ plan: 'SOLO', region: 'XOF_ZONE', currency: 'XOF' }, PROD_BOTH_CERT, ws).ok).toBe(false)
    expect(parseCheckoutRequest({ plan: 'SOLO', region: 'GLOBAL', currency: 'USD' }, PROD_BOTH_CERT, ws).ok).toBe(true)
  })

  it('callers without workspace context fail closed during certification', () => {
    expect(getAvailableRegions(PROD_BOTH_CERT)).toEqual(['GLOBAL'])
    expect(parseCheckoutRequest({ plan: 'SOLO', region: 'GM', currency: 'GMD' }, PROD_BOTH_CERT).ok).toBe(false)
  })

  it.each([['missing', undefined], ['empty', ''], ['blank', ' , ,  ']])(
    '%s allow-list → public rollout of the enabled regions',
    (_label, list) => {
      const env = { ...PROD_BOTH, BILLING_PRODUCTION_TEST_WORKSPACES: list }
      expect(productionTestWorkspaces(env)).toEqual([])
      expect(selectableRegions(env, WS_UNLISTED)).toEqual(['GLOBAL', 'GM', 'XOF_ZONE'])
      expect(parseCheckoutRequest({ plan: 'AGENCY', region: 'XOF_ZONE', currency: 'XOF' }, env, WS_UNLISTED).ok).toBe(true)
    },
  )

  it('the allow-list never enables a region on its own', () => {
    const env = { ...PROD, BILLING_PRODUCTION_TEST_WORKSPACES: WS_LISTED }
    expect(selectableRegions(env, WS_LISTED)).toEqual(['GLOBAL'])
    expect(isRegionCheckoutAllowedForWorkspace('GM', WS_LISTED, env)).toBe(false)
  })

  it('the allow-list only narrows the enabled regions (GM enabled, XOF not)', () => {
    const env = { ...PROD_GM, BILLING_PRODUCTION_TEST_WORKSPACES: WS_LISTED }
    expect(selectableRegions(env, WS_LISTED)).toEqual(['GLOBAL', 'GM'])
    expect(parseCheckoutRequest({ plan: 'SOLO', region: 'XOF_ZONE', currency: 'XOF' }, env, WS_LISTED).ok).toBe(false)
  })

  it('GLOBAL/USD is never affected by the allow-list', () => {
    for (const ws of [WS_LISTED, WS_UNLISTED, null]) {
      expect(isRegionCheckoutAllowedForWorkspace('GLOBAL', ws, PROD_BOTH_CERT)).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Kill-switch: disabling checkout never breaks existing subscribers (pure)
// ─────────────────────────────────────────────────────────────────────────────

describe('recognition survives checkout disablement', () => {
  // GM/XOF checkout OFF in every one of these, by a different mechanism.
  const DISABLED: Array<[string, Record<string, string | undefined>]> = [
    ['Production, BILLING_PRODUCTION_REGIONS removed',        PROD],
    ['Production, BILLING_PRODUCTION_REGIONS emptied',        { ...PROD, BILLING_PRODUCTION_REGIONS: '' }],
    ['Production, subscriber not on the certification list',  { ...PROD_BOTH, BILLING_PRODUCTION_TEST_WORKSPACES: 'ws_someone_else' }],
    ['Production, only the other region enabled (GM)',        PROD_GM],
    ['Production, only the other region enabled (XOF)',       PROD_XOF],
  ]

  describe.each(DISABLED)('%s', (_label, env) => {
    it.each(REGIONAL_PRICES)('%s → plan %s, region %s, currency %s, portal config still resolve', (priceId, plan, region, currency) => {
      expect(resolvePlanFromStripePrice(priceId, env)).toBe(plan)                  // webhook plan resolution
      expect(currencyForStripePrice(priceId, env)).toBe(currency)                  // portal routing
      expect(portalConfigurationForCurrency(currencyForStripePrice(priceId, env), env))
        .toBe(`bpc_${currency.toLowerCase()}`)
      expect(displayRegionForStoredPrice(priceId, env)).toBe(region)               // paid display
    })
  })

  it('new checkout IS blocked for the disabled region (subscriber workspace included)', () => {
    expect(parseCheckoutRequest({ plan: 'GROWTH', region: 'GM', currency: 'GMD' }, PROD, 'ws_gmd_subscriber').ok).toBe(false)
    expect(parseCheckoutRequest({ plan: 'GROWTH', region: 'XOF_ZONE', currency: 'XOF' }, PROD_GM, 'ws_xof_subscriber').ok).toBe(false)
    expect(parseCheckoutRequest({ plan: 'GROWTH', region: 'GM', currency: 'GMD' }, PROD_XOF, 'ws_gmd_subscriber').ok).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// USD is unchanged by every Production regional setting (pure)
// ─────────────────────────────────────────────────────────────────────────────

describe('USD unchanged', () => {
  const SETTINGS = [PROD, PROD_GM, PROD_XOF, PROD_BOTH, PROD_BOTH_CERT]

  it('GLOBAL is always selectable and USD checkout accepted for any workspace', () => {
    for (const env of SETTINGS) {
      for (const ws of [WS_LISTED, WS_UNLISTED, null]) {
        expect(selectableRegions(env, ws)[0]).toBe('GLOBAL')
        expect(resolvePageRegion('GLOBAL', env, ws)).toBe('GLOBAL')
        for (const [priceId, plan] of USD_PRICES) {
          const parsed = parseCheckoutRequest({ plan, region: 'GLOBAL', currency: 'USD' }, env, ws)
          expect(parsed).toMatchObject({ ok: true, price: { stripePriceId: priceId, currency: 'USD' } })
        }
      }
    }
  })

  it('legacy { priceId } stays USD-only; a regional Price ID is never accepted that way', () => {
    for (const env of SETTINGS) {
      expect(parseCheckoutRequest({ priceId: 'price_usd_growth' }, env, WS_LISTED).ok).toBe(true)
      for (const [priceId] of REGIONAL_PRICES) expect(parseCheckoutRequest({ priceId }, env, WS_LISTED).ok).toBe(false)
    }
  })

  it('USD webhook plan resolution, portal config and display are unchanged', () => {
    for (const env of SETTINGS) {
      for (const [priceId, plan] of USD_PRICES) {
        expect(resolvePlanFromStripePrice(priceId, env)).toBe(plan)
        expect(portalConfigurationForCurrency(currencyForStripePrice(priceId, env), env)).toBe('bpc_usd')
        expect(displayRegionForStoredPrice(priceId, env)).toBe('GLOBAL')
      }
    }
  })
})

describe('region selector label', () => {
  it('Preview keeps an explicit test marker; Production and others show a plain label', () => {
    expect(regionSelectorLabel({ VERCEL_ENV: 'preview' })).toBe('Billing currency (Preview test mode)')
    expect(regionSelectorLabel({ VERCEL_ENV: 'production' })).toBe('Billing currency')
    expect(regionSelectorLabel({})).toBe('Billing currency')
    expect(regionSelectorLabel({ VERCEL_ENV: 'production' })).not.toMatch(/preview/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Server route enforcement (EXECUTABLE, route)
// ─────────────────────────────────────────────────────────────────────────────

const GMD_AMOUNTS: Record<string, number> = { price_gmd_solo: 200_000, price_gmd_growth: 400_000, price_gmd_agency: 750_000 }
const XOF_AMOUNTS: Record<string, number> = { price_xof_solo: 15_000, price_xof_growth: 30_000, price_xof_agency: 55_000 }

function stripePrice(id: string) {
  const isXof = id in XOF_AMOUNTS
  return {
    id, active: true, currency: isXof ? 'xof' : 'gmd', unit_amount: isXof ? XOF_AMOUNTS[id] : GMD_AMOUNTS[id],
    type: 'recurring', recurring: { interval: 'month', interval_count: 1 },
  }
}

const ROUTE_ENV_KEYS = [
  ...Object.keys(ALL_PRICES),
  ...['SOLO', 'GROWTH', 'AGENCY'].map(p => `STRIPE_PRICE_${p}`),
  'BILLING_PRODUCTION_REGIONS', 'BILLING_PRODUCTION_TEST_WORKSPACES', 'BILLING_PREVIEW_REGIONS',
]
const savedEnv: Record<string, string | undefined> = {}

function request(body: unknown) {
  const origin = 'https://qbrdeck.misecuretechsolutions.com'
  const { host } = new URL(origin)
  const url = 'http://localhost:3000/api/billing/checkout'
  return {
    json: async () => body, url, nextUrl: new URL(url),
    headers: new Headers({ origin, host, 'x-forwarded-host': host, 'x-forwarded-proto': 'https' }),
  } as any
}

async function call(body: unknown, workspaceId = WS_LISTED) {
  mocks.getWorkspaceMembership.mockResolvedValue({ workspaceId, role: 'OWNER' })
  const res = await POST(request(body))
  return { status: res.status, data: await res.json() }
}

function production(extra: Record<string, string> = {}) {
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('NODE_ENV', 'production')
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v)
}

function expectNoStripe() {
  expect(mocks.createOrRetrieveCustomer).not.toHaveBeenCalled()
  expect(mocks.sessionsCreate).not.toHaveBeenCalled()
}

describe('POST /api/billing/checkout — Production gate enforced server-side', () => {
  beforeEach(() => {
    for (const k of ROUTE_ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k] }
    Object.assign(process.env, ALL_PRICES)
    vi.stubEnv('VERCEL_ENV', undefined)
    vi.stubEnv('VERCEL_URL', undefined)
    vi.stubEnv('VERCEL_BRANCH_URL', undefined)

    mocks.auth.mockReturnValue({ userId: 'clerk_owner' })
    mocks.userFindUnique.mockResolvedValue({ id: 'u1', email: 'owner@example.com', name: 'Owner' })
    mocks.subscriptionFindUnique.mockResolvedValue({ plan: 'FREE', status: 'active', stripeStatus: null, stripeSubscriptionId: null })
    mocks.createOrRetrieveCustomer.mockResolvedValue('cus_123')
    mocks.sessionsCreate.mockResolvedValue({ url: 'https://checkout.example/session' })
    mocks.pricesRetrieve.mockImplementation(async (id: string) => stripePrice(id))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    for (const k of ROUTE_ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('Production without BILLING_PRODUCTION_REGIONS: GM and XOF refused, no Stripe call', async () => {
    production()
    expect((await call({ plan: 'GROWTH', region: 'GM', currency: 'GMD' })).status).toBe(400)
    expect((await call({ plan: 'GROWTH', region: 'XOF_ZONE', currency: 'XOF' })).status).toBe(400)
    expectNoStripe()
  })

  it.each([
    ['GM',       { plan: 'GROWTH', region: 'GM',       currency: 'GMD' }, 'price_gmd_growth'],
    ['XOF_ZONE', { plan: 'AGENCY', region: 'XOF_ZONE', currency: 'XOF' }, 'price_xof_agency'],
  ])('Production + %s enabled (public): checkout with the server-side regional Price, re-certified against Stripe', async (flag, body, priceId) => {
    production({ BILLING_PRODUCTION_REGIONS: flag })
    const { status } = await call(body, WS_UNLISTED)
    expect(status).toBe(200)
    expect(mocks.pricesRetrieve).toHaveBeenCalledWith(priceId)
    const args = mocks.sessionsCreate.mock.calls[0][0]
    expect(args.line_items).toEqual([{ price: priceId, quantity: 1 }])
    expect(args.metadata).toMatchObject({ workspaceId: WS_UNLISTED, region: body.region, currency: body.currency })
  })

  it('Production + GM enabled only: XOF refused', async () => {
    production({ BILLING_PRODUCTION_REGIONS: 'GM' })
    expect((await call({ plan: 'SOLO', region: 'XOF_ZONE', currency: 'XOF' })).status).toBe(400)
    expectNoStripe()
  })

  it('certification: listed workspace → 200', async () => {
    production({ BILLING_PRODUCTION_REGIONS: 'GM,XOF_ZONE', BILLING_PRODUCTION_TEST_WORKSPACES: 'ws_cert_a,ws_cert_b' })
    expect((await call({ plan: 'SOLO', region: 'GM', currency: 'GMD' }, WS_LISTED)).status).toBe(200)
    expect(mocks.sessionsCreate.mock.calls[0][0].line_items[0].price).toBe('price_gmd_solo')
  })

  it('certification: non-listed workspace → 400, no Stripe call', async () => {
    production({ BILLING_PRODUCTION_REGIONS: 'GM,XOF_ZONE', BILLING_PRODUCTION_TEST_WORKSPACES: 'ws_cert_a,ws_cert_b' })
    const { status, data } = await call({ plan: 'SOLO', region: 'GM', currency: 'GMD' }, WS_UNLISTED)
    expect(status).toBe(400)
    expect(data.error).toBe('Checkout is not available for this billing region yet')
    expectNoStripe()
  })

  it.each([
    ['a workspaceId field naming a listed workspace', { plan: 'SOLO', region: 'GM', currency: 'GMD', workspaceId: WS_LISTED }],
    ['a priceId for a regional price',                { priceId: 'price_gmd_solo' }],
    ['a regional priceId alongside canonical fields', { plan: 'SOLO', region: 'GM', currency: 'GMD', priceId: 'price_gmd_solo' }],
    ['a region/currency mismatch',                    { plan: 'SOLO', region: 'GLOBAL', currency: 'GMD' }],
    ['an amount override',                            { plan: 'SOLO', region: 'GM', currency: 'GMD', amount: 1 }],
    ['a case-variant region',                         { plan: 'SOLO', region: 'gm', currency: 'GMD' }],
  ])('client tampering — %s — cannot bypass the gate', async (_label, body) => {
    production({ BILLING_PRODUCTION_REGIONS: 'GM,XOF_ZONE', BILLING_PRODUCTION_TEST_WORKSPACES: WS_LISTED })
    const { status } = await call(body, WS_UNLISTED)
    expect(status).toBe(400)
    expectNoStripe()
  })

  it('Development with BILLING_PRODUCTION_REGIONS cannot open regional checkout', async () => {
    vi.stubEnv('VERCEL_ENV', 'development')
    vi.stubEnv('BILLING_PRODUCTION_REGIONS', 'GM,XOF_ZONE')
    expect((await call({ plan: 'SOLO', region: 'GM', currency: 'GMD' })).status).toBe(400)
    expectNoStripe()
  })

  it('kill-switch: removing GM blocks new GMD checkout for the very workspace that already pays in GMD', async () => {
    production({ BILLING_PRODUCTION_REGIONS: 'XOF_ZONE' })
    mocks.subscriptionFindUnique.mockResolvedValue({ plan: 'FREE', status: 'canceled', stripeStatus: 'canceled', stripeSubscriptionId: 'sub_old' })
    expect((await call({ plan: 'SOLO', region: 'GM', currency: 'GMD' }, 'ws_gmd_subscriber')).status).toBe(400)
    expectNoStripe()
  })

  it.each([
    ['no regional env',          {}],
    ['both regions enabled',     { BILLING_PRODUCTION_REGIONS: 'GM,XOF_ZONE' }],
    ['certification allow-list', { BILLING_PRODUCTION_REGIONS: 'GM,XOF_ZONE', BILLING_PRODUCTION_TEST_WORKSPACES: 'ws_cert_a' }],
  ])('USD checkout unchanged in Production (%s): no Stripe price certification call, USD Price used', async (_label, extra) => {
    production(extra as Record<string, string>)
    const { status } = await call({ plan: 'GROWTH', region: 'GLOBAL', currency: 'USD' }, WS_UNLISTED)
    expect(status).toBe(200)
    expect(mocks.pricesRetrieve).not.toHaveBeenCalled()
    expect(mocks.sessionsCreate.mock.calls[0][0].line_items).toEqual([{ price: 'price_usd_growth', quantity: 1 }])
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CHECKOUT_APPROVED_REGIONS,
  PREVIEW_CHECKOUT_REGIONS,
  previewCheckoutRegions,
  isCheckoutApproved,
  getAvailableRegions,
  formatRegionalPrice,
  PAID_PLANS,
} from '@/lib/billing/regional-prices'
import { selectableRegions, resolvePageRegion, checkoutRequestBody, displayRegionForStoredPrice } from '@/lib/billing/checkout-region'

// Preview-only GMD certification path.
//  - EXECUTABLE: the gate, the page-region resolver and the checkout body,
//    each called with an explicit env object (process.env is never read).
//  - SOURCE-CONTRACT: how the billing page and BillingButton use them, read as
//    text (this repo has no component rendering harness).

const USD_ENV = {
  STRIPE_PRICE_SOLO_USD: 'price_usd_solo', STRIPE_PRICE_GROWTH_USD: 'price_usd_growth', STRIPE_PRICE_AGENCY_USD: 'price_usd_agency',
}
const GMD_ENV = {
  STRIPE_PRICE_SOLO_GMD: 'price_gmd_solo', STRIPE_PRICE_GROWTH_GMD: 'price_gmd_growth', STRIPE_PRICE_AGENCY_GMD: 'price_gmd_agency',
}
const XOF_ENV = {
  STRIPE_PRICE_SOLO_XOF: 'price_xof_solo', STRIPE_PRICE_GROWTH_XOF: 'price_xof_growth', STRIPE_PRICE_AGENCY_XOF: 'price_xof_agency',
}
const ALL_PRICES = { ...USD_ENV, ...GMD_ENV, ...XOF_ENV }

const PRODUCTION       = { ...ALL_PRICES, VERCEL_ENV: 'production', BILLING_PREVIEW_REGIONS: 'GM' }
const PREVIEW_NO_FLAG  = { ...ALL_PRICES, VERCEL_ENV: 'preview' }
const PREVIEW_GM       = { ...ALL_PRICES, VERCEL_ENV: 'preview', BILLING_PREVIEW_REGIONS: 'GM' }
const PREVIEW_XOF      = { ...ALL_PRICES, VERCEL_ENV: 'preview', BILLING_PREVIEW_REGIONS: 'XOF_ZONE' }
const PREVIEW_BOTH     = { ...ALL_PRICES, VERCEL_ENV: 'preview', BILLING_PREVIEW_REGIONS: 'GM,XOF_ZONE' }

const compact = (s: string) => s.replace(/\s/g, '')

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

describe('Preview checkout gate (EXECUTABLE)', () => {
  it('Production config is unchanged and the Preview ceiling is GM and XOF_ZONE', () => {
    expect(CHECKOUT_APPROVED_REGIONS).toEqual({ GLOBAL: true, GM: false, XOF_ZONE: false })
    expect(PREVIEW_CHECKOUT_REGIONS).toEqual(['GM', 'XOF_ZONE'])
  })

  it.each([
    ['production + flag',          PRODUCTION,                                        ['GLOBAL']],
    ['preview without flag',       PREVIEW_NO_FLAG,                                   ['GLOBAL']],
    ['preview + empty flag',       { ...PREVIEW_NO_FLAG, BILLING_PREVIEW_REGIONS: '' }, ['GLOBAL']],
    ['no VERCEL_ENV + flag',       { ...ALL_PRICES, BILLING_PREVIEW_REGIONS: 'GM' },   ['GLOBAL']],
    ['development + flag',         { ...PREVIEW_GM, VERCEL_ENV: 'development' },       ['GLOBAL']],
    ['"Preview" (case) + flag',    { ...PREVIEW_GM, VERCEL_ENV: 'Preview' },           ['GLOBAL']],
    ['preview + GM flag',          PREVIEW_GM,                                        ['GLOBAL', 'GM']],
  ])('%s → available regions %j', (_label, env, expected) => {
    expect(getAvailableRegions(env)).toEqual(expected)
  })

  it('D. GM-only flag never approves XOF_ZONE', () => {
    expect(isCheckoutApproved('XOF_ZONE', PREVIEW_GM)).toBe(false)
    expect(getAvailableRegions(PREVIEW_GM)).not.toContain('XOF_ZONE')
  })

  it.each(['gm', 'GMD', 'GAMBIA', '*', 'ALL', 'GLOBAL', 'GM;XOF_ZONE', 'G M'])('E. unknown flag value %j enables nothing', (flag) => {
    expect(previewCheckoutRegions({ VERCEL_ENV: 'preview', BILLING_PREVIEW_REGIONS: flag })).toEqual([])
    expect(getAvailableRegions({ ...PREVIEW_GM, BILLING_PREVIEW_REGIONS: flag })).toEqual(['GLOBAL'])
  })

  it('E. comma-separated exact codes with whitespace are parsed; duplicates collapse', () => {
    expect(previewCheckoutRegions({ VERCEL_ENV: 'preview', BILLING_PREVIEW_REGIONS: ' GM , bogus, GM ' })).toEqual(['GM'])
  })

  it('F. Preview + flag with any GMD price missing → GM not available', () => {
    for (const key of Object.keys(GMD_ENV)) {
      const env: Record<string, string> = { ...PREVIEW_GM }
      delete env[key]
      expect(getAvailableRegions(env)).toEqual(['GLOBAL'])
    }
  })

  it('G. Preview + flag with a GMD price duplicating a USD price → no regions (fail closed)', () => {
    expect(getAvailableRegions({ ...PREVIEW_GM, STRIPE_PRICE_GROWTH_GMD: 'price_usd_growth' })).toEqual([])
  })
})

describe('Preview-only XOF certification gate (EXECUTABLE)', () => {
  it.each([
    ['A. production + both flags',        { ...PRODUCTION, BILLING_PREVIEW_REGIONS: 'GM,XOF_ZONE' }, ['GLOBAL']],
    ['A. production + XOF flag',          { ...PRODUCTION, BILLING_PREVIEW_REGIONS: 'XOF_ZONE' },    ['GLOBAL']],
    ['B. preview without flag',           PREVIEW_NO_FLAG,                                           ['GLOBAL']],
    ['B. preview + GM only',              PREVIEW_GM,                                                ['GLOBAL', 'GM']],
    ['C. preview + XOF_ZONE',             PREVIEW_XOF,                                               ['GLOBAL', 'XOF_ZONE']],
    ['D. preview + GM,XOF_ZONE',          PREVIEW_BOTH,                                              ['GLOBAL', 'GM', 'XOF_ZONE']],
    ['D. preview + XOF_ZONE,GM',          { ...PREVIEW_BOTH, BILLING_PREVIEW_REGIONS: 'XOF_ZONE,GM' }, ['GLOBAL', 'GM', 'XOF_ZONE']],
    ['D. preview + whitespace',           { ...PREVIEW_BOTH, BILLING_PREVIEW_REGIONS: ' GM , XOF_ZONE ' }, ['GLOBAL', 'GM', 'XOF_ZONE']],
    ['no VERCEL_ENV + both flags',        { ...ALL_PRICES, BILLING_PREVIEW_REGIONS: 'GM,XOF_ZONE' }, ['GLOBAL']],
    ['development + both flags',          { ...PREVIEW_BOTH, VERCEL_ENV: 'development' },            ['GLOBAL']],
    ['"Preview" (case) + both flags',     { ...PREVIEW_BOTH, VERCEL_ENV: 'Preview' },                ['GLOBAL']],
  ])('%s → available regions %j', (_label, env, expected) => {
    expect(getAvailableRegions(env)).toEqual(expected)
  })

  it.each(['XOF', 'xof', 'xof_zone', 'Xof_Zone', 'XOF ZONE', 'XOF-ZONE', 'XOFZONE', 'CFA', '*', 'ALL', 'XOF_ZONE;GM', 'gm,xof_zone'])(
    'E. inexact flag value %j enables nothing',
    (flag) => {
      expect(previewCheckoutRegions({ VERCEL_ENV: 'preview', BILLING_PREVIEW_REGIONS: flag })).toEqual([])
      expect(getAvailableRegions({ ...PREVIEW_BOTH, BILLING_PREVIEW_REGIONS: flag })).toEqual(['GLOBAL'])
    },
  )

  it('E. only the exact codes survive a mixed flag', () => {
    expect(previewCheckoutRegions({ VERCEL_ENV: 'preview', BILLING_PREVIEW_REGIONS: 'xof,XOF_ZONE,ALL,GM,*' })).toEqual(['GM', 'XOF_ZONE'])
  })

  it.each(Object.keys(XOF_ENV))('F. missing %s → XOF unavailable, GM unaffected', (key) => {
    const env: Record<string, string> = { ...PREVIEW_BOTH }
    delete env[key]
    expect(getAvailableRegions(env)).toEqual(['GLOBAL', 'GM'])
  })

  it.each([
    ['G. XOF duplicating USD',         { STRIPE_PRICE_GROWTH_XOF: 'price_usd_growth' }],
    ['H. XOF duplicating GMD',         { STRIPE_PRICE_AGENCY_XOF: 'price_gmd_agency' }],
    ['I. two XOF plans sharing a price', { STRIPE_PRICE_AGENCY_XOF: 'price_xof_solo' }],
  ])('%s → no regions at all (fail closed)', (_label, override) => {
    expect(getAvailableRegions({ ...PREVIEW_BOTH, ...override })).toEqual([])
  })
})

describe('billing page region resolution (EXECUTABLE)', () => {
  it('M. Production: only GLOBAL is selectable, so no selector; ?region=GM falls back to GLOBAL', () => {
    expect(selectableRegions(PRODUCTION)).toEqual(['GLOBAL'])
    expect(resolvePageRegion('GM', PRODUCTION)).toBe('GLOBAL')
  })

  it('N. Preview without the flag: only GLOBAL is selectable; ?region=GM falls back to GLOBAL', () => {
    expect(selectableRegions(PREVIEW_NO_FLAG)).toEqual(['GLOBAL'])
    expect(resolvePageRegion('GM', PREVIEW_NO_FLAG)).toBe('GLOBAL')
  })

  it('O. Preview with the GM flag: GLOBAL and GM are selectable', () => {
    expect(selectableRegions(PREVIEW_GM)).toEqual(['GLOBAL', 'GM'])
    expect(resolvePageRegion('GM', PREVIEW_GM)).toBe('GM')
    expect(resolvePageRegion('GLOBAL', PREVIEW_GM)).toBe('GLOBAL')
  })

  it.each([undefined, null, '', 'XOF_ZONE', 'gm', 'bogus', ['GM'], 42])('untrusted ?region=%j resolves to GLOBAL', (requested) => {
    expect(resolvePageRegion(requested, PREVIEW_GM)).toBe('GLOBAL')
  })

  it.each(PAID_PLANS)('P. selecting GM sends { plan: %s, region: GM, currency: GMD }', (plan) => {
    expect(checkoutRequestBody(plan, 'GM')).toEqual({ plan, region: 'GM', currency: 'GMD' })
  })

  it.each(PAID_PLANS)('Q. selecting GLOBAL sends { plan: %s, region: GLOBAL, currency: USD }', (plan) => {
    expect(checkoutRequestBody(plan, 'GLOBAL')).toEqual({ plan, region: 'GLOBAL', currency: 'USD' })
  })

  it('R. GM displays D2,000 / D4,000 / D7,500; GLOBAL displays $49 / $99 / $199', () => {
    expect(PAID_PLANS.map(p => compact(formatRegionalPrice(p, 'GM')))).toEqual(['D2,000', 'D4,000', 'D7,500'])
    expect(PAID_PLANS.map(p => compact(formatRegionalPrice(p, 'GLOBAL')))).toEqual(['$49', '$99', '$199'])
  })

  // XOF selector combinations for a FREE Preview workspace.
  it.each([
    ['GM only',          PREVIEW_GM,   ['GLOBAL', 'GM']],
    ['XOF_ZONE only',    PREVIEW_XOF,  ['GLOBAL', 'XOF_ZONE']],
    ['GM,XOF_ZONE',      PREVIEW_BOTH, ['GLOBAL', 'GM', 'XOF_ZONE']],
  ])('XOF selector: %s → selectable %j', (_label, env, expected) => {
    expect(selectableRegions(env)).toEqual(expected)
  })

  it('XOF_ZONE only: ?region=XOF_ZONE selects XOF; ?region=GM falls back to GLOBAL', () => {
    expect(resolvePageRegion('XOF_ZONE', PREVIEW_XOF)).toBe('XOF_ZONE')
    expect(resolvePageRegion('GM', PREVIEW_XOF)).toBe('GLOBAL')
  })

  it('GM,XOF_ZONE: each region resolves to itself', () => {
    expect(resolvePageRegion('GM', PREVIEW_BOTH)).toBe('GM')
    expect(resolvePageRegion('XOF_ZONE', PREVIEW_BOTH)).toBe('XOF_ZONE')
    expect(resolvePageRegion('GLOBAL', PREVIEW_BOTH)).toBe('GLOBAL')
  })

  it.each(['xof_zone', 'XOF', 'Xof_Zone', ['XOF_ZONE']])('untrusted ?region=%j under GM,XOF_ZONE resolves to GLOBAL', (requested) => {
    expect(resolvePageRegion(requested, PREVIEW_BOTH)).toBe('GLOBAL')
  })

  it('Production: ?region=XOF_ZONE falls back to GLOBAL', () => {
    expect(resolvePageRegion('XOF_ZONE', { ...PRODUCTION, BILLING_PREVIEW_REGIONS: 'GM,XOF_ZONE' })).toBe('GLOBAL')
  })

  it.each(PAID_PLANS)('S. selecting XOF_ZONE sends { plan: %s, region: XOF_ZONE, currency: XOF }', (plan) => {
    expect(checkoutRequestBody(plan, 'XOF_ZONE')).toEqual({ plan, region: 'XOF_ZONE', currency: 'XOF' })
  })

  it('XOF_ZONE displays the existing Intl CFA format for 15,000 / 30,000 / 55,000', () => {
    expect(PAID_PLANS.map(p => compact(formatRegionalPrice(p, 'XOF_ZONE')))).toEqual(['15000FCFA', '30000FCFA', '55000FCFA'])
  })
})

describe('billing card display currency (EXECUTABLE)', () => {
  const cards = (region: Parameters<typeof formatRegionalPrice>[1]) =>
    PAID_PLANS.map(p => compact(formatRegionalPrice(p, region)))
  const USD_CARDS = ['$49', '$99', '$199']
  const GMD_CARDS = ['D2,000', 'D4,000', 'D7,500']

  // A/B: a free workspace displays whatever the selector resolved.
  it('A. free Preview workspace + GLOBAL selected → USD cards', () => {
    expect(cards(resolvePageRegion('GLOBAL', PREVIEW_GM))).toEqual(USD_CARDS)
  })

  it('B. free Preview workspace + GM selected → GMD cards', () => {
    expect(cards(resolvePageRegion('GM', PREVIEW_GM))).toEqual(GMD_CARDS)
  })

  // C–H: a paid workspace displays the region of its stored Price. The helper
  // takes no query parameter, so ?region= (E/F) cannot reach it.
  it('C. paid USD workspace (Preview + GM flag) → USD cards', () => {
    expect(cards(displayRegionForStoredPrice('price_usd_growth', PREVIEW_GM))).toEqual(USD_CARDS)
  })

  it('D. paid GMD workspace (Preview + GM flag) → GMD cards', () => {
    expect(cards(displayRegionForStoredPrice('price_gmd_agency', PREVIEW_GM))).toEqual(GMD_CARDS)
  })

  it('E. paid GMD workspace with ?region=GLOBAL → still GMD cards', () => {
    const pageRegion = resolvePageRegion('GLOBAL', PREVIEW_GM)
    expect(pageRegion).toBe('GLOBAL')
    expect(cards(displayRegionForStoredPrice('price_gmd_agency', PREVIEW_GM))).toEqual(GMD_CARDS)
  })

  it('F. paid USD workspace with ?region=GM → still USD cards', () => {
    const pageRegion = resolvePageRegion('GM', PREVIEW_GM)
    expect(pageRegion).toBe('GM')
    expect(cards(displayRegionForStoredPrice('price_usd_growth', PREVIEW_GM))).toEqual(USD_CARDS)
  })

  it('G. Production paid USD workspace → USD cards (new and legacy USD env names)', () => {
    expect(cards(displayRegionForStoredPrice('price_usd_solo', PRODUCTION))).toEqual(USD_CARDS)
    expect(cards(displayRegionForStoredPrice('price_legacy_solo', { STRIPE_PRICE_SOLO: 'price_legacy_solo', VERCEL_ENV: 'production' })))
      .toEqual(USD_CARDS)
  })

  it('paid display derives from the stored Price, not the Preview flag', () => {
    expect(displayRegionForStoredPrice('price_gmd_solo', PREVIEW_NO_FLAG)).toBe('GM')
    expect(displayRegionForStoredPrice('price_usd_solo', PREVIEW_GM)).toBe('GLOBAL')
  })

  it.each([
    ['unknown Price ID',               'price_bogus',      PREVIEW_GM],
    ['null Price ID',                  null,               PREVIEW_GM],
    ['undefined Price ID',             undefined,          PREVIEW_GM],
    ['empty Price ID',                 '',                 PREVIEW_GM],
    ['GMD Price ID with GMD env unset', 'price_gmd_agency', { ...USD_ENV, VERCEL_ENV: 'preview', BILLING_PREVIEW_REGIONS: 'GM' }],
    ['duplicate-price config error',   'price_gmd_growth', { ...PREVIEW_GM, STRIPE_PRICE_GROWTH_GMD: 'price_usd_growth' }],
  ])('H. %s → default USD cards, never a guessed GMD display', (_label, priceId, env) => {
    expect(displayRegionForStoredPrice(priceId, env)).toBe('GLOBAL')
    expect(cards(displayRegionForStoredPrice(priceId, env))).toEqual(USD_CARDS)
  })

  // T. Paid USD/GMD/XOF workspaces each display their own card currency.
  const XOF_CARDS = ['15000FCFA', '30000FCFA', '55000FCFA']

  it('T. free Preview workspace + XOF_ZONE selected → XOF cards', () => {
    expect(cards(resolvePageRegion('XOF_ZONE', PREVIEW_BOTH))).toEqual(XOF_CARDS)
  })

  it.each([
    ['paid USD',  'price_usd_growth', USD_CARDS],
    ['paid GMD',  'price_gmd_agency', GMD_CARDS],
    ['paid XOF',  'price_xof_solo',   XOF_CARDS],
  ])('T. %s workspace (Preview + GM,XOF_ZONE) → own currency cards', (_label, priceId, expected) => {
    expect(cards(displayRegionForStoredPrice(priceId, PREVIEW_BOTH))).toEqual(expected)
  })

  it.each(['GLOBAL', 'GM'])('T. paid XOF workspace with ?region=%s → still XOF cards', (requested) => {
    expect(resolvePageRegion(requested, PREVIEW_BOTH)).toBe(requested)
    expect(cards(displayRegionForStoredPrice('price_xof_growth', PREVIEW_BOTH))).toEqual(XOF_CARDS)
  })

  it('T. paid USD/GMD workspaces with ?region=XOF_ZONE → still their own cards', () => {
    expect(resolvePageRegion('XOF_ZONE', PREVIEW_BOTH)).toBe('XOF_ZONE')
    expect(cards(displayRegionForStoredPrice('price_usd_growth', PREVIEW_BOTH))).toEqual(USD_CARDS)
    expect(cards(displayRegionForStoredPrice('price_gmd_agency', PREVIEW_BOTH))).toEqual(GMD_CARDS)
  })

  it('T. paid XOF display derives from the stored Price, not the Preview flag', () => {
    expect(displayRegionForStoredPrice('price_xof_agency', PREVIEW_NO_FLAG)).toBe('XOF_ZONE')
    expect(displayRegionForStoredPrice('price_xof_agency', PREVIEW_GM)).toBe('XOF_ZONE')
  })

  it.each([
    ['XOF Price ID with XOF env unset', 'price_xof_agency', { ...USD_ENV, ...GMD_ENV, VERCEL_ENV: 'preview', BILLING_PREVIEW_REGIONS: 'GM,XOF_ZONE' }],
    ['XOF/USD duplicate config error',  'price_xof_growth', { ...PREVIEW_BOTH, STRIPE_PRICE_SOLO_XOF: 'price_usd_solo' }],
  ])('T. %s → default USD cards, never a guessed XOF display', (_label, priceId, env) => {
    expect(displayRegionForStoredPrice(priceId, env)).toBe('GLOBAL')
  })
})

describe('billing page and BillingButton use the server-resolved region (SOURCE-CONTRACT)', () => {
  const page   = readSourceLF('app/(app)/dashboard/billing/page.tsx')
  const button = readSourceLF('app/(app)/dashboard/billing/billing-button.tsx')

  it('the selector renders only when GM is actually enabled, for an Owner, without a live paid subscription', () => {
    // Scoped to the ACTIVE workspace (Production certification allow-list).
    expect(page).toMatch(/const regions = selectableRegions\(process\.env, workspaceId\)/)
    expect(page).toMatch(/const showRegionSelector = canManageBilling && regions\.length > 1 && !hasLivePaidSubscription\(guardSub\)/)
    expect(page).toMatch(/\{showRegionSelector && \(/)
    // Options come only from the server's selectable list.
    expect(page).toMatch(/\{regions\.map\(code =>/)
  })

  it('the guard query is the same one the checkout route uses', () => {
    expect(page).toContain('select: { plan: true, status: true, stripeStatus: true, stripeSubscriptionId: true }')
  })

  it('without the selector the page is always GLOBAL, whatever ?region= says', () => {
    expect(page).toMatch(/const region\s*=\s*showRegionSelector \? resolvePageRegion\(searchParams\?\.region, process\.env, workspaceId\) : 'GLOBAL'/)
  })

  it('prices follow the display region; checkout availability follows the resolved region', () => {
    expect(page).toMatch(/formatRegionalPrice\(planKey, displayRegion\)/)
    expect(page).not.toMatch(/formatRegionalPrice\(planKey, region\)/)
    expect(page).toMatch(/const checkoutAvailable = regions\.includes\(region\)/)
    expect(page).toMatch(/<BillingButton planKey=\{planKey\} isCurrent=\{isCurrent\} checkoutAvailable=\{checkoutAvailable\} region=\{region\} \/>/)
  })

  it('a paid workspace displays the region of its stored stripePriceId; a free one displays the resolved region', () => {
    expect(page).toMatch(/const hasPaidSub\s*=\s*hasLivePaidSubscription\(guardSub\)/)
    expect(page).toMatch(/select: \{ stripePriceId: true \}/)
    expect(page).toMatch(/const displayRegion = hasPaidSub \? displayRegionForStoredPrice\(storedPrice\?\.stripePriceId\) : region/)
    // The paid display path never reads ?region= or the Preview flag.
    expect(page).not.toMatch(/displayRegionForStoredPrice\([^)]*searchParams/)
  })

  it('BillingButton sends checkoutRequestBody(planKey, region), never a hardcoded USD body', () => {
    expect(button).toMatch(/body\s*:\s*JSON\.stringify\(checkoutRequestBody\(planKey as PaidPlan, region\)\)/)
    expect(button).not.toMatch(/region:\s*'GLOBAL',\s*currency:\s*'USD'/)
    expect(button).toMatch(/region = 'GLOBAL',/)   // default when no region is passed
  })
})

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
import { selectableRegions, resolvePageRegion, checkoutRequestBody } from '@/lib/billing/checkout-region'

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

const compact = (s: string) => s.replace(/\s/g, '')

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

describe('Preview checkout gate (EXECUTABLE)', () => {
  it('Production config is unchanged and the Preview ceiling is GM only', () => {
    expect(CHECKOUT_APPROVED_REGIONS).toEqual({ GLOBAL: true, GM: false, XOF_ZONE: false })
    expect(PREVIEW_CHECKOUT_REGIONS).toEqual(['GM'])
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

  it.each(['XOF_ZONE', 'GM,XOF_ZONE', 'XOF_ZONE,GM'])('D. flag %j never approves XOF_ZONE', (flag) => {
    const env = { ...PREVIEW_GM, BILLING_PREVIEW_REGIONS: flag }
    expect(isCheckoutApproved('XOF_ZONE', env)).toBe(false)
    expect(getAvailableRegions(env)).not.toContain('XOF_ZONE')
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
})

describe('billing page and BillingButton use the server-resolved region (SOURCE-CONTRACT)', () => {
  const page   = readSourceLF('app/(app)/dashboard/billing/page.tsx')
  const button = readSourceLF('app/(app)/dashboard/billing/billing-button.tsx')

  it('the selector renders only when GM is actually enabled, for an Owner, without a live paid subscription', () => {
    expect(page).toMatch(/const regions = selectableRegions\(\)/)
    expect(page).toMatch(/const showRegionSelector = canManageBilling && regions\.length > 1 && !hasLivePaidSubscription\(guardSub\)/)
    expect(page).toMatch(/\{showRegionSelector && \(/)
    // Options come only from the server's selectable list.
    expect(page).toMatch(/\{regions\.map\(code =>/)
  })

  it('the guard query is the same one the checkout route uses', () => {
    expect(page).toContain('select: { plan: true, status: true, stripeStatus: true, stripeSubscriptionId: true }')
  })

  it('without the selector the page is always GLOBAL, whatever ?region= says', () => {
    expect(page).toMatch(/const region\s*=\s*showRegionSelector \? resolvePageRegion\(searchParams\?\.region\) : 'GLOBAL'/)
  })

  it('prices and checkout availability follow the resolved region', () => {
    expect(page).toMatch(/formatRegionalPrice\(planKey, region\)/)
    expect(page).toMatch(/const checkoutAvailable = regions\.includes\(region\)/)
    expect(page).toMatch(/<BillingButton planKey=\{planKey\} isCurrent=\{isCurrent\} checkoutAvailable=\{checkoutAvailable\} region=\{region\} \/>/)
  })

  it('BillingButton sends checkoutRequestBody(planKey, region), never a hardcoded USD body', () => {
    expect(button).toMatch(/body\s*:\s*JSON\.stringify\(checkoutRequestBody\(planKey as PaidPlan, region\)\)/)
    expect(button).not.toMatch(/region:\s*'GLOBAL',\s*currency:\s*'USD'/)
    expect(button).toMatch(/region = 'GLOBAL',/)   // default when no region is passed
  })
})

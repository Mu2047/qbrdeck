import { describe, it, expect } from 'vitest'
import { CURRENCIES, isBillingCurrency } from '@/lib/billing/currencies'
import { REGIONS, currencyForRegion, suggestRegionForCountry, isBillingRegion } from '@/lib/billing/regions'
import { formatPrice } from '@/lib/billing/format-price'
import {
  APPROVED_PRICE_AMOUNTS,
  CHECKOUT_APPROVED_REGIONS,
  PAID_PLANS,
  formatRegionalPrice,
  getRegionalPriceTable,
  getAvailableRegions,
} from '@/lib/billing/regional-prices'
import { PLAN_LIMITS } from '@/lib/limits'

// EXECUTABLE tests for the pure regional-pricing domain (lib/billing/*).
// No database, no Stripe client, no env from the real process — every
// resolver call passes an explicit env object.

// Intl inserts (narrow) no-break spaces in some locales ("D 2,000",
// "15 000 F CFA"); compare on a whitespace-free form.
const compact = (s: string) => s.replace(/\s/g, '')

const USD_ONLY_ENV = {
  STRIPE_PRICE_SOLO:   'price_legacy_solo',
  STRIPE_PRICE_GROWTH: 'price_legacy_growth',
  STRIPE_PRICE_AGENCY: 'price_legacy_agency',
}

describe('currency metadata', () => {
  it('USD and GMD have 2 minor digits; XOF is zero-decimal', () => {
    expect(CURRENCIES.USD.minorUnitDigits).toBe(2)
    expect(CURRENCIES.GMD.minorUnitDigits).toBe(2)
    expect(CURRENCIES.XOF.minorUnitDigits).toBe(0)
  })

  it('USD formats in en-US', () => {
    expect(CURRENCIES.USD.locale).toBe('en-US')
  })

  it('rejects unsupported currency codes', () => {
    expect(isBillingCurrency('USD')).toBe(true)
    expect(isBillingCurrency('EUR')).toBe(false)
    expect(isBillingCurrency('usd')).toBe(false)
    expect(isBillingCurrency(undefined)).toBe(false)
  })
})

describe('formatPrice — Intl.NumberFormat, minor units, no forced decimals', () => {
  it('USD keeps the existing whole-dollar display', () => {
    expect(formatPrice(4_900, 'USD')).toBe('$49')
    expect(formatPrice(9_900, 'USD')).toBe('$99')
    expect(formatPrice(19_900, 'USD')).toBe('$199')
    expect(formatPrice(0, 'USD')).toBe('$0')
  })

  it('USD never renders .00 for whole amounts but keeps cents when present', () => {
    expect(formatPrice(4_900, 'USD')).not.toContain('.00')
    expect(formatPrice(4_950, 'USD')).toBe('$49.50')
  })

  it('GMD scales from minor units to D2,000 / D4,000 / D7,500', () => {
    expect(compact(formatPrice(200_000, 'GMD'))).toBe('D2,000')
    expect(compact(formatPrice(400_000, 'GMD'))).toBe('D4,000')
    expect(compact(formatPrice(750_000, 'GMD'))).toBe('D7,500')
  })

  it('XOF is zero-decimal — the amount is not divided and has no decimals', () => {
    for (const [amount, digits] of [[15_000, '15000'], [30_000, '30000'], [55_000, '55000']] as const) {
      const out = formatPrice(amount, 'XOF')
      expect(out).toMatch(/CFA/)
      expect(out).not.toMatch(/[.,]\d{2}\b/)
      expect(compact(out).replace(/\D/g, '')).toBe(digits)
    }
  })

  it('rejects non-integer or negative minor-unit amounts', () => {
    expect(() => formatPrice(49.5, 'USD')).toThrow()
    expect(() => formatPrice(-1, 'USD')).toThrow()
  })
})

describe('regions', () => {
  it('each region has exactly one billing currency', () => {
    expect(currencyForRegion('GLOBAL')).toBe('USD')
    expect(currencyForRegion('GM')).toBe('GMD')
    expect(currencyForRegion('XOF_ZONE')).toBe('XOF')
  })

  it('XOF_ZONE contains exactly the 8 approved countries', () => {
    expect([...REGIONS.XOF_ZONE.countries].sort()).toEqual(['BF', 'BJ', 'CI', 'GW', 'ML', 'NE', 'SN', 'TG'])
  })

  it('suggests GM for The Gambia and XOF_ZONE for every XOF country', () => {
    expect(suggestRegionForCountry('GM')).toBe('GM')
    for (const c of ['SN', 'CI', 'ML', 'BF', 'BJ', 'TG', 'NE', 'GW']) {
      expect(suggestRegionForCountry(c)).toBe('XOF_ZONE')
      expect(suggestRegionForCountry(c.toLowerCase())).toBe('XOF_ZONE')
    }
  })

  it('unsupported or missing countries suggest GLOBAL only', () => {
    for (const c of ['US', 'NG', 'GH', 'CM', 'FR', '', null, undefined]) {
      expect(suggestRegionForCountry(c)).toBe('GLOBAL')
    }
  })

  it('rejects unsupported region codes', () => {
    expect(isBillingRegion('GLOBAL')).toBe(true)
    expect(isBillingRegion('NG')).toBe(false)
    expect(isBillingRegion('xof_zone')).toBe(false)
  })
})

describe('approved regional amounts', () => {
  it('all 9 plan/region cells carry the approved amount in minor units', () => {
    expect(APPROVED_PRICE_AMOUNTS).toEqual({
      GLOBAL:   { SOLO: 4_900,   GROWTH: 9_900,   AGENCY: 19_900 },
      GM:       { SOLO: 200_000, GROWTH: 400_000, AGENCY: 750_000 },
      XOF_ZONE: { SOLO: 15_000,  GROWTH: 30_000,  AGENCY: 55_000 },
    })
  })

  it('formatRegionalPrice renders the approved amounts', () => {
    expect(formatRegionalPrice('SOLO', 'GLOBAL')).toBe('$49')
    expect(formatRegionalPrice('GROWTH', 'GLOBAL')).toBe('$99')
    expect(formatRegionalPrice('AGENCY', 'GLOBAL')).toBe('$199')
    expect(compact(formatRegionalPrice('AGENCY', 'GM'))).toBe('D7,500')
    expect(compact(formatRegionalPrice('AGENCY', 'XOF_ZONE')).replace(/\D/g, '')).toBe('55000')
  })

  it('only GLOBAL is approved for checkout in code; GM and XOF_ZONE are disabled', () => {
    expect(CHECKOUT_APPROVED_REGIONS).toEqual({ GLOBAL: true, GM: false, XOF_ZONE: false })
  })

  it('with the current Production env shape, only USD cells are checkout-enabled', () => {
    const table = getRegionalPriceTable(USD_ONLY_ENV)
    expect(table).toHaveLength(9)
    for (const p of table) {
      if (p.currency === 'USD') {
        expect(p.checkoutEnabled).toBe(true)
        expect(p.recognized).toBe(true)
      } else {
        expect(p.checkoutEnabled).toBe(false)
        expect(p.stripePriceId).toBeUndefined()
      }
    }
    expect(getAvailableRegions(USD_ONLY_ENV)).toEqual(['GLOBAL'])
  })

  it('GMD/XOF stay disabled for checkout even if Price ID env vars are set', () => {
    const env = {
      ...USD_ONLY_ENV,
      STRIPE_PRICE_SOLO_GMD: 'price_gmd_solo', STRIPE_PRICE_GROWTH_GMD: 'price_gmd_growth', STRIPE_PRICE_AGENCY_GMD: 'price_gmd_agency',
      STRIPE_PRICE_SOLO_XOF: 'price_xof_solo', STRIPE_PRICE_GROWTH_XOF: 'price_xof_growth', STRIPE_PRICE_AGENCY_XOF: 'price_xof_agency',
    }
    for (const p of getRegionalPriceTable(env).filter(p => p.currency !== 'USD')) {
      expect(p.checkoutEnabled).toBe(false)
    }
    expect(getAvailableRegions(env)).toEqual(['GLOBAL'])
  })

  it('no checkout region is available when USD Price IDs are missing', () => {
    expect(getAvailableRegions({})).toEqual([])
  })

  it('pricing config carries no entitlement fields', () => {
    const limitKeys = Object.keys(PLAN_LIMITS.AGENCY)
    for (const p of getRegionalPriceTable(USD_ONLY_ENV)) {
      expect(Object.keys(p).sort()).toEqual(
        ['checkoutEnabled', 'currency', 'plan', 'recognized', 'region', 'stripePriceId', 'unitAmountMinor'].sort()
      )
      for (const k of limitKeys) expect(p).not.toHaveProperty(k)
    }
  })

  it('every paid plan has a price in every region', () => {
    for (const region of Object.keys(REGIONS) as (keyof typeof REGIONS)[]) {
      for (const plan of PAID_PLANS) expect(APPROVED_PRICE_AMOUNTS[region][plan]).toBeGreaterThan(0)
    }
  })
})

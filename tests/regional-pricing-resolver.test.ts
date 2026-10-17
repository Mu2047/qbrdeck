import { describe, it, expect } from 'vitest'
import {
  BillingConfigError,
  MissingStripePriceError,
  UnknownStripePriceError,
  getRegionalPrice,
  getRegionalPriceTable,
  getAvailableRegions,
  resolvePlanFromStripePrice,
  type PaidPlan,
} from '@/lib/billing/regional-prices'
import { getLimits } from '@/lib/limits'

// EXECUTABLE tests for Stripe Price → Plan resolution. All Price IDs are
// synthetic; every call passes an explicit env object.

const LEGACY_ENV = {
  STRIPE_PRICE_SOLO:   'price_legacy_solo',
  STRIPE_PRICE_GROWTH: 'price_legacy_growth',
  STRIPE_PRICE_AGENCY: 'price_legacy_agency',
}

const ALL_CURRENCIES_ENV = {
  STRIPE_PRICE_SOLO_USD:   'price_usd_solo',   STRIPE_PRICE_GROWTH_USD: 'price_usd_growth', STRIPE_PRICE_AGENCY_USD: 'price_usd_agency',
  STRIPE_PRICE_SOLO_GMD:   'price_gmd_solo',   STRIPE_PRICE_GROWTH_GMD: 'price_gmd_growth', STRIPE_PRICE_AGENCY_GMD: 'price_gmd_agency',
  STRIPE_PRICE_SOLO_XOF:   'price_xof_solo',   STRIPE_PRICE_GROWTH_XOF: 'price_xof_growth', STRIPE_PRICE_AGENCY_XOF: 'price_xof_agency',
}

describe('USD price → plan (legacy Production env names)', () => {
  it.each([
    ['price_legacy_solo',   'SOLO'],
    ['price_legacy_growth', 'GROWTH'],
    ['price_legacy_agency', 'AGENCY'],
  ] as const)('%s → %s', (priceId, plan) => {
    expect(resolvePlanFromStripePrice(priceId, LEGACY_ENV)).toBe(plan)
  })

  it('legacy USD IDs are the checkout prices for GLOBAL', () => {
    expect(getRegionalPrice('AGENCY', 'GLOBAL', LEGACY_ENV).stripePriceId).toBe('price_legacy_agency')
  })
})

describe('every currency of a plan resolves to that one plan', () => {
  const matrix: [string, PaidPlan][] = [
    ['price_usd_solo', 'SOLO'],     ['price_gmd_solo', 'SOLO'],     ['price_xof_solo', 'SOLO'],
    ['price_usd_growth', 'GROWTH'], ['price_gmd_growth', 'GROWTH'], ['price_xof_growth', 'GROWTH'],
    ['price_usd_agency', 'AGENCY'], ['price_gmd_agency', 'AGENCY'], ['price_xof_agency', 'AGENCY'],
  ]

  it.each(matrix)('%s → %s', (priceId, plan) => {
    expect(resolvePlanFromStripePrice(priceId, ALL_CURRENCIES_ENV)).toBe(plan)
  })

  it('currency never changes entitlements — every currency of a plan gets identical limits', () => {
    for (const plan of ['SOLO', 'GROWTH', 'AGENCY'] as const) {
      const limits = matrix
        .filter(([, p]) => p === plan)
        .map(([id]) => getLimits(resolvePlanFromStripePrice(id, ALL_CURRENCIES_ENV)))
      expect(limits[1]).toEqual(limits[0])
      expect(limits[2]).toEqual(limits[0])
    }
  })

  it('synthetic GMD/XOF IDs are recognized for the webhook but never checkout-enabled', () => {
    const nonUsd = getRegionalPriceTable(ALL_CURRENCIES_ENV).filter(p => p.currency !== 'USD')
    expect(nonUsd).toHaveLength(6)
    for (const p of nonUsd) {
      expect(p.recognized).toBe(true)
      expect(p.checkoutEnabled).toBe(false)
    }
  })
})

describe('unknown / missing Price IDs fail closed — never FREE', () => {
  it('an unknown non-empty Price ID throws UnknownStripePriceError', () => {
    expect(() => resolvePlanFromStripePrice('price_attacker', LEGACY_ENV)).toThrow(UnknownStripePriceError)
  })

  it('an unknown Price ID never resolves to FREE', () => {
    let result: unknown
    try { result = resolvePlanFromStripePrice('price_unknown', LEGACY_ENV) } catch { /* expected */ }
    expect(result).toBeUndefined()
  })

  it('a missing Price ID throws MissingStripePriceError', () => {
    expect(() => resolvePlanFromStripePrice(undefined, LEGACY_ENV)).toThrow(MissingStripePriceError)
    expect(() => resolvePlanFromStripePrice('', LEGACY_ENV)).toThrow(MissingStripePriceError)
    expect(() => resolvePlanFromStripePrice(null, LEGACY_ENV)).toThrow(MissingStripePriceError)
  })

  it('a known USD ID stops resolving once its env var is removed (no stale fallback)', () => {
    expect(() => resolvePlanFromStripePrice('price_legacy_agency', {})).toThrow(UnknownStripePriceError)
  })
})

describe('configuration validation', () => {
  it('new *_USD names take effect when the legacy names are absent', () => {
    expect(getRegionalPrice('SOLO', 'GLOBAL', { STRIPE_PRICE_SOLO_USD: 'price_new' }).stripePriceId).toBe('price_new')
  })

  it('new and legacy USD names set to the SAME value are accepted', () => {
    const env = { ...LEGACY_ENV, STRIPE_PRICE_SOLO_USD: 'price_legacy_solo' }
    expect(resolvePlanFromStripePrice('price_legacy_solo', env)).toBe('SOLO')
  })

  it('new and legacy USD names set to DIFFERENT values fail closed', () => {
    const env = { ...LEGACY_ENV, STRIPE_PRICE_SOLO_USD: 'price_other' }
    expect(() => getRegionalPriceTable(env)).toThrow(BillingConfigError)
    expect(() => resolvePlanFromStripePrice('price_legacy_solo', env)).toThrow(BillingConfigError)
    expect(getAvailableRegions(env)).toEqual([])
  })

  it('the same Price ID configured for two plans fails config validation', () => {
    const env = { ...LEGACY_ENV, STRIPE_PRICE_GROWTH: 'price_legacy_solo' }
    expect(() => getRegionalPriceTable(env)).toThrow(BillingConfigError)
    expect(() => resolvePlanFromStripePrice('price_legacy_solo', env)).toThrow(BillingConfigError)
  })

  it('the same Price ID configured for two currencies of one plan also fails', () => {
    const env = { ...LEGACY_ENV, STRIPE_PRICE_SOLO_GMD: 'price_legacy_solo' }
    expect(() => getRegionalPriceTable(env)).toThrow(BillingConfigError)
  })

  it('blank env values are treated as unset', () => {
    const env = { ...LEGACY_ENV, STRIPE_PRICE_SOLO_USD: '   ' }
    expect(getRegionalPrice('SOLO', 'GLOBAL', env).stripePriceId).toBe('price_legacy_solo')
  })
})

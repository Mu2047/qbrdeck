import { describe, it, expect } from 'vitest'
import {
  portalConfigurationForCurrency,
  portalConfigEnvKey,
  currencyForStripePrice,
  PortalConfigError,
} from '@/lib/billing/portal-config'
import {
  getRegionalPrice,
  MissingStripePriceError,
  UnknownStripePriceError,
  BillingConfigError,
} from '@/lib/billing/regional-prices'

// EXECUTABLE tests for the portal configuration resolver. Pure — every call
// takes an explicit env object, so process.env is never read.

const PORTAL_ENV = {
  STRIPE_PORTAL_CONFIG_USD: 'bpc_usd',
  STRIPE_PORTAL_CONFIG_GMD: 'bpc_gmd',
  STRIPE_PORTAL_CONFIG_XOF: 'bpc_xof',
}

const PRICE_ENV = {
  STRIPE_PRICE_SOLO_USD: 'price_usd_solo', STRIPE_PRICE_GROWTH_USD: 'price_usd_growth', STRIPE_PRICE_AGENCY_USD: 'price_usd_agency',
  STRIPE_PRICE_SOLO_GMD: 'price_gmd_solo', STRIPE_PRICE_GROWTH_GMD: 'price_gmd_growth', STRIPE_PRICE_AGENCY_GMD: 'price_gmd_agency',
  STRIPE_PRICE_SOLO_XOF: 'price_xof_solo', STRIPE_PRICE_GROWTH_XOF: 'price_xof_growth', STRIPE_PRICE_AGENCY_XOF: 'price_xof_agency',
}

function without(env: Record<string, string>, key: string) {
  const copy = { ...env }
  delete copy[key]
  return copy
}

describe('portalConfigurationForCurrency', () => {
  it.each([
    ['USD', 'bpc_usd'],
    ['GMD', 'bpc_gmd'],
    ['XOF', 'bpc_xof'],
  ] as const)('%s → its own configuration', (currency, expected) => {
    expect(portalConfigurationForCurrency(currency, PORTAL_ENV)).toBe(expected)
  })

  it('env key naming', () => {
    expect(portalConfigEnvKey('GMD')).toBe('STRIPE_PORTAL_CONFIG_GMD')
  })

  it('whitespace around the configured ID is trimmed', () => {
    expect(portalConfigurationForCurrency('USD', { ...PORTAL_ENV, STRIPE_PORTAL_CONFIG_USD: '  bpc_usd  ' })).toBe('bpc_usd')
  })

  it.each(['USD', 'GMD', 'XOF'] as const)('%s missing → fails closed', currency => {
    expect(() => portalConfigurationForCurrency(currency, without(PORTAL_ENV, portalConfigEnvKey(currency))))
      .toThrow(PortalConfigError)
  })

  it.each(['GMD', 'XOF'] as const)('%s missing never falls back to the USD configuration', currency => {
    const env = { STRIPE_PORTAL_CONFIG_USD: 'bpc_usd' }
    expect(() => portalConfigurationForCurrency(currency, env)).toThrow(`${portalConfigEnvKey(currency)} is not configured`)
  })

  it('blank value counts as missing', () => {
    expect(() => portalConfigurationForCurrency('GMD', { ...PORTAL_ENV, STRIPE_PORTAL_CONFIG_GMD: '   ' })).toThrow(PortalConfigError)
  })

  it('a value that is not a bpc_ ID fails closed', () => {
    expect(() => portalConfigurationForCurrency('USD', { ...PORTAL_ENV, STRIPE_PORTAL_CONFIG_USD: 'price_usd_solo' }))
      .toThrow('not a Billing Portal configuration ID')
  })

  it.each(['GMD', 'XOF'] as const)('%s sharing the USD configuration ID fails closed for both', currency => {
    const env = { ...PORTAL_ENV, [portalConfigEnvKey(currency)]: 'bpc_usd' }
    expect(() => portalConfigurationForCurrency(currency, env)).toThrow(PortalConfigError)
    expect(() => portalConfigurationForCurrency('USD', env)).toThrow(PortalConfigError)
  })

  it('unsupported currency fails closed', () => {
    expect(() => portalConfigurationForCurrency('EUR' as any, { ...PORTAL_ENV, STRIPE_PORTAL_CONFIG_EUR: 'bpc_eur' }))
      .toThrow(PortalConfigError)
  })

  it('error messages never contain the configured ID', () => {
    const env = { ...PORTAL_ENV, STRIPE_PORTAL_CONFIG_GMD: 'bpc_usd' }
    expect(() => portalConfigurationForCurrency('GMD', env)).toThrow(/^(?!.*bpc_)/)
    expect(() => portalConfigurationForCurrency('USD', { STRIPE_PORTAL_CONFIG_USD: 'bad_value' })).toThrow(/^(?!.*bad_value)/)
  })
})

describe('currencyForStripePrice', () => {
  it.each([
    ['price_usd_growth', 'USD'],
    ['price_gmd_agency', 'GMD'],
    ['price_xof_solo',   'XOF'],
  ])('%s → %s', (priceId, currency) => {
    expect(currencyForStripePrice(priceId, PRICE_ENV)).toBe(currency)
  })

  it('legacy STRIPE_PRICE_{PLAN} USD names resolve to USD', () => {
    expect(currencyForStripePrice('price_legacy_solo', { STRIPE_PRICE_SOLO: 'price_legacy_solo' })).toBe('USD')
  })

  it('recognized but checkout-disabled regional prices still resolve (grandfathered subscriptions)', () => {
    expect(getRegionalPrice('GROWTH', 'GM', PRICE_ENV).checkoutEnabled).toBe(false)
    expect(getRegionalPrice('GROWTH', 'XOF_ZONE', PRICE_ENV).checkoutEnabled).toBe(false)
    expect(currencyForStripePrice('price_gmd_growth', PRICE_ENV)).toBe('GMD')
    expect(currencyForStripePrice('price_xof_growth', PRICE_ENV)).toBe('XOF')
  })

  it('unknown Price ID fails closed', () => {
    expect(() => currencyForStripePrice('price_unknown', PRICE_ENV)).toThrow(UnknownStripePriceError)
  })

  it.each([null, undefined, ''])('missing Price ID (%s) fails closed', priceId => {
    expect(() => currencyForStripePrice(priceId, PRICE_ENV)).toThrow(MissingStripePriceError)
  })

  it('an unconfigured currency cell does not match anything', () => {
    expect(() => currencyForStripePrice('price_gmd_solo', without(PRICE_ENV, 'STRIPE_PRICE_SOLO_GMD'))).toThrow(UnknownStripePriceError)
  })

  it.each([
    ['Production',              { ...PRICE_ENV, VERCEL_ENV: 'production', BILLING_PREVIEW_REGIONS: 'GM' }],
    ['Preview without flag',    { ...PRICE_ENV, VERCEL_ENV: 'preview' }],
    ['Preview with GM flag',    { ...PRICE_ENV, VERCEL_ENV: 'preview', BILLING_PREVIEW_REGIONS: 'GM' }],
  ])('S/T. %s: GMD price → STRIPE_PORTAL_CONFIG_GMD, USD price → STRIPE_PORTAL_CONFIG_USD, never crossed', (_label, env) => {
    const both = { ...env, ...PORTAL_ENV }
    for (const p of ['price_gmd_solo', 'price_gmd_growth', 'price_gmd_agency']) {
      expect(portalConfigurationForCurrency(currencyForStripePrice(p, both), both)).toBe('bpc_gmd')
    }
    for (const p of ['price_usd_solo', 'price_usd_growth', 'price_usd_agency']) {
      expect(portalConfigurationForCurrency(currencyForStripePrice(p, both), both)).toBe('bpc_usd')
    }
    // GMD configuration missing → error, never the USD configuration.
    const noGmd = without(both as Record<string, string>, 'STRIPE_PORTAL_CONFIG_GMD')
    expect(() => portalConfigurationForCurrency(currencyForStripePrice('price_gmd_growth', noGmd), noGmd)).toThrow(PortalConfigError)
  })

  it('invalid price table (same ID in two cells) fails closed', () => {
    expect(() => currencyForStripePrice('price_usd_solo', { ...PRICE_ENV, STRIPE_PRICE_SOLO_GMD: 'price_usd_solo' }))
      .toThrow(BillingConfigError)
  })
})

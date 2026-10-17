// lib/billing/regions.ts
// ─────────────────────────────────────────────────────────────────────────────
// Billing regions. Each region has exactly one billing currency.
//
// Country lists are data, not conditionals. suggestRegionForCountry is
// ADVISORY ONLY — it may preselect a dropdown, but checkout authorization
// never depends on country, IP, or geolocation. The customer's explicit
// region selection is what the server validates.
// ─────────────────────────────────────────────────────────────────────────────

import type { BillingCurrency } from './currencies'

export type BillingRegion = 'GLOBAL' | 'GM' | 'XOF_ZONE'

export interface RegionDefinition {
  code:      BillingRegion
  currency:  BillingCurrency
  label:     string
  countries: readonly string[]  // ISO 3166-1 alpha-2; empty for GLOBAL (the default)
}

export const REGIONS: Record<BillingRegion, RegionDefinition> = {
  GLOBAL: {
    code:      'GLOBAL',
    currency:  'USD',
    label:     'United States / International',
    countries: [],
  },
  GM: {
    code:      'GM',
    currency:  'GMD',
    label:     'The Gambia',
    countries: ['GM'],
  },
  XOF_ZONE: {
    code:      'XOF_ZONE',
    currency:  'XOF',
    label:     'West Africa CFA Zone',
    // Senegal, Côte d'Ivoire, Mali, Burkina Faso, Benin, Togo, Niger, Guinea-Bissau
    countries: ['SN', 'CI', 'ML', 'BF', 'BJ', 'TG', 'NE', 'GW'],
  },
}

export const DEFAULT_REGION: BillingRegion = 'GLOBAL'

export function isBillingRegion(value: unknown): value is BillingRegion {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(REGIONS, value)
}

export function currencyForRegion(region: BillingRegion): BillingCurrency {
  return REGIONS[region].currency
}

// Advisory only — never use the result to authorize a checkout.
export function suggestRegionForCountry(country?: string | null): BillingRegion {
  const code = country?.trim().toUpperCase()
  if (!code) return DEFAULT_REGION
  for (const region of Object.values(REGIONS)) {
    if (region.countries.includes(code)) return region.code
  }
  return DEFAULT_REGION
}

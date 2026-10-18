// lib/billing/currencies.ts
// ─────────────────────────────────────────────────────────────────────────────
// Currency metadata for regional pricing. Pure — no env, no Stripe, no DB.
//
// RULES:
//   - Amounts are always integers in the currency's minor unit, the same
//     convention Stripe uses for unit_amount (USD 4900 = $49, XOF 15000 =
//     15,000 XOF because XOF has no minor unit).
//   - Never assume two decimal places — read minorUnitDigits.
//   - Currency is pricing metadata only. It never determines plan entitlement.
// ─────────────────────────────────────────────────────────────────────────────

export type BillingCurrency = 'USD' | 'GMD' | 'XOF'

export interface CurrencyDefinition {
  code:            BillingCurrency
  minorUnitDigits: number  // ISO 4217 / Stripe minor units (XOF is zero-decimal)
  locale:          string  // BCP 47 locale used by Intl.NumberFormat
  label:           string  // human-readable name for selectors
}

export const CURRENCIES: Record<BillingCurrency, CurrencyDefinition> = {
  USD: { code: 'USD', minorUnitDigits: 2, locale: 'en-US', label: 'US Dollar' },
  GMD: { code: 'GMD', minorUnitDigits: 2, locale: 'en-GM', label: 'Gambian Dalasi' },
  XOF: { code: 'XOF', minorUnitDigits: 0, locale: 'fr-SN', label: 'West African CFA Franc' },
}

export function isBillingCurrency(value: unknown): value is BillingCurrency {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CURRENCIES, value)
}

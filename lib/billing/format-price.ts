// lib/billing/format-price.ts
// ─────────────────────────────────────────────────────────────────────────────
// Currency-aware price formatting. Always Intl.NumberFormat — never a
// hand-concatenated symbol.
//
// Whole amounts render without fractional digits so existing USD copy stays
// exactly "$49" / "$99" / "$199" (no ".00"). A non-whole amount renders with
// the currency's full minor-unit precision.
// ─────────────────────────────────────────────────────────────────────────────

import { CURRENCIES, type BillingCurrency } from './currencies'

export function formatPrice(amountMinor: number, currency: BillingCurrency): string {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Error(`formatPrice: amount must be a non-negative integer in minor units, got ${amountMinor}`)
  }

  const def     = CURRENCIES[currency]
  const divisor = 10 ** def.minorUnitDigits
  const digits  = amountMinor % divisor === 0 ? 0 : def.minorUnitDigits

  return new Intl.NumberFormat(def.locale, {
    style:                 'currency',
    currency:              def.code,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountMinor / divisor)
}

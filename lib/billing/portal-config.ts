// lib/billing/portal-config.ts
// ─────────────────────────────────────────────────────────────────────────────
// Stripe Billing Portal configuration per billing currency.
//
// RULES:
//   - Each currency has its own portal configuration. There is NO fallback:
//     GMD and XOF never use the USD configuration, and a missing configuration
//     fails closed instead of using Stripe's default portal.
//   - The currency comes from the workspace's stored Stripe Price via the
//     regional price table — never from the request, country or UI selection.
//   - `recognized` prices resolve even when checkout is disabled, so an
//     existing/grandfathered subscription can still manage billing.
//   - Proration and other portal behaviour live in the Stripe configuration
//     itself; this module only selects its ID.
//
// Env naming:
//   STRIPE_PORTAL_CONFIG_{CURRENCY}   e.g. STRIPE_PORTAL_CONFIG_USD
// ─────────────────────────────────────────────────────────────────────────────

import { CURRENCIES, isBillingCurrency, type BillingCurrency } from './currencies'
import {
  getRegionalPriceTable,
  MissingStripePriceError,
  UnknownStripePriceError,
} from './regional-prices'

type PortalEnv = Record<string, string | undefined>

export class PortalConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PortalConfigError'
  }
}

export function portalConfigEnvKey(currency: BillingCurrency): string {
  return `STRIPE_PORTAL_CONFIG_${currency}`
}

function readEnv(env: PortalEnv, key: string): string | undefined {
  const value = env[key]?.trim()
  return value ? value : undefined
}

// Errors name the env key only, never the configured value.
export function portalConfigurationForCurrency(currency: BillingCurrency, env: PortalEnv = process.env): string {
  if (!isBillingCurrency(currency)) throw new PortalConfigError('Unsupported billing currency for the Customer Portal')

  const key   = portalConfigEnvKey(currency)
  const value = readEnv(env, key)
  if (!value) throw new PortalConfigError(`${key} is not configured`)
  if (!value.startsWith('bpc_')) throw new PortalConfigError(`${key} is not a Billing Portal configuration ID`)

  // The same ID under two currencies would route one currency's customers
  // through the other's portal — refuse rather than guess which is right.
  for (const other of Object.keys(CURRENCIES) as BillingCurrency[]) {
    if (other !== currency && readEnv(env, portalConfigEnvKey(other)) === value)
      throw new PortalConfigError(`${key} and ${portalConfigEnvKey(other)} are set to the same configuration`)
  }

  return value
}

// Currency of a stored subscription Price. Unknown or missing Price IDs fail
// closed, matching resolvePlanFromStripePrice.
export function currencyForStripePrice(priceId: string | null | undefined, env: PortalEnv = process.env): BillingCurrency {
  if (!priceId) throw new MissingStripePriceError()
  const match = getRegionalPriceTable(env).find(p => p.recognized && p.stripePriceId === priceId)
  if (!match) throw new UnknownStripePriceError(priceId)
  return match.currency
}

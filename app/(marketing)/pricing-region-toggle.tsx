'use client'

// Public pricing cards with an optional billing-region toggle. DISPLAY ONLY.
//
// - `regions` comes from the server (getAvailableRegions(process.env, null) in
//   app/(marketing)/page.tsx). This component never reads env, never sees a
//   Stripe Price ID and never receives an amount: every price is rendered by
//   the canonical formatRegionalPrice helper from the selected region code.
// - With one (or no) available region there is no selector, and the cards are
//   the GLOBAL/USD cards exactly as before.
// - Every CTA is a plain /sign-up link. Nothing here starts a Stripe Checkout;
//   the authenticated Billing page and /api/billing/checkout re-validate the
//   region on their own.

import { useState } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { formatRegionalPrice, type PaidPlan } from '@/lib/billing/regional-prices'
import { DEFAULT_REGION, isBillingRegion, type BillingRegion } from '@/lib/billing/regions'

export interface MarketingPlan {
  key:      PaidPlan
  name:     string
  desc:     string
  features: string[]
  cta:      string
  popular:  boolean
}

export const REGION_TOGGLE_LABELS: Record<BillingRegion, string> = {
  GLOBAL:   'Global',
  GM:       'The Gambia',
  XOF_ZONE: 'XOF Zone',
}

// Known region codes only, de-duplicated, in the order given.
export function regionToggleOptions(regions: readonly unknown[]): BillingRegion[] {
  const out: BillingRegion[] = []
  for (const r of regions) if (isBillingRegion(r) && !out.includes(r)) out.push(r)
  return out
}

export function PricingRegionToggle({
  plans,
  regions,
}: {
  plans:   readonly MarketingPlan[]
  regions: readonly BillingRegion[]
}) {
  const options = regionToggleOptions(regions)
  const [region, setRegion] = useState<BillingRegion>(DEFAULT_REGION)
  const shown = options.includes(region) ? region : DEFAULT_REGION

  return (
    <>
      {options.length > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-2 mb-10 text-sm" role="group" aria-label="Billing region">
          <span className="text-gray-500">Pricing for:</span>
          {options.map(code => (
            <button
              key={code}
              type="button"
              onClick={() => setRegion(code)}
              aria-pressed={code === shown}
              className={code === shown ? 'btn-primary text-xs py-1 px-3' : 'btn-secondary text-xs py-1 px-3'}
            >
              {REGION_TOGGLE_LABELS[code]}
            </button>
          ))}
        </div>
      )}
      <div className="grid md:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <div key={plan.name} className={`card p-7 flex flex-col ${plan.popular ? 'ring-2 ring-navy-800 relative' : ''}`}>
            {plan.popular && (
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                <span className="bg-navy-800 text-gold-300 text-xs font-medium px-3 py-1 rounded-full">Most popular</span>
              </div>
            )}
            <div className="mb-5">
              <h3 className="font-bold text-navy-800 text-lg">{plan.name}</h3>
              <p className="text-gray-500 text-xs mt-1">{plan.desc}</p>
            </div>
            <div className="mb-6">
              <span className="text-4xl font-bold text-navy-800">{formatRegionalPrice(plan.key, shown)}</span>
              <span className="text-gray-400 text-sm">/month</span>
            </div>
            <ul className="space-y-2.5 mb-8 flex-1">
              {plan.features.map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-sm text-gray-600">
                  <Check size={15} className="text-green-500 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <Link href="/sign-up" className={plan.popular ? 'btn-primary w-full justify-center' : 'btn-secondary w-full justify-center'}>
              {plan.cta}
            </Link>
          </div>
        ))}
      </div>
    </>
  )
}

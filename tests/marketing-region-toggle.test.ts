import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getAvailableRegions, formatRegionalPrice, PAID_PLANS } from '@/lib/billing/regional-prices'

// Public marketing pricing region toggle.
//  - EXECUTABLE: the server-side region list the page passes in
//    (getAvailableRegions with an explicit env, never process.env) and the
//    canonical price strings the toggle renders for each region.
//  - SOURCE-CONTRACT: the component and page, read as text. This repo has no
//    component rendering harness (tsconfig "jsx": "preserve" means vitest
//    cannot transform .tsx; no jsdom/@testing-library), so neither the render
//    nor the click → re-render path is executed here.

const USD_ENV = { STRIPE_PRICE_SOLO_USD: 'price_usd_solo', STRIPE_PRICE_GROWTH_USD: 'price_usd_growth', STRIPE_PRICE_AGENCY_USD: 'price_usd_agency' }
const GMD_ENV = { STRIPE_PRICE_SOLO_GMD: 'price_gmd_solo', STRIPE_PRICE_GROWTH_GMD: 'price_gmd_growth', STRIPE_PRICE_AGENCY_GMD: 'price_gmd_agency' }
const XOF_ENV = { STRIPE_PRICE_SOLO_XOF: 'price_xof_solo', STRIPE_PRICE_GROWTH_XOF: 'price_xof_growth', STRIPE_PRICE_AGENCY_XOF: 'price_xof_agency' }
const ALL_PRICES = { ...USD_ENV, ...GMD_ENV, ...XOF_ENV }

const PRODUCTION         = { ...ALL_PRICES, VERCEL_ENV: 'production' }
const PRODUCTION_ROLLOUT = { ...PRODUCTION, BILLING_PRODUCTION_REGIONS: 'GM,XOF_ZONE' }
const PRODUCTION_CERT    = { ...PRODUCTION_ROLLOUT, BILLING_PRODUCTION_TEST_WORKSPACES: 'ws_test_1' }

const compact = (s: string) => s.replace(/\s/g, '')

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

// Code with comments removed, so prose in comments cannot satisfy or trip a check.
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const toggle = readSourceLF('app/(marketing)/pricing-region-toggle.tsx')
const page   = readSourceLF('app/(marketing)/page.tsx')

describe('regions offered on the public page (EXECUTABLE)', () => {
  it('Production with no regional flag → GLOBAL only (so no selector)', () => {
    expect(getAvailableRegions(PRODUCTION, null)).toEqual(['GLOBAL'])
  })

  it('Production certification (allow-list set) → GLOBAL only: no workspace context never opens a region', () => {
    expect(getAvailableRegions(PRODUCTION_CERT, null)).toEqual(['GLOBAL'])
  })

  it('Production public rollout of GM,XOF_ZONE → all three regions (selector)', () => {
    expect(getAvailableRegions(PRODUCTION_ROLLOUT, null)).toEqual(['GLOBAL', 'GM', 'XOF_ZONE'])
  })

  it('USD unconfigured → no regions (the toggle then shows the USD cards, no selector)', () => {
    expect(getAvailableRegions({ VERCEL_ENV: 'production' }, null)).toEqual([])
  })
})

describe('prices the toggle renders per region (EXECUTABLE, canonical helper)', () => {
  it('GLOBAL → $49 / $99 / $199', () => {
    expect(PAID_PLANS.map(p => compact(formatRegionalPrice(p, 'GLOBAL')))).toEqual(['$49', '$99', '$199'])
  })

  it('GM → D2,000 / D4,000 / D7,500', () => {
    expect(PAID_PLANS.map(p => compact(formatRegionalPrice(p, 'GM')))).toEqual(['D2,000', 'D4,000', 'D7,500'])
  })

  it('XOF_ZONE → 15 000 / 30 000 / 55 000 in the existing canonical fr-SN "F CFA" format', () => {
    expect(PAID_PLANS.map(p => compact(formatRegionalPrice(p, 'XOF_ZONE')))).toEqual(['15000FCFA', '30000FCFA', '55000FCFA'])
  })
})

describe('PricingRegionToggle (SOURCE-CONTRACT)', () => {
  const code = codeOnly(toggle)

  it('is a client component', () => {
    expect(toggle).toMatch(/^'use client'/)
  })

  it('renders no selector unless more than one region is offered', () => {
    expect(code).toContain('const options = regionToggleOptions(regions)')
    expect(code).toMatch(/\{options\.length > 1 && \(/)
    // The only buttons are inside that guarded selector.
    const selector = code.slice(code.indexOf('{options.length > 1 && ('), code.indexOf('<div className="grid md:grid-cols-3 gap-6">'))
    expect(code.match(/<button\b/g)).toHaveLength(1)
    expect(selector).toContain('<button')
  })

  it('starts on GLOBAL and can only show an offered region', () => {
    expect(code).toContain('useState<BillingRegion>(DEFAULT_REGION)')
    expect(code).toContain('const shown = options.includes(region) ? region : DEFAULT_REGION')
    expect(code).toContain('onClick={() => setRegion(code)}')
  })

  it('keeps only known region codes, de-duplicated', () => {
    expect(code).toMatch(/if \(isBillingRegion\(r\) && !out\.includes\(r\)\) out\.push\(r\)/)
  })

  it('uses the friendly labels', () => {
    expect(code).toMatch(/GLOBAL:\s*'Global',\s*GM:\s*'The Gambia',\s*XOF_ZONE:\s*'XOF Zone',/)
    expect(code).toContain('{REGION_TOGGLE_LABELS[code]}')
  })

  it('every price goes through formatRegionalPrice with the shown region', () => {
    expect(code).toContain('{formatRegionalPrice(plan.key, shown)}')
    expect(code.match(/formatRegionalPrice\(/g)).toHaveLength(1)
  })

  it('accepts no Price ID or amount, reads no env and calls nothing', () => {
    expect(code).not.toMatch(/process\.env|priceId|amount|fetch\(|getAvailableRegions|getRegionalPrice|searchParams|localStorage|document\.cookie/i)
    const iface = code.slice(code.indexOf('export interface MarketingPlan'), code.indexOf('}', code.indexOf('export interface MarketingPlan')))
    expect(iface).not.toMatch(/price|amount/i)
    expect(code).toMatch(/plans:\s*readonly MarketingPlan\[\]\s*\n\s*regions: readonly BillingRegion\[\]/)
  })

  it('every CTA is a static /sign-up link; no checkout', () => {
    expect(code.match(/<Link href="\/sign-up"/g)).toHaveLength(1)
    expect(code.match(/href=/g)).toHaveLength(1)
    expect(code).not.toMatch(/api\/billing|checkout/i)
  })
})

describe('marketing page wiring (SOURCE-CONTRACT)', () => {
  it('stays a server component and computes regions with no workspace context', () => {
    expect(page).not.toMatch(/^'use client'/)
    expect(page).toContain('<PricingRegionToggle plans={PLANS} regions={getAvailableRegions(process.env, null)} />')
  })

  it('passes copy-only plans and never starts checkout', () => {
    expect(page).toContain('const PLANS: MarketingPlan[] = [')
    expect(page).not.toMatch(/api\/billing\/checkout|stripePriceId|STRIPE_PRICE_/)
  })
})

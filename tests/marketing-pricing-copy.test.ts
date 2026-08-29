import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: they read the marketing page and the in-app
// billing page as plain text and regex-match against them. They do NOT
// render the pages, do NOT connect to a database, and do NOT exercise
// Stripe checkout — this repo has no DB/route-execution test framework
// (see tests/generate-qbr-route.test.ts and tests/saved-qbr-route.test.ts
// for the same precedent). These tests guard the v1.0 launch-blocking
// commercial-copy corrections: no paid-plan free-trial promise, Solo's
// real 20-QBR/month limit, no advertised-but-unimplemented Agency
// "Custom AI tone" feature, and paid-plan CTAs that read "Get started"
// without implying a free/trial paid plan.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const marketingSource = readSourceLF('app/(marketing)/page.tsx')
const billingSource   = readSourceLF('app/(app)/dashboard/billing/page.tsx')

describe('marketing page — no paid-plan free-trial promise', () => {
  it('does not claim a 14-day free trial', () => {
    expect(marketingSource).not.toMatch(/14-day free trial/i)
  })

  it('does not offer a "Start free trial" CTA on any paid plan card', () => {
    expect(marketingSource).not.toMatch(/Start free trial/i)
  })
})

describe('marketing page — Solo QBR limit is truthfully advertised', () => {
  it('does not claim Unlimited QBRs for Solo', () => {
    const soloBlock = marketingSource.match(/name: 'Solo'[\s\S]*?\},/)?.[0] ?? ''
    expect(soloBlock).not.toMatch(/Unlimited QBRs/)
  })

  it('states the real 20 QBRs per month limit for Solo', () => {
    const soloBlock = marketingSource.match(/name: 'Solo'[\s\S]*?\},/)?.[0] ?? ''
    expect(soloBlock).toMatch(/20 QBRs per month/)
  })
})

describe('marketing page — no Custom AI tone promise', () => {
  it('does not advertise Custom AI tone anywhere', () => {
    expect(marketingSource).not.toMatch(/Custom AI tone/i)
  })
})

describe('marketing page — Growth branding wording matches implemented terminology', () => {
  it('uses White-label branding, not Custom branding, for Growth', () => {
    const growthBlock = marketingSource.match(/name: 'Growth'[\s\S]*?\},/)?.[0] ?? ''
    expect(growthBlock).toMatch(/White-label branding/)
    expect(growthBlock).not.toMatch(/Custom branding/)
  })
})

describe('marketing page — paid-plan CTAs read "Get started" with no free/trial implication', () => {
  const soloBlock   = marketingSource.match(/name: 'Solo'[\s\S]*?\},/)?.[0] ?? ''
  const growthBlock = marketingSource.match(/name: 'Growth'[\s\S]*?\},/)?.[0] ?? ''
  const agencyBlock = marketingSource.match(/name: 'Agency'[\s\S]*?\},/)?.[0] ?? ''

  it('Solo CTA is not "Start free trial"', () => {
    expect(soloBlock).not.toMatch(/Start free trial/i)
  })

  it('Growth CTA is not "Start free trial"', () => {
    expect(growthBlock).not.toMatch(/Start free trial/i)
  })

  it('Agency CTA is not "Contact us"', () => {
    expect(agencyBlock).not.toMatch(/Contact us/)
  })

  it('no paid-plan CTA uses "Get started free"', () => {
    expect(soloBlock).not.toMatch(/Get started free/i)
    expect(growthBlock).not.toMatch(/Get started free/i)
    expect(agencyBlock).not.toMatch(/Get started free/i)
  })

  it('every paid-plan CTA is exactly "Get started"', () => {
    expect(soloBlock).toMatch(/cta: 'Get started',/)
    expect(growthBlock).toMatch(/cta: 'Get started',/)
    expect(agencyBlock).toMatch(/cta: 'Get started',/)
  })
})

describe('billing page — no Custom AI tone promise', () => {
  it('does not push a Custom AI tone feature for any plan', () => {
    expect(billingSource).not.toMatch(/Custom AI tone/i)
  })
})

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests for the v1.0 launch legal/commercial readiness gate.
// Same approach as tests/marketing-pricing-copy.test.ts: read the page source
// as plain text and regex-match, without rendering or hitting a database.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const PRIVACY_PATH = 'app/(marketing)/privacy/page.tsx'
const TERMS_PATH   = 'app/(marketing)/terms/page.tsx'

const marketingSource = readSourceLF('app/(marketing)/page.tsx')
const billingSource   = readSourceLF('app/(app)/dashboard/billing/page.tsx')
const middlewareSource = readSourceLF('middleware.ts')
const privacySource = readSourceLF(PRIVACY_PATH)
const termsSource   = readSourceLF(TERMS_PATH)

const FORBIDDEN_CERTIFICATION_CLAIMS = [
  /HIPAA[- ]compliant/i,
  /SOC ?2 certified/i,
  /GDPR certified/i,
  /PCI certified/i,
  /PCI[- ]DSS certified/i,
  /ISO ?27001 certified/i,
  /CCPA certified/i,
  /100% secure/i,
  /bank-level/i,
  /military-grade/i,
]

describe('legal pages exist and are public', () => {
  it('privacy policy page file exists', () => {
    expect(existsSync(join(process.cwd(), PRIVACY_PATH))).toBe(true)
  })

  it('terms of service page file exists', () => {
    expect(existsSync(join(process.cwd(), TERMS_PATH))).toBe(true)
  })

  it('privacy and terms routes are not gated behind /dashboard or /api in middleware', () => {
    // middleware only protects /dashboard pages and non-webhook /api routes —
    // /privacy and /terms fall outside both matchers and remain public.
    expect(middlewareSource).toMatch(/isProtectedPage = createRouteMatcher\(\['\/dashboard\(\.\*\)'\]\)/)
    expect(middlewareSource).toMatch(/isProtectedApi = createRouteMatcher\(\['\/api\/\(\(\?!webhooks\)\.\*\)'\]\)/)
  })
})

describe('marketing footer links to legal pages', () => {
  it('links to /privacy', () => {
    expect(marketingSource).toMatch(/href="\/privacy"/)
  })

  it('links to /terms', () => {
    expect(marketingSource).toMatch(/href="\/terms"/)
  })

  it('no longer uses a dead "#" placeholder for Privacy/Terms', () => {
    expect(marketingSource).not.toMatch(/<Link href="#" className="hover:text-gray-700">Privacy<\/Link>/)
    expect(marketingSource).not.toMatch(/<Link href="#" className="hover:text-gray-700">Terms<\/Link>/)
  })

  it('keeps a support contact link', () => {
    expect(marketingSource).toMatch(/mailto:support@misecuretechsolutions\.com/)
  })
})

describe('no false free-trial claim on any touched surface', () => {
  const surfaces = { marketingSource, billingSource, privacySource, termsSource }

  for (const [name, source] of Object.entries(surfaces)) {
    it(`${name} does not mention a 14-day trial`, () => {
      expect(source).not.toMatch(/14-day/i)
    })

    it(`${name} does not claim a free trial`, () => {
      expect(source).not.toMatch(/free trial/i)
    })
  }
})

describe('plan facts remain accurate on touched surfaces', () => {
  it('Solo still advertises 20 QBRs per month on the marketing page', () => {
    const soloBlock = marketingSource.match(/name: 'Solo'[\s\S]*?\},/)?.[0] ?? ''
    expect(soloBlock).toMatch(/20 QBRs per month/)
  })

  it('Agency does not advertise "Custom AI tone" on the marketing page', () => {
    expect(marketingSource).not.toMatch(/Custom AI tone/i)
  })

  it('Agency does not advertise "Custom AI tone" on the billing page', () => {
    expect(billingSource).not.toMatch(/Custom AI tone/i)
  })

  it('Terms of Service does not promise "Custom AI tone"', () => {
    expect(termsSource).not.toMatch(/Custom AI tone/i)
  })
})

describe('cancellation and refund wording', () => {
  it('marketing page carries concise cancellation/refund wording near pricing', () => {
    expect(marketingSource).toMatch(/end of your current billing period/i)
    expect(marketingSource).toMatch(/non-refundable/i)
  })

  it('billing page carries concise cancellation/refund wording', () => {
    expect(billingSource).toMatch(/end of your current billing period/i)
    expect(billingSource).toMatch(/non-refundable/i)
  })

  it('Terms of Service states cancellation is effective at end of billing period', () => {
    expect(termsSource).toMatch(/[Cc]ancellation takes effect at the end of your current billing period/)
  })

  it('Terms of Service refund wording matches the approved policy exactly', () => {
    expect(termsSource).toMatch(
      /Payments are generally non-refundable and we do not provide prorated refunds or\s+credits for partially used billing periods, except where required by applicable\s+law\./
    )
  })

  it('Terms of Service does not promise discretionary refunds', () => {
    expect(termsSource).not.toMatch(/refund upon request/i)
    expect(termsSource).not.toMatch(/money-back guarantee/i)
  })
})

describe('legal pages contain no invented certifications or unsupported security claims', () => {
  for (const pattern of FORBIDDEN_CERTIFICATION_CLAIMS) {
    it(`privacy policy does not claim ${pattern}`, () => {
      expect(privacySource).not.toMatch(pattern)
    })

    it(`terms of service does not claim ${pattern}`, () => {
      expect(termsSource).not.toMatch(pattern)
    })
  }

  it('legal pages contain no placeholder text', () => {
    expect(privacySource).not.toMatch(/\bTODO\b|\bTBD\b|\bINSERT\b/)
    expect(termsSource).not.toMatch(/\bTODO\b|\bTBD\b|\bINSERT\b/)
  })

  it('terms of service does not invent a governing-law jurisdiction', () => {
    expect(termsSource).not.toMatch(/governed by the laws of/i)
    expect(termsSource).not.toMatch(/binding arbitration/i)
    expect(termsSource).not.toMatch(/class action waiver/i)
  })
})

describe('support address consistency on touched surfaces', () => {
  it('marketing page no longer references the non-canonical support address', () => {
    expect(marketingSource).not.toMatch(/mcamara@misecuretechsolutions\.com/)
  })

  it('privacy policy uses the canonical support address', () => {
    expect(privacySource).toMatch(/support@misecuretechsolutions\.com/)
  })

  it('terms of service uses the canonical support address', () => {
    expect(termsSource).toMatch(/support@misecuretechsolutions\.com/)
  })
})

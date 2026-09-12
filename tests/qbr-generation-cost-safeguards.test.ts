import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { PLAN_LIMITS, isUnderLimit, type PlanKey } from '@/lib/limits'

// Stage D4B — AI cost safeguards: (A) input-size bounds on the three AI
// prompt free-text fields, and (B) the generate-qbr quota-reservation race
// fix. Source-contract tests read the route files as plain text and
// regex-match against them — this repo has no DB integration-test framework
// (same precedent as tests/api-clients-plan-limit.test.ts and
// tests/generate-qbr-route.test.ts). Where a claim can instead be proven with
// real, executing code (Zod boundary behavior; PLAN_LIMITS/isUnderLimit
// arithmetic), this file does that instead of relying on regex alone — those
// tests are called out explicitly below. No test in this file executes the
// route, opens a real database connection, or calls Anthropic.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const generateQbrSource = readSourceLF('app/api/generate-qbr/route.ts')
const onboardingQbrSource = readSourceLF('app/api/onboarding/qbr/route.ts')
const deleteQbrSource = readSourceLF('app/api/qbrs/[qbrId]/route.ts')

// ─────────────────────────────────────────────────────────────────────────
// A. Input-size bounds — executable proof of the actual boundary behavior
// ─────────────────────────────────────────────────────────────────────────
// Both route schemas independently declare `z.string().max(2000).optional()`
// for ticketCategories/wins/upsellOpportunities (verified by the
// source-contract assertions further below). This section reconstructs that
// exact field shape and runs real Zod validation against it, to prove the
// 2000-character boundary itself behaves as intended — a regex on the source
// text alone cannot prove Zod actually enforces it correctly.

const MIRRORED_MAX = 2000
const freeTextField = z.string().max(MIRRORED_MAX).optional()

describe('AI prompt free-text field bound — executable boundary proof (mirrors both route schemas)', () => {
  it('accepts exactly 2000 characters', () => {
    const result = freeTextField.safeParse('a'.repeat(2000))
    expect(result.success).toBe(true)
  })

  it('rejects 2001 characters', () => {
    const result = freeTextField.safeParse('a'.repeat(2001))
    expect(result.success).toBe(false)
  })

  it('remains optional — undefined is accepted', () => {
    const result = freeTextField.safeParse(undefined)
    expect(result.success).toBe(true)
    expect(result.success && result.data).toBeUndefined()
  })

  it('does not truncate — an accepted value is returned unmodified, at full length', () => {
    const input = 'b'.repeat(1500)
    const result = freeTextField.safeParse(input)
    expect(result.success).toBe(true)
    expect(result.success && result.data).toBe(input)
    expect(result.success && result.data?.length).toBe(1500)
  })

  it('a normal short business value is unaffected', () => {
    const result = freeTextField.safeParse('Network, Email, Endpoint Security')
    expect(result.success).toBe(true)
    expect(result.success && result.data).toBe('Network, Email, Endpoint Security')
  })
})

describe('generate-qbr route — source declares the same 2000-char bound on all three fields (D4B)', () => {
  it('declares MAX_FREE_TEXT_LENGTH = 2000', () => {
    expect(generateQbrSource).toMatch(/const MAX_FREE_TEXT_LENGTH = 2000/)
  })

  it('ticketCategories, wins, and upsellOpportunities all use z.string().max(MAX_FREE_TEXT_LENGTH).optional()', () => {
    for (const field of ['ticketCategories', 'wins', 'upsellOpportunities']) {
      const re = new RegExp(`${field}:\\s*z\\.string\\(\\)\\.max\\(MAX_FREE_TEXT_LENGTH\\)\\.optional\\(\\)`)
      expect(generateQbrSource).toMatch(re)
    }
  })

  it('no other schema field silently gained a length bound (numeric fields are untouched)', () => {
    expect(generateQbrSource).toMatch(/clientId:\s*z\.string\(\),/)
    expect(generateQbrSource).toMatch(/tickets:\s*z\.number\(\)\.optional\(\),/)
  })
})

describe('onboarding qbr route — source declares the same 2000-char bound on all three fields (D4B)', () => {
  it('declares MAX_FREE_TEXT_LENGTH = 2000', () => {
    expect(onboardingQbrSource).toMatch(/const MAX_FREE_TEXT_LENGTH = 2000/)
  })

  it('ticketCategories, wins, and upsellOpportunities all use z.string().max(MAX_FREE_TEXT_LENGTH).optional()', () => {
    for (const field of ['ticketCategories', 'wins', 'upsellOpportunities']) {
      const re = new RegExp(`${field}:\\s*z\\.string\\(\\)\\.max\\(MAX_FREE_TEXT_LENGTH\\)\\.optional\\(\\)`)
      expect(onboardingQbrSource).toMatch(re)
    }
  })

  it('the schema is still .strict() — unknown fields (e.g. clientId) remain rejected', () => {
    const schemaMatch = onboardingQbrSource.match(/const qbrSchema = z\.object\(\{([\s\S]*?)\}\)\.strict\(\)/)
    expect(schemaMatch).not.toBeNull()
    expect(schemaMatch?.[1] ?? '').not.toMatch(/clientId/)
  })

  it('retryKey remains a required uuid — the bound was not applied to the idempotency key', () => {
    expect(onboardingQbrSource).toMatch(/retryKey:\s*z\.string\(\)\.uuid\(\),/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// B. Quota-reservation race fix — additional contract coverage beyond what
// tests/generate-qbr-route.test.ts already asserts directly against the
// route source. Explicit test-scope limitation: these are source-contract
// and pure-logic tests. They do NOT spin up PostgreSQL, do NOT open real
// Prisma transactions, and do NOT dispatch two simultaneous requests against
// a live database. The concurrency-safety claim rests on reusing the
// identical FOR UPDATE-inside-prisma.$transaction pattern already relied on
// by lib/workspace.ts (getWorkspaceContext) and app/api/clients/route.ts —
// not on a fresh empirical proof performed here or against Production.
// ─────────────────────────────────────────────────────────────────────────

describe('generate-qbr route — Growth/Agency unlimited plans are never capped by the reservation (D4B)', () => {
  const cases: Array<{ plan: PlanKey; count: number; expected: boolean }> = [
    { plan: 'FREE',   count: 2,         expected: true },  // under FREE's limit of 3
    { plan: 'FREE',   count: 3,         expected: false }, // at FREE's limit
    { plan: 'SOLO',   count: 19,        expected: true },  // under SOLO's limit of 20
    { plan: 'SOLO',   count: 20,        expected: false }, // at SOLO's limit
    { plan: 'GROWTH', count: 1_000_000, expected: true },  // unlimited
    { plan: 'AGENCY', count: 1_000_000, expected: true },  // unlimited
  ]

  for (const { plan, count, expected } of cases) {
    it(`${plan} at qbrCount=${count} → reservation ${expected ? 'proceeds' : 'is rejected'}`, () => {
      expect(isUnderLimit(count, PLAN_LIMITS[plan].qbrsPerMonth)).toBe(expected)
    })
  }

  it('GROWTH and AGENCY qbrsPerMonth are null (unlimited) in the canonical plan table — the reservation logic imposes no hidden cap on top of this', () => {
    expect(PLAN_LIMITS.GROWTH.qbrsPerMonth).toBeNull()
    expect(PLAN_LIMITS.AGENCY.qbrsPerMonth).toBeNull()
  })

  it('the reservation transaction still executes (lock + read + write) for unlimited plans — it reserves usage for record-keeping but isUnderLimit(x, null) is always true, so it can never reject them', () => {
    // isUnderLimit(used, limit) returns true unconditionally when limit is null.
    expect(isUnderLimit(0, null)).toBe(true)
    expect(isUnderLimit(999_999, null)).toBe(true)
  })
})

describe('generate-qbr route — no process-local/in-memory lock; workspace isolation and deletedAt exclusion unchanged (D4B)', () => {
  it('the only concurrency primitive used is the repository FOR UPDATE row lock (lockWorkspaceRow) — no Map/Set/mutex/semaphore', () => {
    expect(generateQbrSource).not.toMatch(/new Map\(/)
    expect(generateQbrSource).not.toMatch(/new Set\(/)
    expect(generateQbrSource).not.toMatch(/\bmutex\b/i)
    expect(generateQbrSource).not.toMatch(/\bsemaphore\b/i)
    expect(generateQbrSource).toMatch(/lockWorkspaceRow\(tx, membership\.workspaceId\)/)
  })

  it('the target Client lookup is still scoped by workspaceId and excludes soft-deleted rows, unchanged by the reservation fix', () => {
    expect(generateQbrSource).toMatch(/const client = await prisma\.client\.findFirst\(\{\s*where:\s*\{ id: data\.clientId, workspaceId: membership\.workspaceId, deletedAt: null \},/)
  })

  it('the reservation transaction locks and reads the Subscription by the caller\'s own workspaceId only — never a workspaceId derived from the request body', () => {
    const txMatch = generateQbrSource.match(/const reserveResult = await prisma\.\$transaction\(async \(tx\) => \{[\s\S]*?\n {4}\}\)/)
    const txBody = txMatch?.[0] ?? ''
    expect(txBody).toMatch(/lockWorkspaceRow\(tx, membership\.workspaceId\)/)
    expect(txBody).toMatch(/tx\.subscription\.findUnique\(\{\s*where:\s*\{ workspaceId: membership\.workspaceId \},/)
    expect(txBody).not.toMatch(/data\.workspaceId/)
  })
})

describe('Delete QBR — existing accounting policy is unchanged by this gate (qbrCount is never refunded on delete)', () => {
  it('the DELETE handler documents and preserves "without refunding Subscription.qbrCount"', () => {
    expect(deleteQbrSource).toMatch(/without\s*\/\/ refunding Subscription\.qbrCount/)
  })

  it('the DELETE handler contains no Subscription.qbrCount write of any kind', () => {
    const deleteMatch = deleteQbrSource.match(/export async function DELETE\([\s\S]*?\n\}(?:\n|$)/)
    expect(deleteMatch).not.toBeNull()
    const body = deleteMatch?.[0] ?? ''
    expect(body).not.toMatch(/qbrCount/)
    expect(body).not.toMatch(/subscription\.update/)
  })
})

describe('onboarding qbr route — unchanged by this gate except the input-size bound (D4B scope discipline)', () => {
  it('retains its own pre-existing (unlocked) quota pre-check exactly as before — NOT modified by this gate', () => {
    // Explicitly in scope for D4B: input bounds only. The onboarding route's
    // quota pre-check (isUnderLimit(effectiveQbrCount, ...)) is read-then-
    // later-transaction, the same class of gap as generate-qbr's pre-fix
    // pattern — but repairing it was out of the gate's authorized scope
    // (Section 8: "Only authorized onboarding change in this gate is: the
    // same 2000-character API-side bounds"). This test documents that the
    // pre-existing pattern is untouched, not that it is safe.
    expect(onboardingQbrSource).toMatch(/isUnderLimit\(effectiveQbrCount, limits\.qbrsPerMonth\)/)
  })

  it('still uses retryKey idempotency and a transactional final claim — untouched by this gate', () => {
    expect(onboardingQbrSource).toMatch(/const replayResult = await tryReplay\(/)
    expect(onboardingQbrSource).toMatch(/if \(claim\.count !== 1\) throw new ClaimLostError\(\)/)
  })
})

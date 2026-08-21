import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { isSkippableStep, skipTransitionFor } from '@/lib/onboarding'

// Source-contract tests: they read app/api/onboarding/skip/route.ts as plain
// text and regex-match against it. They do NOT execute the route against a
// real database — this repo has no DB integration-test framework.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const routeSource = readSourceLF('app/api/onboarding/skip/route.ts')

describe('skip route — the exact fixed skip table (real import, not a mirror)', () => {
  it('EXPORT_QBR sets exportSkippedAt and advances to SHARE_QBR', () => {
    expect(skipTransitionFor('EXPORT_QBR')).toEqual({ skipField: 'exportSkippedAt', toStep: 'SHARE_QBR' })
  })

  it('SHARE_QBR sets shareSkippedAt and advances to COMPLETE', () => {
    expect(skipTransitionFor('SHARE_QBR')).toEqual({ skipField: 'shareSkippedAt', toStep: 'COMPLETE' })
  })

  it('only EXPORT_QBR and SHARE_QBR are skippable', () => {
    expect(isSkippableStep('EXPORT_QBR')).toBe(true)
    expect(isSkippableStep('SHARE_QBR')).toBe(true)
    expect(isSkippableStep('REVIEW_QBR')).toBe(false)
    expect(isSkippableStep('COMPLETE')).toBe(false)
  })
})

describe('skip route — authentication and membership resolution', () => {
  it('authenticates via Clerk auth() and returns 401 when absent', () => {
    expect(routeSource).toMatch(/const \{ userId: clerkId \} = auth\(\)/)
    expect(routeSource).toMatch(/if \(!clerkId\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/)
  })

  it('never reads membership.role, imports TeamRole, or calls can.* — same as the generic advance route', () => {
    expect(routeSource).not.toMatch(/membership\.role/)
    expect(routeSource).not.toMatch(/import[^\n]*TeamRole/)
    expect(routeSource).not.toMatch(/\bcan\./)
  })
})

describe('skip route — request body identifies only the step being skipped', () => {
  it('the zod schema defines exactly one field: step, restricted to the two skippable steps', () => {
    expect(routeSource).toMatch(/const skipSchema = z\.object\(\{\s*step: z\.enum\(\['EXPORT_QBR', 'SHARE_QBR'\]\),\s*\}\)\.strict\(\)/)
  })

  it('never reads workspaceId, userId, onboardingOwnerUserId, or toStep from the parsed body', () => {
    expect(routeSource).not.toMatch(/parsed\.data\.workspaceId/)
    expect(routeSource).not.toMatch(/parsed\.data\.userId/)
    expect(routeSource).not.toMatch(/parsed\.data\.toStep/)
    expect(routeSource).not.toMatch(/body\.workspaceId/)
  })
})

describe('skip route — atomic conditional updateMany per step, exact fresh-state where clause', () => {
  it('EXPORT_QBR skip requires currentStep EXPORT_QBR and writes exportSkippedAt + currentStep SHARE_QBR together', () => {
    expect(routeSource).toMatch(/currentStep:\s*'EXPORT_QBR',\s*\},\s*data:\s*\{ exportSkippedAt: new Date\(\), currentStep: 'SHARE_QBR' \}/)
  })

  it('SHARE_QBR skip requires currentStep SHARE_QBR and writes shareSkippedAt + currentStep COMPLETE together', () => {
    expect(routeSource).toMatch(/currentStep:\s*'SHARE_QBR',\s*\},\s*data:\s*\{ shareSkippedAt: new Date\(\), currentStep: 'COMPLETE' \}/)
  })

  it('both branches scope the where clause by workspaceId, status IN_PROGRESS, and exact onboardingOwnerUserId', () => {
    const whereClauses = routeSource.match(/where:\s*\{[\s\S]*?currentStep:\s*'(EXPORT_QBR|SHARE_QBR)',\s*\}/g) ?? []
    expect(whereClauses.length).toBe(2)
    for (const clause of whereClauses) {
      expect(clause).toMatch(/workspaceId,/)
      expect(clause).toMatch(/status:\s*'IN_PROGRESS',/)
      expect(clause).toMatch(/onboardingOwnerUserId:\s*userId,/)
    }
  })
})

describe('skip route — idempotent retry classification requires the exact skip marker AND exact target step', () => {
  it('re-reads the onboarding row scoped by workspaceId after a count-0 result', () => {
    expect(routeSource).toMatch(/if \(result\.count === 1\)/)
    expect(routeSource).toMatch(/prisma\.workspaceOnboarding\.findUnique\(\{ where: \{ workspaceId \} \}\)/)
  })

  it('retry success requires currentStep === toStep AND the exact skip field non-null — never toStep alone', () => {
    expect(routeSource).toMatch(/onboarding\.status === 'IN_PROGRESS' &&\s*onboarding\.currentStep === toStep &&\s*\(step === 'EXPORT_QBR' \? onboarding\.exportSkippedAt != null : onboarding\.shareSkippedAt != null\)/)
  })

  it('never contains a further-along/range comparison for step ordering', () => {
    expect(routeSource).not.toMatch(/>=|<=|STEP_ORDER|ALL_STEPS/)
  })

  it('any other post-re-read shape falls through to 409 conflict, never silent success', () => {
    expect(routeSource).toMatch(/return NextResponse\.json\(\{ error: 'Onboarding state conflict' \}, \{ status: 409 \}\)/)
  })

  it('a second skip write is never issued during retry classification (exactly two updateMany calls total, one per branch)', () => {
    const updateCalls = routeSource.match(/prisma\.workspaceOnboarding\.(updateMany|update)\(/g) ?? []
    expect(updateCalls.length).toBe(2)
  })
})

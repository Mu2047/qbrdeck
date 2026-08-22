import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { requiredFromStepFor } from '@/lib/onboarding'

// Source-contract tests: they read app/api/onboarding/advance/route.ts as
// plain text and regex-match against it. They do NOT execute the route
// against a real database — this repo has no DB integration-test framework
// (see tests/onboarding-enrollment-atomicity.test.ts and
// tests/onboarding-selfheal.test.ts for the same precedent).

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const routeSource = readSourceLF('app/api/onboarding/advance/route.ts')

describe('advance route — the exact fixed transition table (real import, not a mirror)', () => {
  it('WORKSPACE_NAME requires persisted currentStep WELCOME', () => {
    expect(requiredFromStepFor('WORKSPACE_NAME')).toBe('WELCOME')
  })

  it('EXPORT_QBR requires persisted currentStep REVIEW_QBR', () => {
    expect(requiredFromStepFor('EXPORT_QBR')).toBe('REVIEW_QBR')
  })

  it('SHARE_QBR requires persisted currentStep EXPORT_QBR', () => {
    expect(requiredFromStepFor('SHARE_QBR')).toBe('EXPORT_QBR')
  })

  it('COMPLETE requires persisted currentStep SHARE_QBR', () => {
    expect(requiredFromStepFor('COMPLETE')).toBe('SHARE_QBR')
  })
})

describe('advance route — authentication and membership resolution', () => {
  it('authenticates via Clerk auth() and returns 401 when absent', () => {
    expect(routeSource).toMatch(/const \{ userId: clerkId \} = auth\(\)/)
    expect(routeSource).toMatch(/if \(!clerkId\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/)
  })

  it('resolves identity via the lighter getWorkspaceMembership resolver, not getWorkspaceContext', () => {
    expect(routeSource).toMatch(/import \{ getWorkspaceMembership \} from '@\/lib\/workspace'/)
    expect(routeSource).not.toMatch(/getWorkspaceContext/)
  })

  it('returns 403 when there is no valid workspace membership', () => {
    expect(routeSource).toMatch(/if \(!membership\) return NextResponse\.json\(\{ error: 'Forbidden' \}, \{ status: 403 \}\)/)
  })
})

describe('advance route — request body accepts only toStep', () => {
  it('the zod schema defines exactly one field: toStep, covering all four remaining UI-only transitions', () => {
    expect(routeSource).toMatch(/const advanceSchema = z\.object\(\{\s*toStep: z\.enum\(\['WORKSPACE_NAME', 'EXPORT_QBR', 'SHARE_QBR', 'COMPLETE'\]\),\s*\}\)\.strict\(\)/)
  })

  // PR 8: WORKSPACE_NAME->FIRST_CLIENT moved to a dedicated, atomic
  // POST /api/onboarding/workspace-name endpoint (workspace rename + claim
  // in one transaction) — see P2 onboarding PR 8 preflight, "Workspace Name
  // — must-fix". Generic advance no longer accepts FIRST_CLIENT as a
  // target at all, closing the old non-atomic split-write path.
  it('FIRST_CLIENT is no longer a valid toStep for generic advance', () => {
    expect(routeSource).not.toMatch(/'FIRST_CLIENT'/)
  })

  it('never reads workspaceId, userId, onboardingOwnerUserId, fromStep, or role from the parsed request body', () => {
    // Everything the route uses for authorization/state comes from
    // `membership` (server-resolved) or the persisted `onboarding` row
    // (re-fetched from the DB) — never from `parsed.data` beyond toStep.
    expect(routeSource).not.toMatch(/parsed\.data\.workspaceId/)
    expect(routeSource).not.toMatch(/parsed\.data\.userId/)
    expect(routeSource).not.toMatch(/parsed\.data\.onboardingOwnerUserId/)
    expect(routeSource).not.toMatch(/parsed\.data\.fromStep/)
    expect(routeSource).not.toMatch(/parsed\.data\.role/)
    expect(routeSource).not.toMatch(/body\.workspaceId/)
    expect(routeSource).not.toMatch(/body\.userId/)
    expect(routeSource).not.toMatch(/body\.fromStep/)
  })

  it('workspaceId and userId used in the write both come from membership, not the request', () => {
    expect(routeSource).toMatch(/const \{ workspaceId, userId \} = membership/)
  })
})

describe('advance route — no TeamRole authorization anywhere', () => {
  it('never reads membership.role, imports TeamRole, or calls the can.* permission helpers (a comment documenting the omission is fine)', () => {
    expect(routeSource).not.toMatch(/membership\.role/)
    expect(routeSource).not.toMatch(/import[^\n]*TeamRole/)
    expect(routeSource).not.toMatch(/\bcan\./)
  })
})

describe('advance route — atomic conditional updateMany is the authorization + concurrency boundary', () => {
  const updateManyMatch = routeSource.match(/prisma\.workspaceOnboarding\.updateMany\(\{[\s\S]*?\n\s{4}\}\)/)
  const updateManyCall = updateManyMatch?.[0] ?? ''

  it('locates the updateMany call', () => {
    expect(updateManyMatch).not.toBeNull()
  })

  it('where clause requires the exact workspaceId', () => {
    expect(updateManyCall).toMatch(/where:\s*\{\s*workspaceId,/)
  })

  it('where clause requires status IN_PROGRESS', () => {
    expect(updateManyCall).toMatch(/status:\s*'IN_PROGRESS',/)
  })

  it('where clause requires exact onboardingOwnerUserId match against the resolved userId', () => {
    expect(updateManyCall).toMatch(/onboardingOwnerUserId:\s*userId,/)
  })

  it('where clause requires the exact persisted currentStep (fromStep), not any currentStep', () => {
    expect(updateManyCall).toMatch(/currentStep:\s*fromStep,/)
  })

  it('data writes only currentStep to toStep', () => {
    expect(updateManyCall).toMatch(/data:\s*\{\s*currentStep:\s*toStep\s*\}/)
  })
})

describe('advance route — count === 0 re-read and idempotency classification', () => {
  it('re-fetches the onboarding row scoped by workspaceId after a count-0 result', () => {
    expect(routeSource).toMatch(/if \(result\.count === 1\)/)
    expect(routeSource).toMatch(/prisma\.workspaceOnboarding\.findUnique\(\{\s*where:\s*\{ workspaceId \},\s*\}\)/)
  })

  it('missing onboarding row after re-read returns 409', () => {
    expect(routeSource).toMatch(/if \(!onboarding\) \{\s*return NextResponse\.json\(\{ error: 'Onboarding not found' \}, \{ status: 409 \}\)/)
  })

  it('owner mismatch after re-read returns 403', () => {
    expect(routeSource).toMatch(/if \(onboarding\.onboardingOwnerUserId !== userId\) \{\s*return NextResponse\.json\(\{ error: 'Forbidden' \}, \{ status: 403 \}\)/)
  })

  it('idempotent retry success requires EXACT currentStep === toStep (and IN_PROGRESS) — not "further along"', () => {
    expect(routeSource).toMatch(/if \(onboarding\.status === 'IN_PROGRESS' && onboarding\.currentStep === toStep\) \{/)
  })

  it('never contains a greater-than-or-equal / sequence-index comparison that would treat a step beyond toStep as success', () => {
    expect(routeSource).not.toMatch(/>=|<=|indexOf|ALL_STEPS|STEP_ORDER/)
    // the only equality check gating success is the exact-match one asserted
    // above (`currentStep === toStep`) — confirm there is exactly one
    // currentStep comparison in the whole file, so no second, looser
    // comparison could also grant success.
    const currentStepComparisons = routeSource.match(/onboarding\.currentStep\s*===\s*\w+/g) ?? []
    expect(currentStepComparisons).toEqual(['onboarding.currentStep === toStep'])
  })

  it('any other post-re-read shape falls through to a 409 conflict, never a silent success', () => {
    expect(routeSource).toMatch(/return NextResponse\.json\(\{ error: 'Onboarding state conflict' \}, \{ status: 409 \}\)/)
  })

  it('a second advance is never issued during retry classification (no second updateMany/update call)', () => {
    const updateCalls = routeSource.match(/prisma\.workspaceOnboarding\.(updateMany|update)\(/g) ?? []
    expect(updateCalls.length).toBe(1)
  })
})

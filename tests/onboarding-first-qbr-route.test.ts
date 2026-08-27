import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: they read app/api/onboarding/qbr/route.ts as plain
// text and regex-match against it. They do NOT execute the route against a
// real database — this repo has no DB integration-test framework (see
// tests/onboarding-advance-route.test.ts and
// tests/onboarding-enrollment-atomicity.test.ts for the same precedent).

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const routeSource = readSourceLF('app/api/onboarding/qbr/route.ts')
const generateQbrSource = readSourceLF('app/api/generate-qbr/route.ts')

describe('onboarding qbr route — authentication and membership resolution', () => {
  it('authenticates via Clerk auth() and returns 401 when absent', () => {
    expect(routeSource).toMatch(/const \{ userId: clerkId \} = auth\(\)/)
    expect(routeSource).toMatch(/if \(!clerkId\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/)
  })

  it('resolves identity via getWorkspaceMembership, not getWorkspaceContext', () => {
    expect(routeSource).toMatch(/import \{ getWorkspaceMembership \} from '@\/lib\/workspace'/)
    expect(routeSource).not.toMatch(/getWorkspaceContext/)
  })
})

describe('onboarding qbr route — never authorizes via TeamRole (P2 preflight Correction 3)', () => {
  it('never reads membership.role, imports TeamRole, or calls the can.* permission helpers', () => {
    expect(routeSource).not.toMatch(/membership\.role/)
    expect(routeSource).not.toMatch(/import[^\n]*TeamRole/)
    expect(routeSource).not.toMatch(/\bcan\./)
  })
})

describe('onboarding qbr route — request carries no clientId; target is server-resolved', () => {
  it('the zod schema has no clientId field', () => {
    const schemaMatch = routeSource.match(/const qbrSchema = z\.object\(\{([\s\S]*?)\}\)\.strict\(\)/)
    expect(schemaMatch).not.toBeNull()
    expect(schemaMatch?.[1] ?? '').not.toMatch(/clientId/)
  })

  it('never reads clientId from the parsed body', () => {
    expect(routeSource).not.toMatch(/data\.clientId/)
    expect(routeSource).not.toMatch(/parsed\.data\.clientId/)
    expect(routeSource).not.toMatch(/body\.clientId/)
  })

  it('the anchored Client is resolved from onboarding.onboardingClientId, verified non-deleted and workspace-scoped', () => {
    expect(routeSource).toMatch(/const anchoredClient = await prisma\.client\.findFirst\(\{\s*where:\s*\{ id: onboarding\.onboardingClientId!, workspaceId, deletedAt: null \},/)
  })
})

describe('onboarding qbr route — replay check happens before quota, health score, or any AI call', () => {
  it('calls tryReplay immediately after the owner-identity check and before the fresh-state guard', () => {
    const ownerCheckIdx = routeSource.indexOf('onboarding.onboardingOwnerUserId !== userId')
    const replayIdx = routeSource.indexOf('const replayResult = await tryReplay(')
    const freshStateIdx = routeSource.indexOf('const isFreshState =')
    expect(ownerCheckIdx).toBeLessThan(replayIdx)
    expect(replayIdx).toBeLessThan(freshStateIdx)
  })

  it('replay check runs before the quota check, health score computation, and AI generation call', () => {
    const replayIdx = routeSource.indexOf('const replayResult = await tryReplay(')
    const quotaIdx = routeSource.indexOf('isUnderLimit(effectiveQbrCount')
    const healthIdx = routeSource.indexOf('computeHealthScore(')
    const aiIdx = routeSource.indexOf('generateQBRSlides(')
    expect(replayIdx).toBeGreaterThan(-1)
    expect(replayIdx).toBeLessThan(quotaIdx)
    expect(replayIdx).toBeLessThan(healthIdx)
    expect(replayIdx).toBeLessThan(aiIdx)
  })

  it('exact replay condition requires IN_PROGRESS, currentStep REVIEW_QBR, a non-null onboardingQbrId, and matching qbrStepIdempotencyKey', () => {
    const isReplayMatch = routeSource.match(/const isReplay =\s*onboarding\.status === 'IN_PROGRESS' &&\s*onboarding\.currentStep === 'REVIEW_QBR' &&\s*onboarding\.onboardingQbrId != null &&\s*onboarding\.qbrStepIdempotencyKey === retryKey/)
    expect(isReplayMatch).not.toBeNull()
  })

  it('a successful replay fetches the QBR workspace-scoped and returns it at 200 with no transaction/AI call in that path', () => {
    const tryReplayMatch = routeSource.match(/async function tryReplay\([\s\S]*?\n\}\n/)
    expect(tryReplayMatch).not.toBeNull()
    const body = tryReplayMatch?.[0] ?? ''
    expect(body).toMatch(/prisma\.qBR\.findFirst\(\{ where: \{ id: onboarding\.onboardingQbrId!, workspaceId \} \}\)/)
    expect(body).toMatch(/return NextResponse\.json\(\{ qbrId: qbr\.id \}, \{ status: 200 \}\)/)
    expect(body).not.toMatch(/generateQBRSlides|computeHealthScore|\$transaction/)
  })
})

describe('onboarding qbr route — fresh-path state guard is exact, never "further along"', () => {
  it('requires IN_PROGRESS, currentStep FIRST_QBR, a non-null onboardingClientId, and onboardingQbrId === null', () => {
    const isFreshStateMatch = routeSource.match(/const isFreshState =\s*onboarding\.status === 'IN_PROGRESS' &&\s*onboarding\.currentStep === 'FIRST_QBR' &&\s*onboarding\.onboardingClientId != null &&\s*onboarding\.onboardingQbrId === null/)
    expect(isFreshStateMatch).not.toBeNull()
  })

  it('anything outside the exact fresh state returns 409', () => {
    expect(routeSource).toMatch(/if \(!isFreshState\) \{\s*return NextResponse\.json\(\{ error: 'Onboarding state conflict' \}, \{ status: 409 \}\)/)
  })
})

describe('onboarding qbr route — effective quota after period reset is never stale', () => {
  it('resets qbrCount/exportCount/periodStart when shouldResetPeriod is true, then sets effectiveQbrCount to 0', () => {
    expect(routeSource).toMatch(/if \(sub && shouldResetPeriod\(new Date\(sub\.periodStart\)\)\) \{/)
    expect(routeSource).toMatch(/data: \{ qbrCount: 0, exportCount: 0, periodStart: new Date\(\) \},/)
    expect(routeSource).toMatch(/effectiveQbrCount = 0/)
  })

  it('the quota check uses effectiveQbrCount, never the raw pre-reset sub.qbrCount', () => {
    expect(routeSource).toMatch(/isUnderLimit\(effectiveQbrCount, limits\.qbrsPerMonth\)/)
    expect(routeSource).not.toMatch(/isUnderLimit\(sub\?\.qbrCount/)
  })

  it('effectiveQbrCount is declared (initialized from sub?.qbrCount) before the reset branch can overwrite it', () => {
    const declIdx = routeSource.indexOf('let effectiveQbrCount = sub?.qbrCount ?? 0')
    const resetIdx = routeSource.indexOf('effectiveQbrCount = 0')
    expect(declIdx).toBeGreaterThan(-1)
    expect(declIdx).toBeLessThan(resetIdx)
  })
})

describe('onboarding qbr route — legitimate QBR quota only, never the suspicious client-count check', () => {
  it('uses PLAN_LIMITS.qbrsPerMonth via getLimits/isUnderLimit from lib/limits.ts', () => {
    expect(routeSource).toMatch(/const \{ getLimits, isUnderLimit, shouldResetPeriod \} = await import\('@\/lib\/limits'\)/)
  })

  it('never reproduces the clientCount - 1 / limits.clients check from generate-qbr', () => {
    expect(routeSource).not.toMatch(/clientCount/)
    expect(routeSource).not.toMatch(/limits\.clients/)
  })

  it('generate-qbr no longer contains the removed Client-capacity check (PR2: Client capacity is enforced only at Client-creation time, never on an already-existing Client)', () => {
    expect(generateQbrSource).not.toMatch(/clientCount - 1, limits\.clients/)
    expect(generateQbrSource).not.toMatch(/limits\.clients/)
    expect(generateQbrSource).not.toMatch(/prisma\.client\.count\(/)
  })
})

describe('onboarding qbr route — health score + AI generation happen outside the transaction', () => {
  it('computeHealthScore and generateQBRSlides calls appear before prisma.$transaction( is opened', () => {
    const healthIdx = routeSource.indexOf('computeHealthScore(')
    const aiIdx = routeSource.indexOf('generateQBRSlides(')
    const txIdx = routeSource.indexOf('prisma.$transaction(async (tx) => {')
    expect(healthIdx).toBeGreaterThan(-1)
    expect(aiIdx).toBeGreaterThan(-1)
    expect(txIdx).toBeGreaterThan(-1)
    expect(healthIdx).toBeLessThan(txIdx)
    expect(aiIdx).toBeLessThan(txIdx)
  })
})

describe('onboarding qbr route — winning transaction contains QBR create, Client metadata write, subscription usage, and the onboarding claim', () => {
  const txMatch = routeSource.match(/prisma\.\$transaction\(async \(tx\) => \{[\s\S]*?\n {6}\}\)\n/)

  it('locates the transaction callback', () => {
    expect(txMatch).not.toBeNull()
  })

  const txBody = txMatch?.[0] ?? ''

  it('creates the QBR with the full normal generated field set (mirrors generate-qbr)', () => {
    expect(txBody).toMatch(/status:\s*'GENERATED',/)
    for (const field of [
      'quarter:', 'year:', 'slides:', 'summary:',
      'rawMetrics,', 'healthScore:', 'healthStatus:', 'healthScoreVersion:', 'scoreBreakdown:',
      'snapshot,', 'generatorVersion:', 'exportTemplateVersion:',
    ]) {
      expect(txBody).toContain(field)
    }
  })

  it('conditionally sets Client.nextQbrDate only when currently null, via a transactional conditional update', () => {
    expect(txBody).toMatch(/tx\.client\.updateMany\(\{\s*where:\s*\{ id: anchoredClient\.id, workspaceId, nextQbrDate: null \},/)
  })

  it('accounts for subscription usage via a single upsert, incrementing qbrCount exactly once', () => {
    expect(txBody).toMatch(/tx\.subscription\.upsert\(\{\s*where:\s*\{ workspaceId \},\s*update:\s*\{ qbrCount: \{ increment: 1 \} \},/)
    expect(txBody).not.toMatch(/exportCount: \{ increment/)
    expect(txBody).not.toMatch(/data:\s*\{\s*plan:/) // never changes plan
  })

  it('the onboarding claim requires the exact FIRST_QBR anchored state and sets anchor + key + REVIEW_QBR atomically', () => {
    expect(txBody).toMatch(/workspaceId,\s*status:\s*'IN_PROGRESS',\s*currentStep:\s*'FIRST_QBR',\s*onboardingOwnerUserId:\s*userId,\s*onboardingClientId:\s*anchoredClient\.id,\s*onboardingQbrId:\s*null,/)
    expect(txBody).toMatch(/onboardingQbrId:\s*created\.id,\s*qbrStepIdempotencyKey:\s*data\.retryKey,\s*currentStep:\s*'REVIEW_QBR',/)
  })

  it('a lost claim throws — never a manual qBR.delete/subscription rollback anywhere in the file', () => {
    expect(txBody).toMatch(/if \(claim\.count !== 1\) throw new ClaimLostError\(\)/)
    expect(routeSource).not.toMatch(/\.qBR\.delete\(/)
  })
})

describe('onboarding qbr route — transaction failure classification is narrow, never swallows unexpected errors', () => {
  it('reclassifies only ClaimLostError or a Prisma P2002 unique-constraint violation as a known race', () => {
    expect(routeSource).toMatch(/const isKnownRace =\s*err instanceof ClaimLostError \|\|\s*\(err instanceof Prisma\.PrismaClientKnownRequestError && err\.code === 'P2002'\)/)
  })

  it('any other error is rethrown, not converted to a 409', () => {
    expect(routeSource).toMatch(/if \(isKnownRace\) \{\s*return await classifyQbrConflict\([\s\S]*?\)\s*\}\s*throw err/)
  })

  it('classifyQbrConflict requires exact retry-key match against the re-read row before returning success', () => {
    const classifyMatch = routeSource.match(/async function classifyQbrConflict\([\s\S]*?\n\}\n/)
    expect(classifyMatch).not.toBeNull()
    const body = classifyMatch?.[0] ?? ''
    expect(body).toMatch(/onboarding\.qbrStepIdempotencyKey === retryKey/)
    expect(body).toMatch(/return NextResponse\.json\(\{ error: 'Onboarding state conflict' \}, \{ status: 409 \}\)/)
  })
})

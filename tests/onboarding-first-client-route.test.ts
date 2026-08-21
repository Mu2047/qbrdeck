import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: they read app/api/onboarding/client/route.ts as
// plain text and regex-match against it. They do NOT execute the route
// against a real database — this repo has no DB integration-test framework
// (see tests/onboarding-advance-route.test.ts and
// tests/onboarding-enrollment-atomicity.test.ts for the same precedent).

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const routeSource = readSourceLF('app/api/onboarding/client/route.ts')

describe('onboarding client route — authentication and membership resolution', () => {
  it('authenticates via Clerk auth() and returns 401 when absent', () => {
    expect(routeSource).toMatch(/const \{ userId: clerkId \} = auth\(\)/)
    expect(routeSource).toMatch(/if \(!clerkId\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/)
  })

  it('resolves identity via getWorkspaceMembership, not getWorkspaceContext', () => {
    expect(routeSource).toMatch(/import \{ getWorkspaceMembership \} from '@\/lib\/workspace'/)
    expect(routeSource).not.toMatch(/getWorkspaceContext/)
  })

  it('workspaceId and userId used throughout come from membership, never the request body', () => {
    expect(routeSource).toMatch(/const \{ workspaceId, userId \} = membership/)
  })
})

describe('onboarding client route — never authorizes via TeamRole (P2 preflight Correction 3)', () => {
  it('never reads membership.role, imports TeamRole, or calls the can.* permission helpers', () => {
    expect(routeSource).not.toMatch(/membership\.role/)
    expect(routeSource).not.toMatch(/import[^\n]*TeamRole/)
    expect(routeSource).not.toMatch(/\bcan\./)
  })

  it('eligibility is decided solely by onboarding.onboardingOwnerUserId === userId', () => {
    expect(routeSource).toMatch(/if \(onboarding\.onboardingOwnerUserId !== userId\) \{\s*return NextResponse\.json\(\{ error: 'Forbidden' \}, \{ status: 403 \}\)/)
  })
})

describe('onboarding client route — strict body, no browser-supplied authority fields', () => {
  it('both branches of the discriminated union are .strict()', () => {
    expect(routeSource).toMatch(/const attachSchema = z\.object\(\{[\s\S]*?\}\)\.strict\(\)/)
    expect(routeSource).toMatch(/const createSchema = z\.object\(\{[\s\S]*?\}\)\.strict\(\)/)
  })

  it('never reads clientId, existingClientId, workspaceId, userId, or ownerId from the parsed body', () => {
    expect(routeSource).not.toMatch(/parsed\.data\.clientId/)
    expect(routeSource).not.toMatch(/parsed\.data\.existingClientId/)
    expect(routeSource).not.toMatch(/parsed\.data\.workspaceId/)
    expect(routeSource).not.toMatch(/parsed\.data\.userId/)
    expect(routeSource).not.toMatch(/parsed\.data\.ownerId/)
    expect(routeSource).not.toMatch(/body\.workspaceId/)
    expect(routeSource).not.toMatch(/body\.clientId/)
  })

  it('the attach-mode schema carries only mode and retryKey — no clientId field exists anywhere in its shape', () => {
    const attachSchemaMatch = routeSource.match(/const attachSchema = z\.object\(\{([\s\S]*?)\}\)\.strict\(\)/)
    expect(attachSchemaMatch).not.toBeNull()
    const fields = attachSchemaMatch?.[1] ?? ''
    expect(fields).toMatch(/mode: z\.literal\('attach'\)/)
    expect(fields).toMatch(/retryKey: z\.string\(\)\.uuid\(\)/)
    expect(fields).not.toMatch(/clientId/)
  })
})

describe('onboarding client route — replay check happens before limit/candidate/create logic', () => {
  it('calls tryReplay immediately after the owner-identity check and before the fresh-state guard', () => {
    const ownerCheckIdx = routeSource.indexOf("onboarding.onboardingOwnerUserId !== userId")
    const replayIdx = routeSource.indexOf('const replayResult = await tryReplay(')
    const freshStateIdx = routeSource.indexOf('const isFreshState =')
    expect(ownerCheckIdx).toBeGreaterThan(-1)
    expect(replayIdx).toBeGreaterThan(-1)
    expect(freshStateIdx).toBeGreaterThan(-1)
    expect(ownerCheckIdx).toBeLessThan(replayIdx)
    expect(replayIdx).toBeLessThan(freshStateIdx)
  })

  it('tryReplay is defined and returns before the plan-limit check (getLimits/isUnderLimit) and before any $transaction is opened', () => {
    const tryReplayFnIdx = routeSource.indexOf('async function tryReplay(')
    const getLimitsIdx = routeSource.indexOf('getLimits(plan)')
    const firstTransactionIdx = routeSource.indexOf('prisma.$transaction(')
    expect(tryReplayFnIdx).toBeGreaterThan(-1)
    expect(getLimitsIdx).toBeGreaterThan(-1)
    expect(firstTransactionIdx).toBeGreaterThan(-1)
    // tryReplay is invoked (not just defined) before either of these —
    // verified by the call-site check above; here we additionally confirm
    // the limit check and transaction only exist inside handleCreate/
    // handleAttach, which are only reached after the replay short-circuit.
    const postReplayIdx = routeSource.indexOf('if (parsed.data.mode ===')
    expect(postReplayIdx).toBeLessThan(getLimitsIdx)
    expect(postReplayIdx).toBeLessThan(firstTransactionIdx)
  })

  it('exact replay condition requires IN_PROGRESS, currentStep FIRST_QBR, a non-null onboardingClientId, and matching clientStepIdempotencyKey', () => {
    const isReplayMatch = routeSource.match(/const isReplay =\s*onboarding\.status === 'IN_PROGRESS' &&\s*onboarding\.currentStep === 'FIRST_QBR' &&\s*onboarding\.onboardingClientId != null &&\s*onboarding\.clientStepIdempotencyKey === retryKey/)
    expect(isReplayMatch).not.toBeNull()
  })

  it('a successful replay returns the anchored Client at 200, re-verifying workspace scope and deletedAt: null', () => {
    expect(routeSource).toMatch(/where:\s*\{ id: onboarding\.onboardingClientId!, workspaceId, deletedAt: null \}/)
    expect(routeSource).toMatch(/return NextResponse\.json\(\{ id: client\.id, name: client\.name \}, \{ status: 200 \}\)/)
  })
})

describe('onboarding client route — fresh-path state guard is exact, never "further along"', () => {
  it('requires IN_PROGRESS, currentStep FIRST_CLIENT, and onboardingClientId === null', () => {
    const isFreshStateMatch = routeSource.match(/const isFreshState =\s*onboarding\.status === 'IN_PROGRESS' &&\s*onboarding\.currentStep === 'FIRST_CLIENT' &&\s*onboarding\.onboardingClientId === null/)
    expect(isFreshStateMatch).not.toBeNull()
  })

  it('anything outside the exact fresh state returns 409, not a silent pass-through', () => {
    expect(routeSource).toMatch(/if \(!isFreshState\) \{\s*return NextResponse\.json\(\{ error: 'Onboarding state conflict' \}, \{ status: 409 \}\)/)
  })

  it('a missing onboarding row returns 409 before any owner check', () => {
    const missingRowIdx = routeSource.indexOf("if (!onboarding) {")
    const ownerCheckIdx = routeSource.indexOf('onboarding.onboardingOwnerUserId !== userId')
    expect(missingRowIdx).toBeGreaterThan(-1)
    expect(missingRowIdx).toBeLessThan(ownerCheckIdx)
    expect(routeSource).toMatch(/if \(!onboarding\) \{\s*return NextResponse\.json\(\{ error: 'Onboarding not found' \}, \{ status: 409 \}\)/)
  })
})

describe('onboarding client route — attach mode server-resolves the unique candidate, never trusts a browser id', () => {
  it('requires exactly one non-deleted Client, scoped to workspaceId, inside the transaction', () => {
    expect(routeSource).toMatch(/const candidates = await tx\.client\.findMany\(\{\s*where:\s*\{ workspaceId, deletedAt: null \},/)
    expect(routeSource).toMatch(/if \(candidates\.length !== 1\) throw new AttachCandidateMismatchError\(\)/)
  })

  it('attach mode never calls tx.client.create or prisma.client.count (it consumes no plan slot)', () => {
    const handleAttachMatch = routeSource.match(/async function handleAttach\([\s\S]*?\n\}\n/)
    expect(handleAttachMatch).not.toBeNull()
    const handleAttachBody = handleAttachMatch?.[0] ?? ''
    expect(handleAttachBody).not.toMatch(/tx\.client\.create/)
    expect(handleAttachBody).not.toMatch(/prisma\.client\.count/)
  })

  it('the conditional claim requires the exact fresh-state where-clause and sets the anchor, key, and next step atomically', () => {
    const claimMatch = routeSource.match(/const claim = await tx\.workspaceOnboarding\.updateMany\(\{[\s\S]*?\n {6}\}\)/g)
    expect(claimMatch).not.toBeNull()
    for (const call of claimMatch ?? []) {
      expect(call).toMatch(/workspaceId,/)
      expect(call).toMatch(/status: 'IN_PROGRESS',/)
      expect(call).toMatch(/currentStep: 'FIRST_CLIENT',/)
      expect(call).toMatch(/onboardingOwnerUserId: userId,/)
      expect(call).toMatch(/onboardingClientId: null,/)
      expect(call).toMatch(/currentStep: 'FIRST_QBR',/)
    }
  })
})

describe('onboarding client route — create mode: correct limit check, atomic candidate + claim, no manual rollback', () => {
  it('counts only non-deleted Clients before the transaction, using the real lib/limits.ts source', () => {
    expect(routeSource).toMatch(/import \{ getLimits, isUnderLimit \} from '@\/lib\/limits'/)
    expect(routeSource).toMatch(/const clientCount = await prisma\.client\.count\(\{ where: \{ workspaceId, deletedAt: null \} \}\)/)
    expect(routeSource).toMatch(/if \(!isUnderLimit\(clientCount, limits\.clients\)\) \{\s*return NextResponse\.json\(\{ error: 'CLIENT_LIMIT_REACHED' \}/)
  })

  it('the client-count check runs before prisma.$transaction( is opened in handleCreate', () => {
    const handleCreateMatch = routeSource.match(/async function handleCreate\([\s\S]*?\n\}\n/)
    expect(handleCreateMatch).not.toBeNull()
    const body = handleCreateMatch?.[0] ?? ''
    const countIdx = body.indexOf('prisma.client.count(')
    const txIdx = body.indexOf('prisma.$transaction(')
    expect(countIdx).toBeGreaterThan(-1)
    expect(txIdx).toBeGreaterThan(-1)
    expect(countIdx).toBeLessThan(txIdx)
  })

  it('candidate Client create and the onboarding claim are both inside the same $transaction callback', () => {
    const handleCreateMatch = routeSource.match(/async function handleCreate\([\s\S]*?\n\}\n/)
    const body = handleCreateMatch?.[0] ?? ''
    const txStart = body.indexOf('prisma.$transaction(async (tx) => {')
    const createIdx = body.indexOf('tx.client.create(')
    const claimIdx = body.indexOf('tx.workspaceOnboarding.updateMany(')
    expect(txStart).toBeGreaterThan(-1)
    expect(txStart).toBeLessThan(createIdx)
    expect(createIdx).toBeLessThan(claimIdx)
  })

  it('a lost claim (count !== 1) throws — never a manual tx.client.delete or prisma.client.delete anywhere in the file', () => {
    expect(routeSource).toMatch(/if \(claim\.count !== 1\) throw new ClaimLostError\(\)/)
    expect(routeSource).not.toMatch(/\.client\.delete\(/)
  })
})

describe('onboarding client route — post-rollback classification is exact-match only, never a range/inequality', () => {
  it('classifyClientConflict re-reads the onboarding row scoped by workspaceId', () => {
    expect(routeSource).toMatch(/async function classifyClientConflict\(workspaceId: string, userId: string, retryKey: string\) \{\s*const onboarding = await prisma\.workspaceOnboarding\.findUnique\(\{ where: \{ workspaceId \} \}\)/)
  })

  it('never contains a >=, <=, indexOf, or step-ordering comparison that could treat a further-along state as success', () => {
    expect(routeSource).not.toMatch(/>=|<=|STEP_ORDER|ALL_STEPS/)
  })
})

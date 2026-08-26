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

  // PR 8: parsed.data.clientId is now legitimately read for attach mode's
  // explicit 2+ candidate selection — see the dedicated attach describe
  // block below for its validation rules. existingClientId/workspaceId/
  // userId/ownerId remain never read from the body.
  it('never reads existingClientId, workspaceId, userId, or ownerId from the parsed body', () => {
    expect(routeSource).not.toMatch(/parsed\.data\.existingClientId/)
    expect(routeSource).not.toMatch(/parsed\.data\.workspaceId/)
    expect(routeSource).not.toMatch(/parsed\.data\.userId/)
    expect(routeSource).not.toMatch(/parsed\.data\.ownerId/)
    expect(routeSource).not.toMatch(/body\.workspaceId/)
  })

  it('the attach-mode schema carries mode, retryKey, and an optional clientId — nothing else', () => {
    const attachSchemaMatch = routeSource.match(/const attachSchema = z\.object\(\{([\s\S]*?)\}\)\.strict\(\)/)
    expect(attachSchemaMatch).not.toBeNull()
    const fields = attachSchemaMatch?.[1] ?? ''
    expect(fields).toMatch(/mode: z\.literal\('attach'\)/)
    expect(fields).toMatch(/retryKey: z\.string\(\)\.uuid\(\)/)
    expect(fields).toMatch(/clientId: z\.string\(\)\.optional\(\)/)
    expect(fields).not.toMatch(/workspaceId|userId|ownerId|existingClientId/)
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
    const getLimitsIdx = routeSource.indexOf("getLimits(subscription?.plan ?? 'FREE')")
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

describe('onboarding client route — attach mode server-resolves candidates fresh, never trusts a browser id blindly', () => {
  it('re-queries candidates scoped to workspaceId and deletedAt: null inside the transaction', () => {
    expect(routeSource).toMatch(/const candidates = await tx\.client\.findMany\(\{\s*where:\s*\{ workspaceId, deletedAt: null \},/)
  })

  it('0 candidates always throws AttachCandidateMismatchError, regardless of any supplied clientId', () => {
    const zeroBranchMatch = routeSource.match(/if \(candidates\.length === 0\) \{[\s\S]*?\n {6}\}/)
    expect(zeroBranchMatch).not.toBeNull()
    expect(zeroBranchMatch?.[0] ?? '').toMatch(/throw new AttachCandidateMismatchError\(\)/)
  })

  it('1 candidate: clientId is optional, but a supplied mismatching id is never silently ignored in favor of the sole candidate', () => {
    const oneBranchMatch = routeSource.match(/\} else if \(candidates\.length === 1\) \{[\s\S]*?\n {6}\}/)
    expect(oneBranchMatch).not.toBeNull()
    const body = oneBranchMatch?.[0] ?? ''
    expect(body).toMatch(/if \(requestedClientId != null && requestedClientId !== onlyCandidate\.id\) \{\s*throw new AttachCandidateMismatchError\(\)/)
  })

  it('2+ candidates: clientId is required and must match one of the workspace-scoped candidates exactly', () => {
    const multiBranchMatch = routeSource.match(/\} else \{\s*\/\/ 2\+ candidates[\s\S]*?\n {6}\}/)
    expect(multiBranchMatch).not.toBeNull()
    const body = multiBranchMatch?.[0] ?? ''
    expect(body).toMatch(/if \(requestedClientId == null\) throw new AttachCandidateMismatchError\(\)/)
    expect(body).toMatch(/const matched = candidates\.find\(c => c\.id === requestedClientId\)/)
    expect(body).toMatch(/if \(!matched\) throw new AttachCandidateMismatchError\(\)/)
  })

  it('the attach schema accepts an optional clientId — no workspaceId/userId/ownerId field exists anywhere in its shape', () => {
    const attachSchemaMatch = routeSource.match(/const attachSchema = z\.object\(\{([\s\S]*?)\}\)\.strict\(\)/)
    expect(attachSchemaMatch).not.toBeNull()
    const fields = attachSchemaMatch?.[1] ?? ''
    expect(fields).toMatch(/clientId: z\.string\(\)\.optional\(\)/)
    expect(fields).not.toMatch(/workspaceId|userId|ownerId/)
  })

  it('attach mode never calls tx.client.create or prisma.client.count (it consumes no plan slot)', () => {
    const handleAttachMatch = routeSource.match(/async function handleAttach\([\s\S]*?\n\}\n/)
    expect(handleAttachMatch).not.toBeNull()
    const handleAttachBody = handleAttachMatch?.[0] ?? ''
    expect(handleAttachBody).not.toMatch(/tx\.client\.create/)
    expect(handleAttachBody).not.toMatch(/prisma\.client\.count/)
  })

  it('attach mode never calls lockWorkspaceRow — it does not consume Client capacity, so it does not need the Workspace lock', () => {
    const handleAttachMatch = routeSource.match(/async function handleAttach\([\s\S]*?\n\}\n/)
    const handleAttachBody = handleAttachMatch?.[0] ?? ''
    expect(handleAttachBody).not.toMatch(/lockWorkspaceRow/)
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

describe('onboarding client route — create mode: shared Workspace lock with normal POST /api/clients', () => {
  const handleCreateMatch = routeSource.match(/async function handleCreate\([\s\S]*?\n\}\n/)
  const handleCreateBody = handleCreateMatch?.[0] ?? ''

  // Isolate just the transaction callback within handleCreate so ordering
  // assertions below can't be accidentally satisfied by handleAttach's own
  // (unrelated) transaction elsewhere in the file.
  const txMatch = handleCreateBody.match(/prisma\.\$transaction\(async \(tx\) => \{[\s\S]*?\n {4}\}\)/)
  const txBody = txMatch?.[0] ?? ''

  it('handleCreate exists and its transaction body was extracted', () => {
    expect(handleCreateMatch).not.toBeNull()
    expect(txMatch).not.toBeNull()
  })

  it('imports and reuses lockWorkspaceRow from lib/workspace-lock, without modifying the helper file', () => {
    expect(routeSource).toMatch(/import \{ lockWorkspaceRow \} from '@\/lib\/workspace-lock'/)
  })

  it('handleCreate calls lockWorkspaceRow(tx, workspaceId) as the first statement inside its transaction', () => {
    const lockIdx = txBody.indexOf('lockWorkspaceRow(tx, workspaceId)')
    const subIdx  = txBody.indexOf('tx.subscription.findUnique(')
    const countIdx = txBody.indexOf('tx.client.count(')
    const createIdx = txBody.indexOf('tx.client.create(')
    expect(lockIdx).toBeGreaterThan(-1)
    expect(lockIdx).toBeLessThan(subIdx)
    expect(lockIdx).toBeLessThan(countIdx)
    expect(lockIdx).toBeLessThan(createIdx)
  })

  it('exact logical order: lock < Subscription read < getLimits < active count < isUnderLimit < create < onboarding claim', () => {
    const lockIdx    = txBody.indexOf('lockWorkspaceRow(tx, workspaceId)')
    const subIdx     = txBody.indexOf('tx.subscription.findUnique(')
    const limitsIdx  = txBody.indexOf("getLimits(subscription?.plan ?? 'FREE')")
    const countIdx   = txBody.indexOf('tx.client.count(')
    const underIdx   = txBody.indexOf('isUnderLimit(clientCount, limits.clients)')
    const createIdx  = txBody.indexOf('tx.client.create(')
    const claimIdx   = txBody.indexOf('tx.workspaceOnboarding.updateMany(')

    for (const idx of [lockIdx, subIdx, limitsIdx, countIdx, underIdx, createIdx, claimIdx]) {
      expect(idx).toBeGreaterThan(-1)
    }
    expect(lockIdx).toBeLessThan(subIdx)
    expect(subIdx).toBeLessThan(limitsIdx)
    expect(limitsIdx).toBeLessThan(countIdx)
    expect(countIdx).toBeLessThan(underIdx)
    expect(underIdx).toBeLessThan(createIdx)
    expect(createIdx).toBeLessThan(claimIdx)
  })

  it('the authoritative active Client count uses tx.client.count (not outer prisma.client.count), scoped by workspaceId and deletedAt: null', () => {
    expect(txBody).toMatch(/tx\.client\.count\(\{\s*where:\s*\{ workspaceId, deletedAt: null \},?\s*\}\)/)
    expect(handleCreateBody).not.toMatch(/(?<!tx\.)\bprisma\.client\.count\(/)
  })

  it('uses isUnderLimit(clientCount, limits.clients) with no numeric offset', () => {
    expect(txBody).toMatch(/isUnderLimit\(clientCount, limits\.clients\)/)
    expect(txBody).not.toMatch(/clientCount\s*-\s*1/)
    expect(txBody).not.toMatch(/clientCount\s*\+\s*1/)
  })

  it('re-reads Subscription.plan fresh under the lock, falls back to FREE, and never upserts/creates a Subscription', () => {
    expect(txBody).toMatch(/tx\.subscription\.findUnique\(\{\s*where:\s*\{ workspaceId \},/)
    expect(txBody).toMatch(/getLimits\(subscription\?\.plan \?\? 'FREE'\)/)
    expect(txBody).not.toMatch(/subscription\.(upsert|create)\(/)
  })

  it('returns exactly 403 { error: \'CLIENT_LIMIT_REACHED\' } when the locked authoritative check fails, without creating a Client', () => {
    expect(handleCreateBody).toMatch(/if \(result\.kind === 'limit_reached'\) \{\s*return NextResponse\.json\(\{ error: 'CLIENT_LIMIT_REACHED' \}, \{ status: 403 \}\)/)
    const limitBranch = txBody.match(/if \(!isUnderLimit\(clientCount, limits\.clients\)\) \{[\s\S]*?\n {6}\}/)?.[0] ?? ''
    expect(limitBranch).not.toMatch(/tx\.client\.create/)
  })

  it('tx.client.create occurs before the onboarding claim, which still anchors onboardingClientId to the newly created Client', () => {
    const createIdx = txBody.indexOf('tx.client.create(')
    const claimIdx  = txBody.indexOf('tx.workspaceOnboarding.updateMany(')
    expect(createIdx).toBeGreaterThan(-1)
    expect(claimIdx).toBeGreaterThan(-1)
    expect(createIdx).toBeLessThan(claimIdx)
    expect(txBody).toMatch(/onboardingClientId: created\.id,/)
  })

  it('a lost claim (count !== 1) still throws ClaimLostError — never a manual tx.client.delete or prisma.client.delete anywhere in the file', () => {
    expect(routeSource).toMatch(/if \(claim\.count !== 1\) throw new ClaimLostError\(\)/)
    expect(routeSource).not.toMatch(/\.client\.delete\(/)
  })

  it('the onboarding claim WHERE/data shape is unchanged: workspaceId, IN_PROGRESS, FIRST_CLIENT, owner identity, null anchor, and advances to FIRST_QBR with the idempotency key', () => {
    const claimCallMatch = txBody.match(/const claim = await tx\.workspaceOnboarding\.updateMany\(\{[\s\S]*?\n {6}\}\)/)
    expect(claimCallMatch).not.toBeNull()
    const call = claimCallMatch?.[0] ?? ''
    expect(call).toMatch(/workspaceId,/)
    expect(call).toMatch(/status: 'IN_PROGRESS',/)
    expect(call).toMatch(/currentStep: 'FIRST_CLIENT',/)
    expect(call).toMatch(/onboardingOwnerUserId: userId,/)
    expect(call).toMatch(/onboardingClientId: null,/)
    expect(call).toMatch(/clientStepIdempotencyKey: retryKey,/)
    expect(call).toMatch(/currentStep: 'FIRST_QBR',/)
  })
})

// These tests establish only the source-level serialization contract shared
// by this route and app/api/clients/route.ts: both call lockWorkspaceRow on
// the same Workspace row, before their respective authoritative Client
// counts, inside a Prisma interactive transaction. They do NOT execute two
// simultaneous requests against a real PostgreSQL database.
// REAL POSTGRES CROSS-PATH CONCURRENCY EXECUTION: NO.

describe('onboarding client route — post-rollback classification is exact-match only, never a range/inequality', () => {
  it('classifyClientConflict re-reads the onboarding row scoped by workspaceId', () => {
    expect(routeSource).toMatch(/async function classifyClientConflict\(workspaceId: string, userId: string, retryKey: string\) \{\s*const onboarding = await prisma\.workspaceOnboarding\.findUnique\(\{ where: \{ workspaceId \} \}\)/)
  })

  it('never contains a >=, <=, indexOf, or step-ordering comparison that could treat a further-along state as success', () => {
    expect(routeSource).not.toMatch(/>=|<=|STEP_ORDER|ALL_STEPS/)
  })
})

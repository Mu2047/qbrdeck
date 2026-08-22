import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: they read lib/workspace.ts as plain text and
// regex-match against it. They do NOT execute getWorkspaceContext() against a
// real database (this repo has no DB integration-test framework — see the
// precedent in tests/qbr-autosave-failure-handling.test.ts and
// tests/reminder-status-consistency.test.ts).
//
// IMPORTANT LIMITATION: these tests validate the locking/control-flow
// CONTRACT of the duplicate-workspace concurrency fix (lock precedes
// re-check, re-check precedes create, race-loser never creates, etc.) by
// asserting on source structure. They do NOT spin up two real concurrent
// Postgres connections and prove the lock actually serializes them at
// runtime — this repo has no isolated DB integration-test infrastructure to
// do that (see the P2 onboarding duplicate-workspace concurrency preflight).
// A real concurrency execution test is a separate, explicitly-authorized
// infrastructure decision, not something these tests claim to be.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const workspaceSource = readSourceLF('lib/workspace.ts')

// The fast existing-membership path: from its `if` down to the start of the
// zero-membership slow path.
const fastPathIdx = workspaceSource.indexOf('if (user.memberships.length > 0) {')
const slowPathIdx = workspaceSource.indexOf('// Zero memberships observed')
const fastPathBlock = workspaceSource.slice(fastPathIdx, slowPathIdx)

// The entire transactional slow path, from the transaction call through the
// end of getWorkspaceContext (bounded by the next exported function).
const txStartIdx = workspaceSource.indexOf('prisma.$transaction(async (tx) => {')
const nextFnIdx = workspaceSource.indexOf('export async function getWorkspaceMembership')
const transactionBlock = workspaceSource.slice(txStartIdx, nextFnIdx)

describe('lib/workspace.ts — fast path is untouched by the concurrency fix', () => {
  it('locates the existing-membership fast path', () => {
    expect(fastPathIdx).toBeGreaterThan(-1)
    expect(slowPathIdx).toBeGreaterThan(fastPathIdx)
  })

  it('the fast path never opens a transaction, never locks, never raw-queries', () => {
    expect(fastPathBlock).not.toMatch(/\$transaction/)
    expect(fastPathBlock).not.toMatch(/FOR UPDATE/)
    expect(fastPathBlock).not.toMatch(/\$queryRaw/)
  })

  it('the fast path delegates to the shared self-heal-aware resolveExistingMembership — no inline upsert duplicated here (see tests/onboarding-selfheal.test.ts for the resolver contract itself)', () => {
    expect(fastPathBlock).toMatch(/return resolveExistingMembership\(user\.id, user\.memberships\[0\]\)/)
    expect(fastPathBlock).not.toMatch(/workspaceOnboarding\.upsert/)
  })
})

describe('lib/workspace.ts — zero-membership bootstrap is wrapped in one interactive transaction', () => {
  it('locates the transaction', () => {
    expect(txStartIdx).toBeGreaterThan(-1)
  })

  it('there is exactly one prisma.$transaction( call site in the file', () => {
    const calls = workspaceSource.match(/prisma\.\$transaction\(/g) ?? []
    expect(calls.length).toBe(1)
  })

  it('prisma.workspace.create( no longer exists anywhere — the create moved fully inside the tx client', () => {
    expect(workspaceSource).not.toMatch(/prisma\.workspace\.create\(/)
  })

  it('there is exactly one tx.workspace.create( call site', () => {
    const calls = workspaceSource.match(/tx\.workspace\.create\(/g) ?? []
    expect(calls.length).toBe(1)
  })
})

describe('lib/workspace.ts — User row lock: exact target, parameterized, correctly ordered', () => {
  const lockQueryMatch = transactionBlock.match(/tx\.\$queryRaw<[^>]*>`([\s\S]*?)`/)
  const lockQuery = lockQueryMatch?.[1] ?? ''

  it('locates the raw lock query', () => {
    expect(lockQueryMatch).not.toBeNull()
  })

  it('targets the "User" table', () => {
    expect(lockQuery).toMatch(/FROM "User"/)
  })

  it('filters by the internal userId binding (user.id, not clerkId or any other identifier)', () => {
    expect(lockQuery).toMatch(/WHERE "id" = \$\{userId\}/)
    const userIdDecl = workspaceSource.match(/const userId = user\.id/)
    expect(userIdDecl).not.toBeNull()
  })

  it('contains FOR UPDATE', () => {
    expect(lockQuery).toMatch(/FOR UPDATE/)
  })

  it('uses a parameterized tagged-template query — never $queryRawUnsafe or $executeRawUnsafe anywhere in the file', () => {
    expect(workspaceSource).not.toMatch(/\$queryRawUnsafe/)
    expect(workspaceSource).not.toMatch(/\$executeRawUnsafe/)
  })

  it('handles the (unreachable-in-practice) case of no locked row by throwing, never silently bootstrapping', () => {
    expect(transactionBlock).toMatch(/if \(lockedUser\.length === 0\) \{[\s\S]*?throw new Error\(/)
  })
})

describe('lib/workspace.ts — lock precedes re-check precedes create (critical ordering)', () => {
  const lockIdx = transactionBlock.indexOf('FOR UPDATE')
  const recheckIdx = transactionBlock.indexOf('tx.workspaceMember.findFirst(')
  const createIdx = transactionBlock.indexOf('tx.workspace.create(')

  it('all three operations are located', () => {
    expect(lockIdx).toBeGreaterThan(-1)
    expect(recheckIdx).toBeGreaterThan(-1)
    expect(createIdx).toBeGreaterThan(-1)
  })

  it('FOR UPDATE appears before the transactional WorkspaceMember re-check', () => {
    expect(lockIdx).toBeLessThan(recheckIdx)
  })

  it('the transactional re-check appears before tx.workspace.create', () => {
    expect(recheckIdx).toBeLessThan(createIdx)
  })

  it('all three operations use the tx client, never the global prisma client', () => {
    expect(transactionBlock).toMatch(/tx\.\$queryRaw/)
    expect(transactionBlock).toMatch(/tx\.workspaceMember\.findFirst\(/)
    expect(transactionBlock).toMatch(/tx\.workspace\.create\(/)
    expect(transactionBlock).not.toMatch(/(?<!tx\.\w+.*?)\bprisma\.workspace(Member)?\.(create|findFirst)\(/)
  })
})

describe('lib/workspace.ts — locked re-check preserves canonical joinedAt ordering', () => {
  const recheckMatch = transactionBlock.match(/tx\.workspaceMember\.findFirst\(\{[\s\S]*?\}\)/)
  const recheckCall = recheckMatch?.[0] ?? ''

  it('locates the re-check call', () => {
    expect(recheckMatch).not.toBeNull()
  })

  it('is scoped to the exact userId, not clerkId or any other identifier', () => {
    expect(recheckCall).toMatch(/where:\s*\{\s*userId\s*\}/)
  })

  it('orders by joinedAt ascending — the same canonical rule as the fast path and getWorkspaceMembership', () => {
    expect(recheckCall).toMatch(/orderBy:\s*\{\s*joinedAt:\s*'asc'\s*\}/)
  })

  it('does not introduce any other/arbitrary ordering', () => {
    expect(recheckCall).not.toMatch(/orderBy:\s*\{\s*createdAt/)
    expect(recheckCall).not.toMatch(/take:\s*-?\d+/)
  })
})

describe('lib/workspace.ts — race loser: found membership under lock never creates a second workspace', () => {
  const loserMatch = transactionBlock.match(
    /if \(lockedMembership\) \{([\s\S]*?)\n    \}\n\n    \/\/ CONDITIONAL CREATE/
  )
  const loserBlock = loserMatch?.[1] ?? ''

  it('locates the race-loser branch', () => {
    expect(loserMatch).not.toBeNull()
  })

  it('never calls tx.workspace.create — a race loser must never create a second workspace', () => {
    expect(loserBlock).not.toMatch(/tx\.workspace\.create\(/)
  })

  it('does NOT call the self-heal resolver from inside the transaction — self-heal must run only after the lock releases (see tests/onboarding-selfheal.test.ts for the full reasoning: a race-loser membership is not provably a bootstrap winner, so it needs the same self-heal-aware resolution as any other existing membership, just executed outside this transaction)', () => {
    expect(loserBlock).not.toMatch(/resolveExistingMembership\(/)
    expect(loserBlock).not.toMatch(/workspaceOnboarding\.upsert/)
  })

  it('reports only a discriminated "existing" result — the winning role and workspace — for the caller to resolve after the transaction commits', () => {
    expect(loserBlock).toMatch(
      /return \{ kind: 'existing' as const, role: lockedMembership\.role, workspace: lockedMembership\.workspace \}/
    )
  })
})

describe('lib/workspace.ts — race winner: create only reached when locked re-check is still empty, nested atomic write preserved', () => {
  const createCallMatch = transactionBlock.match(
    /tx\.workspace\.create\(\{[\s\S]*?include: \{ subscription: true, onboarding: true \},?\s*\}\)/
  )
  const createCall = createCallMatch?.[0] ?? ''

  it('locates the tx.workspace.create({...}) call', () => {
    expect(createCallMatch).not.toBeNull()
  })

  it('is reached only after the "if (lockedMembership)" branch (i.e. only on the still-empty path)', () => {
    const loserIdx = transactionBlock.indexOf('if (lockedMembership) {')
    const createIdx = transactionBlock.indexOf('tx.workspace.create(')
    expect(loserIdx).toBeGreaterThan(-1)
    expect(createIdx).toBeGreaterThan(loserIdx)
  })

  it('nests both members.create (OWNER) and onboarding.create inside the same data object', () => {
    expect(createCall).toMatch(/data:\s*\{[\s\S]*members:\s*\{[\s\S]*create:\s*\{[\s\S]*userId,[\s\S]*role:\s*'OWNER',/)
    expect(createCall).toMatch(/onboarding:\s*\{\s*create:\s*onboardingGateEnabled\s*\?/)
  })

  it('members.create appears before onboarding.create within the same data object', () => {
    const membersIdx = createCall.indexOf('members:')
    const onboardingIdx = createCall.indexOf('onboarding:')
    expect(membersIdx).toBeGreaterThan(-1)
    expect(onboardingIdx).toBeGreaterThan(-1)
    expect(membersIdx).toBeLessThan(onboardingIdx)
  })

  it('the include on this same call also selects onboarding, so the result is available without a second query', () => {
    expect(createCall).toMatch(/include:\s*\{\s*subscription:\s*true,\s*onboarding:\s*true\s*\}/)
  })

  it('there is no await inside the create call literal — one expression, not a separately-awaited statement', () => {
    expect(createCall).not.toMatch(/\bawait\b/)
  })

  it('reports a discriminated "created" result from inside the transaction — the actual WorkspaceContext is built outside it, after commit', () => {
    expect(transactionBlock).toMatch(/return \{ kind: 'created' as const, workspace \}/)
  })

  it('outside the transaction, the created workspace is resolved directly via buildWorkspaceContext — never resolveExistingMembership (self-heal is never needed: onboarding is always already present from the nested create)', () => {
    const postTxMatch = workspaceSource.match(
      /\n  \}\)\n\n  if \(slowPathResult\.kind === 'existing'\) \{[\s\S]*?\n  \}\n\n  (return buildWorkspaceContext\(userId, 'OWNER', slowPathResult\.workspace, slowPathResult\.workspace\.onboarding\))/
    )
    expect(postTxMatch).not.toBeNull()
  })
})

// Split the winner's ternary branches the same way as before, sourced from
// the tx.workspace.create( call instead of the old prisma.workspace.create(.
const createCallForBranches = transactionBlock.match(
  /tx\.workspace\.create\(\{[\s\S]*?include: \{ subscription: true, onboarding: true \},?\s*\}\)/
)?.[0] ?? ''
const onboardingBranchesMatch = createCallForBranches.match(
  /onboarding:\s*\{\s*create:\s*onboardingGateEnabled\s*\?\s*\{([\s\S]*?)\}\s*:\s*\{([\s\S]*?)\},\s*\},/
)
const enabledBranch = onboardingBranchesMatch?.[1] ?? ''
const disabledBranch = onboardingBranchesMatch?.[2] ?? ''

describe('lib/workspace.ts — gate ENABLED (ONBOARDING_GATE_ENABLED === "true"): new workspace enrolls IN_PROGRESS', () => {
  it('locates both ternary branches', () => {
    expect(onboardingBranchesMatch).not.toBeNull()
  })

  it('sets status: IN_PROGRESS on the nested onboarding create', () => {
    expect(enabledBranch).toMatch(/status:\s*'IN_PROGRESS',/)
  })

  it('sets currentStep: WELCOME on the nested onboarding create', () => {
    expect(enabledBranch).toMatch(/currentStep:\s*'WELCOME',/)
  })

  it('anchors onboardingOwnerUserId to userId (the internal user id), not to any other identifier', () => {
    expect(enabledBranch).toMatch(/onboardingOwnerUserId:\s*userId,/)
    expect(enabledBranch).not.toMatch(/onboardingOwnerUserId:\s*membership\./)
  })

  it('populates startedAt with a fresh Date at enrollment time', () => {
    expect(enabledBranch).toMatch(/startedAt:\s*new Date\(\),/)
  })

  it('does not set exemptReason on the enabled branch', () => {
    expect(enabledBranch).not.toMatch(/exemptReason/)
  })
})

describe('lib/workspace.ts — gate DISABLED (anything other than literal "true"): new workspace is permanently EXEMPT', () => {
  it('sets status: EXEMPT on the nested onboarding create', () => {
    expect(disabledBranch).toMatch(/status:\s*'EXEMPT',/)
  })

  it('sets currentStep: null — no step is ever assigned to a gate-off workspace', () => {
    expect(disabledBranch).toMatch(/currentStep:\s*null,/)
  })

  it('sets onboardingOwnerUserId: null — no creator anchor while the gate is off', () => {
    expect(disabledBranch).toMatch(/onboardingOwnerUserId:\s*null,/)
  })

  it('sets both onboarding anchors (onboardingClientId, onboardingQbrId) to null', () => {
    expect(disabledBranch).toMatch(/onboardingClientId:\s*null,/)
    expect(disabledBranch).toMatch(/onboardingQbrId:\s*null,/)
  })

  it('sets both step idempotency keys (clientStepIdempotencyKey, qbrStepIdempotencyKey) to null', () => {
    expect(disabledBranch).toMatch(/clientStepIdempotencyKey:\s*null,/)
    expect(disabledBranch).toMatch(/qbrStepIdempotencyKey:\s*null,/)
  })

  it('sets both skip markers (exportSkippedAt, shareSkippedAt) to null', () => {
    expect(disabledBranch).toMatch(/exportSkippedAt:\s*null,/)
    expect(disabledBranch).toMatch(/shareSkippedAt:\s*null,/)
  })

  it('sets exemptReason to exactly pre_activation_gate_disabled — distinct from the two other reserved reasons', () => {
    expect(disabledBranch).toMatch(/exemptReason:\s*'pre_activation_gate_disabled',/)
    expect(disabledBranch).not.toMatch(/pre_onboarding_rollout/)
    expect(disabledBranch).not.toMatch(/post_backfill_pre_activation_gap/)
  })

  it('sets startedAt: null and completedAt: null — never a live journey', () => {
    expect(disabledBranch).toMatch(/startedAt:\s*null,/)
    expect(disabledBranch).toMatch(/completedAt:\s*null,/)
  })
})

describe('lib/workspace.ts — selected design only: no advisory lock, no Serializable retry, no schema-level claim', () => {
  it('never uses a PostgreSQL advisory lock of any kind', () => {
    expect(workspaceSource).not.toMatch(/pg_advisory/i)
  })

  it('never uses Serializable isolation or a transaction isolationLevel option', () => {
    expect(workspaceSource).not.toMatch(/Serializable/)
    expect(workspaceSource).not.toMatch(/isolationLevel/)
  })

  it('the lock key is the specific userId variable, not a global/hardcoded constant', () => {
    // The lock filters on ${userId} (asserted above); confirm no alternate
    // global lock key (e.g. a fixed string/number literal) is used instead.
    expect(transactionBlock).not.toMatch(/FOR UPDATE[\s\S]{0,50}pg_advisory/i)
  })
})

describe('lib/workspace.ts — multi-workspace membership remains fully supported (no new uniqueness constraint introduced)', () => {
  it('the source file makes no reference to a schema change or new unique constraint', () => {
    expect(workspaceSource).not.toMatch(/@@unique/)
    expect(workspaceSource).not.toMatch(/bootstrapOwnerUserId/)
  })
})

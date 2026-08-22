import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: they read lib/workspace.ts (and the invite routes,
// to prove they are untouched) as plain text and regex-match against them.
// They do NOT execute getWorkspaceContext() against a real database — this
// repo has no DB integration-test framework (see tests/onboarding-
// enrollment-atomicity.test.ts and tests/reminder-status-consistency.test.ts
// for the same precedent).
//
// Self-heal now lives in one shared function, resolveExistingMembership,
// used by BOTH the fast existing-membership path and — after its locking
// transaction has already committed — the slow path's race-loser branch.
// This closes a semantic gap found in pre-commit review: a membership
// discovered by the slow path's locked re-check is not provably the
// competing automatic-bootstrap winner (invite acceptance never locks the
// User row and can commit a membership into an arbitrary, possibly
// onboarding-less, existing workspace during the same window) — so it must
// go through the same self-heal-aware resolution as any other existing
// membership. See P2 onboarding — existing-membership semantic correction.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const workspaceSource = readSourceLF('lib/workspace.ts')

const resolverMatch = workspaceSource.match(
  /async function resolveExistingMembership\([\s\S]*?\n\}/
)
const resolverBody = resolverMatch?.[0] ?? ''

describe('lib/workspace.ts — resolveExistingMembership is the single self-heal-aware resolver', () => {
  it('locates the resolver function', () => {
    expect(resolverMatch).not.toBeNull()
  })

  it('contains the EXEMPT self-heal upsert', () => {
    expect(resolverBody).toMatch(/prisma\.workspaceOnboarding\.upsert\(/)
  })

  it('self-heal is only attempted when no onboarding row was already loaded (if (!onboarding))', () => {
    expect(resolverBody).toMatch(/let onboarding = workspace\.onboarding\s*\n\s*if \(!onboarding\) \{/)
  })

  it('uses the GLOBAL prisma client for the upsert, never a transaction tx client', () => {
    expect(resolverBody).toMatch(/prisma\.workspaceOnboarding\.upsert\(/)
    expect(resolverBody).not.toMatch(/tx\.workspaceOnboarding\.upsert\(/)
    expect(resolverBody).not.toMatch(/\btx\./)
  })
})

describe('lib/workspace.ts — resolveExistingMembership: self-heal upsert is workspaceId-scoped and idempotent', () => {
  const upsertMatch = resolverBody.match(
    /prisma\.workspaceOnboarding\.upsert\(\{[\s\S]*?\n\s+\}\)/
  )
  const upsertCall = upsertMatch?.[0] ?? ''

  it('locates the upsert call', () => {
    expect(upsertMatch).not.toBeNull()
  })

  it('is scoped by the workspaceId unique constraint, not any other field', () => {
    expect(upsertCall).toMatch(/where:\s*\{\s*workspaceId:\s*workspace\.id\s*\}/)
  })

  it('update is a literal no-op {} — it must never overwrite an existing IN_PROGRESS/COMPLETED/EXEMPT row', () => {
    expect(upsertCall).toMatch(/update:\s*\{\},/)
  })

  it('create sets status: EXEMPT', () => {
    expect(upsertCall).toMatch(/create:\s*\{[\s\S]*status:\s*'EXEMPT',/)
  })

  it('create sets currentStep: null', () => {
    expect(upsertCall).toMatch(/currentStep:\s*null,/)
  })

  it('create sets exemptReason to exactly post_backfill_pre_activation_gap', () => {
    expect(upsertCall).toMatch(/exemptReason:\s*'post_backfill_pre_activation_gap',/)
  })

  it('create sets onboardingOwnerUserId: null — no historical-creator inference on self-heal', () => {
    expect(upsertCall).toMatch(/onboardingOwnerUserId:\s*null,/)
  })

  it('create is scoped to this exact workspaceId', () => {
    expect(upsertCall).toMatch(/create:\s*\{\s*workspaceId:\s*workspace\.id,/)
  })
})

describe('lib/workspace.ts — resolveExistingMembership: self-heal failure is narrowly scoped and fail-open', () => {
  it('the upsert call sits inside its own try block, not a broad try wrapping unrelated resolver logic', () => {
    expect(resolverBody).toMatch(
      /try \{\s*onboarding = await prisma\.workspaceOnboarding\.upsert\(/
    )
  })

  it('the catch sets onboarding back to null — never fabricates IN_PROGRESS, never rethrows to fail the whole request', () => {
    const catchMatch = resolverBody.match(/\} catch \{[\s\S]*?\n\s{4}\}/)
    const catchBlock = catchMatch?.[0] ?? ''
    expect(catchBlock).not.toBe('')
    expect(catchBlock).toMatch(/onboarding = null/)
    expect(catchBlock).not.toMatch(/throw/)
    expect(catchBlock).not.toMatch(/IN_PROGRESS/)
  })

  it('the try/catch wraps only the upsert call, not the subsequent buildWorkspaceContext call', () => {
    const catchIdx = resolverBody.search(/\} catch \{[\s\S]*?\n\s{4}\}/)
    const catchBlock = resolverBody.match(/\} catch \{[\s\S]*?\n\s{4}\}/)?.[0] ?? ''
    const catchEndIdx = catchIdx + catchBlock.length
    const returnIdx = resolverBody.indexOf('return buildWorkspaceContext(')
    expect(catchIdx).toBeGreaterThan(-1)
    expect(returnIdx).toBeGreaterThan(catchEndIdx)
  })

  it('passes the possibly-reassigned local `onboarding` variable into buildWorkspaceContext — never workspace.onboarding directly, which would bypass a successful self-heal', () => {
    expect(resolverBody).toMatch(
      /return buildWorkspaceContext\(userId, membership\.role, workspace, onboarding\)/
    )
  })

  it('buildWorkspaceContext itself treats its onboarding parameter as conditional — never unconditionally assumed present', () => {
    const helperMatch = workspaceSource.match(/function buildWorkspaceContext\([\s\S]*?\n\}/)
    const helperBody = helperMatch?.[0] ?? ''
    expect(helperMatch).not.toBeNull()
    expect(helperBody).toMatch(/onboarding:\s*onboarding\s*\n\s*\?\s*\{/)
  })
})

describe('lib/workspace.ts — both the fast path and the slow-path race-loser resolve through the SAME resolver', () => {
  it('the fast existing-membership path delegates directly to resolveExistingMembership — no inline self-heal duplicated there', () => {
    const fastPathMatch = workspaceSource.match(
      /if \(user\.memberships\.length > 0\) \{([\s\S]*?)\n  \}/
    )
    const fastPathBody = fastPathMatch?.[1] ?? ''
    expect(fastPathMatch).not.toBeNull()
    expect(fastPathBody).toMatch(/return resolveExistingMembership\(user\.id, user\.memberships\[0\]\)/)
    expect(fastPathBody).not.toMatch(/workspaceOnboarding\.upsert/)
  })

  it('the slow-path race-loser branch does NOT call resolveExistingMembership itself — it only reports which membership won', () => {
    const transactionMatch = workspaceSource.match(
      /prisma\.\$transaction\(async \(tx\) => \{[\s\S]*?\n  \}\)/
    )
    const transactionBody = transactionMatch?.[0] ?? ''
    expect(transactionMatch).not.toBeNull()
    expect(transactionBody).not.toMatch(/resolveExistingMembership\(/)
    expect(transactionBody).toMatch(/return \{ kind: 'existing' as const,/)
  })

  it('after the transaction commits, the "existing" result is resolved through resolveExistingMembership outside the transaction', () => {
    const postTxMatch = workspaceSource.match(
      /\n  \}\)\n\n  if \(slowPathResult\.kind === 'existing'\) \{([\s\S]*?)\n  \}/
    )
    const postTxBody = postTxMatch?.[1] ?? ''
    expect(postTxMatch).not.toBeNull()
    expect(postTxBody).toMatch(/return resolveExistingMembership\(userId, \{/)
  })

  it('the post-transaction resolution call is textually after the closing of prisma.$transaction(...) — proving the lock has already released before self-heal can run', () => {
    const txCallIdx = workspaceSource.indexOf("prisma.$transaction(async (tx) => {")
    const resolveCallIdx = workspaceSource.indexOf(
      "return resolveExistingMembership(userId, {",
      txCallIdx
    )
    const txCloseIdx = workspaceSource.indexOf('\n  })\n', txCallIdx)
    expect(txCallIdx).toBeGreaterThan(-1)
    expect(txCloseIdx).toBeGreaterThan(txCallIdx)
    expect(resolveCallIdx).toBeGreaterThan(txCloseIdx)
  })
})

describe('lib/workspace.ts — race-winner outcome unaffected by the correction', () => {
  it('when the locked re-check still finds zero memberships, the created workspace is resolved directly via buildWorkspaceContext, not resolveExistingMembership (its onboarding is always already present)', () => {
    expect(workspaceSource).toMatch(
      /return buildWorkspaceContext\(userId, 'OWNER', slowPathResult\.workspace, slowPathResult\.workspace\.onboarding\)/
    )
  })
})

describe('invite routes remain completely untouched by onboarding self-heal/enrollment', () => {
  const inviteRouteSource = readSourceLF('app/api/workspace/invite/route.ts')
  const inviteAcceptRouteSource = readSourceLF('app/api/workspace/invite/accept/route.ts')

  it('the invite-send route never references WorkspaceOnboarding/onboarding', () => {
    expect(inviteRouteSource).not.toMatch(/[Oo]nboarding/)
  })

  it('the invite-accept route never references WorkspaceOnboarding/onboarding', () => {
    expect(inviteAcceptRouteSource).not.toMatch(/[Oo]nboarding/)
  })

  it('invite acceptance still adds the member and marks the invite accepted, with no onboarding write mixed into that transaction', () => {
    expect(inviteAcceptRouteSource).toMatch(/prisma\.\$transaction\(\[/)
    expect(inviteAcceptRouteSource).toMatch(/prisma\.workspaceMember\.create\(/)
    expect(inviteAcceptRouteSource).toMatch(/prisma\.workspaceInvite\.update\(/)
    expect(inviteAcceptRouteSource).not.toMatch(/workspaceOnboarding/)
  })

  it('invite acceptance never locks the User row — this is precisely why a race-loser membership cannot be assumed to be a bootstrap winner', () => {
    expect(inviteAcceptRouteSource).not.toMatch(/FOR UPDATE/)
    expect(inviteAcceptRouteSource).not.toMatch(/\$queryRaw/)
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: they read lib/workspace.ts (and the invite routes,
// to prove they are untouched) as plain text and regex-match against them.
// They do NOT execute getWorkspaceContext() against a real database — this
// repo has no DB integration-test framework (see tests/onboarding-
// enrollment-atomicity.test.ts and tests/reminder-status-consistency.test.ts
// for the same precedent).

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const workspaceSource = readSourceLF('lib/workspace.ts')

const existingMembershipBranch = workspaceSource.slice(
  workspaceSource.indexOf('if (user.memberships.length > 0) {'),
  workspaceSource.indexOf('// No workspace yet')
)

const newWorkspaceBranch = workspaceSource.slice(
  workspaceSource.indexOf('// No workspace yet')
)

describe('lib/workspace.ts — self-heal fires only on the existing-membership path', () => {
  it('the existing-membership branch contains the EXEMPT self-heal upsert', () => {
    expect(existingMembershipBranch).toMatch(/prisma\.workspaceOnboarding\.upsert\(/)
  })

  it('the new-workspace creation branch does NOT contain any self-heal upsert', () => {
    expect(newWorkspaceBranch).not.toMatch(/prisma\.workspaceOnboarding\.upsert\(/)
    expect(newWorkspaceBranch).not.toMatch(/post_backfill_pre_activation_gap/)
  })

  it('self-heal is only attempted when no onboarding row was already loaded (if (!onboarding))', () => {
    expect(existingMembershipBranch).toMatch(/let onboarding = workspace\.onboarding\s*\n\s*if \(!onboarding\) \{/)
  })
})

describe('lib/workspace.ts — self-heal upsert is workspaceId-scoped and idempotent', () => {
  const upsertMatch = existingMembershipBranch.match(
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

describe('lib/workspace.ts — self-heal failure is narrowly scoped and fail-open', () => {
  it('the upsert call sits inside its own try block, not a broad try wrapping unrelated getWorkspaceContext logic', () => {
    expect(existingMembershipBranch).toMatch(
      /try \{\s*onboarding = await prisma\.workspaceOnboarding\.upsert\(/
    )
  })

  it('the catch sets onboarding back to null — never fabricates IN_PROGRESS, never rethrows to fail the whole request', () => {
    const catchMatch = existingMembershipBranch.match(/\} catch \{[\s\S]*?\n\s{6}\}/)
    const catchBlock = catchMatch?.[0] ?? ''
    expect(catchBlock).not.toBe('')
    expect(catchBlock).toMatch(/onboarding = null/)
    expect(catchBlock).not.toMatch(/throw/)
    expect(catchBlock).not.toMatch(/IN_PROGRESS/)
  })

  it('the try/catch wraps only the upsert call, not the subsequent return statement building the rest of the context', () => {
    // The context's `return {` (building workspaceId/workspace/member/subscription/onboarding)
    // must appear after the catch block closes, i.e. outside the try/catch — proving the
    // narrowly-scoped catch cannot swallow failures from unrelated context-building logic.
    const catchIdx = existingMembershipBranch.search(/\} catch \{[\s\S]*?\n\s{6}\}/)
    const catchBlock = existingMembershipBranch.match(/\} catch \{[\s\S]*?\n\s{6}\}/)?.[0] ?? ''
    const catchEndIdx = catchIdx + catchBlock.length
    const returnIdx = existingMembershipBranch.indexOf('return {')
    expect(catchIdx).toBeGreaterThan(-1)
    expect(returnIdx).toBeGreaterThan(catchEndIdx)
  })

  it('the returned onboarding field is conditional on the (possibly still-null, post-failure) onboarding variable — never unconditionally assumed present', () => {
    expect(existingMembershipBranch).toMatch(/onboarding:\s*onboarding\s*\n\s*\?\s*\{/)
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
})

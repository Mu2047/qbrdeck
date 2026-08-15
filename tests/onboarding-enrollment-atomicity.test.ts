import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: they read lib/workspace.ts as plain text and
// regex-match against it. They do NOT execute getWorkspaceContext() against a
// real database (this repo has no DB integration-test framework — see the
// precedent in tests/qbr-autosave-failure-handling.test.ts and
// tests/reminder-status-consistency.test.ts). They prove the enrollment
// write is nested inside the SAME prisma.workspace.create() call as the
// OWNER WorkspaceMember create, not issued as a second, sequential write.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const workspaceSource = readSourceLF('lib/workspace.ts')

// The exact prisma.workspace.create({...}) call used for new-workspace
// enrollment, captured whole (starting at the call itself, not the
// `const workspace = await` prefix, so a later "no nested await" check isn't
// tripped up by the call's own outer await keyword) so member/onboarding
// ordering and nesting can be asserted against a single matched block rather
// than two independent regexes that could each match unrelated call sites.
const createCallMatch = workspaceSource.match(
  /prisma\.workspace\.create\(\{[\s\S]*?include: \{ subscription: true, onboarding: true \},?\s*\}\)/
)

describe('lib/workspace.ts — new-workspace enrollment is one atomic nested write', () => {
  it('locates the new-workspace prisma.workspace.create({...}) call', () => {
    expect(createCallMatch).not.toBeNull()
  })

  const createCall = createCallMatch?.[0] ?? ''

  it('nests both members.create and onboarding.create inside the same data object', () => {
    expect(createCall).toMatch(/data:\s*\{[\s\S]*members:\s*\{[\s\S]*create:\s*\{[\s\S]*userId:\s*user\.id,[\s\S]*role:\s*'OWNER',/)
    expect(createCall).toMatch(/onboarding:\s*\{\s*create:\s*\{/)
  })

  it('members.create appears before onboarding.create within the same data object (both nested, neither a second top-level call)', () => {
    const membersIdx = createCall.indexOf('members:')
    const onboardingIdx = createCall.indexOf('onboarding:')
    expect(membersIdx).toBeGreaterThan(-1)
    expect(onboardingIdx).toBeGreaterThan(-1)
    expect(membersIdx).toBeLessThan(onboardingIdx)
  })

  it('sets status: IN_PROGRESS on the nested onboarding create', () => {
    expect(createCall).toMatch(/onboarding:\s*\{\s*create:\s*\{\s*status:\s*'IN_PROGRESS',/)
  })

  it('sets currentStep: WELCOME on the nested onboarding create', () => {
    expect(createCall).toMatch(/currentStep:\s*'WELCOME',/)
  })

  it('anchors onboardingOwnerUserId to user.id, not to any other identifier', () => {
    expect(createCall).toMatch(/onboardingOwnerUserId:\s*user\.id,/)
    expect(createCall).not.toMatch(/onboardingOwnerUserId:\s*membership\./)
  })

  it('populates startedAt with a fresh Date at enrollment time', () => {
    expect(createCall).toMatch(/startedAt:\s*new Date\(\),/)
  })

  it('the include on this same call also selects onboarding, so the atomic result is available to the caller without a second query', () => {
    expect(createCall).toMatch(/include:\s*\{\s*subscription:\s*true,\s*onboarding:\s*true\s*\}/)
  })
})

describe('lib/workspace.ts — no sequential workspaceOnboarding.create() exists anywhere for enrollment', () => {
  it('the workspace create call itself is directly awaited into `workspace` — not fired-and-forgotten before a later sequential onboarding write', () => {
    expect(workspaceSource).toMatch(/const workspace = await prisma\.workspace\.create\(\{/)
  })

  it('never calls prisma.workspaceOnboarding.create(...) directly — the only onboarding create is the nested one inside workspace.create, and the self-heal path uses upsert', () => {
    expect(workspaceSource).not.toMatch(/prisma\.workspaceOnboarding\.create\(/)
  })

  it('there is exactly one prisma.workspace.create( call site in the file', () => {
    const calls = workspaceSource.match(/prisma\.workspace\.create\(/g) ?? []
    expect(calls.length).toBe(1)
  })

  it('the enrollment onboarding create is not preceded by an early return/await that would let the workspace commit before onboarding is attempted', () => {
    // The whole thing is one expression passed to `await prisma.workspace.create({ ... })`,
    // so nothing between `data: {` and the matched closing `})` can execute as a separate,
    // independently-awaited statement — there is no `await` inside the create call literal.
    const createCall = createCallMatch?.[0] ?? ''
    expect(createCall).not.toMatch(/\bawait\b/)
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: they read lib/workspace.ts as plain text and
// regex-match against it. They do NOT execute getWorkspaceContext() against a
// real database (this repo has no DB integration-test framework — see the
// precedent in tests/qbr-autosave-failure-handling.test.ts and
// tests/reminder-status-consistency.test.ts). They prove the enrollment
// write is nested inside the SAME prisma.workspace.create() call as the
// OWNER WorkspaceMember create, not issued as a second, sequential write —
// for BOTH the gate-enabled and gate-disabled onboarding shapes (P2
// onboarding PR 9 activation-boundary correction).

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
    expect(createCall).toMatch(/onboarding:\s*\{\s*create:\s*onboardingGateEnabled\s*\?/)
  })

  it('members.create appears before onboarding.create within the same data object (both nested, neither a second top-level call)', () => {
    const membersIdx = createCall.indexOf('members:')
    const onboardingIdx = createCall.indexOf('onboarding:')
    expect(membersIdx).toBeGreaterThan(-1)
    expect(onboardingIdx).toBeGreaterThan(-1)
    expect(membersIdx).toBeLessThan(onboardingIdx)
  })

  it('the include on this same call also selects onboarding, so the atomic result is available to the caller without a second query', () => {
    expect(createCall).toMatch(/include:\s*\{\s*subscription:\s*true,\s*onboarding:\s*true\s*\}/)
  })

  it('there is no await anywhere inside the create call literal — the whole ternary is one expression, not a separately-awaited statement', () => {
    expect(createCall).not.toMatch(/\bawait\b/)
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
})

describe('lib/workspace.ts — enrollment shares the exact same activation boundary as dashboard interception', () => {
  it('declares onboardingGateEnabled using the exact literal-true check, before the create call', () => {
    expect(workspaceSource).toMatch(
      /const onboardingGateEnabled = process\.env\.ONBOARDING_GATE_ENABLED === 'true'/
    )
    const declIdx = workspaceSource.indexOf('const onboardingGateEnabled =')
    const createIdx = workspaceSource.indexOf('const workspace = await prisma.workspace.create(')
    expect(declIdx).toBeGreaterThan(-1)
    expect(createIdx).toBeGreaterThan(declIdx)
  })

  it('introduces no second onboarding-activation environment variable — ONBOARDING_GATE_ENABLED is the only one referenced', () => {
    const envVars = workspaceSource.match(/process\.env\.[A-Z0-9_]+/g) ?? []
    const distinctGateLikeVars = new Set(envVars.filter((v) => v.includes('ONBOARDING') || v.includes('GATE')))
    expect(Array.from(distinctGateLikeVars)).toEqual(['process.env.ONBOARDING_GATE_ENABLED'])
  })

  it('the onboarding.create value is a ternary keyed directly on onboardingGateEnabled — no helper indirection', () => {
    const createCall = createCallMatch?.[0] ?? ''
    expect(createCall).toMatch(/create:\s*onboardingGateEnabled\s*\?\s*\{/)
  })
})

// Split the ternary's two branches out of the matched create call so the
// enabled/disabled onboarding shapes can each be asserted independently.
const createCall = createCallMatch?.[0] ?? ''
const onboardingBranchesMatch = createCall.match(
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

  it('anchors onboardingOwnerUserId to user.id, not to any other identifier', () => {
    expect(enabledBranch).toMatch(/onboardingOwnerUserId:\s*user\.id,/)
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

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: they read app/api/onboarding/workspace-name/route.ts
// as plain text and regex-match against it. They do NOT execute the route
// against a real database — this repo has no DB integration-test framework
// (see tests/onboarding-first-client-route.test.ts for the same precedent).

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const routeSource = readSourceLF('app/api/onboarding/workspace-name/route.ts')
const genericWorkspaceRouteSource = readSourceLF('app/api/workspace/route.ts')

describe('workspace-name route — authentication and membership resolution', () => {
  it('authenticates via Clerk auth() and returns 401 when absent', () => {
    expect(routeSource).toMatch(/const \{ userId: clerkId \} = auth\(\)/)
    expect(routeSource).toMatch(/if \(!clerkId\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/)
  })

  it('resolves identity via getWorkspaceMembership, not getWorkspaceContext', () => {
    expect(routeSource).toMatch(/import \{ getWorkspaceMembership \} from '@\/lib\/workspace'/)
    expect(routeSource).not.toMatch(/getWorkspaceContext/)
  })
})

describe('workspace-name route — strict body, no browser-supplied authority fields', () => {
  it('the zod schema defines exactly one field: name', () => {
    expect(routeSource).toMatch(/const bodySchema = z\.object\(\{\s*name: z\.string\(\),\s*\}\)\.strict\(\)/)
  })

  it('never reads workspaceId, userId, ownerId, currentStep, toStep, or role from the parsed body', () => {
    expect(routeSource).not.toMatch(/parsed\.data\.workspaceId/)
    expect(routeSource).not.toMatch(/parsed\.data\.userId/)
    expect(routeSource).not.toMatch(/parsed\.data\.ownerId/)
    expect(routeSource).not.toMatch(/parsed\.data\.currentStep/)
    expect(routeSource).not.toMatch(/parsed\.data\.toStep/)
    expect(routeSource).not.toMatch(/parsed\.data\.role/)
  })

  it('trims the name and rejects an empty/whitespace-only result with 400', () => {
    expect(routeSource).toMatch(/const normalizedName = parsed\.data\.name\.trim\(\)/)
    expect(routeSource).toMatch(/if \(!normalizedName\) \{\s*return NextResponse\.json\(\{ error: 'Name is required' \}, \{ status: 400 \}\)/)
  })
})

describe('workspace-name route — creator-anchor authority only, never TeamRole', () => {
  it('never reads membership.role, imports TeamRole, or calls the can.* permission helpers', () => {
    expect(routeSource).not.toMatch(/membership\.role/)
    expect(routeSource).not.toMatch(/import[^\n]*TeamRole/)
    expect(routeSource).not.toMatch(/\bcan\./)
  })

  it('eligibility is decided solely by onboarding.onboardingOwnerUserId === userId', () => {
    expect(routeSource).toMatch(/if \(onboarding\.onboardingOwnerUserId !== userId\) \{\s*return NextResponse\.json\(\{ error: 'Forbidden' \}, \{ status: 403 \}\)/)
  })
})

describe('workspace-name route — fresh-path state guard is exact, never "further along"', () => {
  it('requires IN_PROGRESS and currentStep WORKSPACE_NAME exactly', () => {
    const isFreshStateMatch = routeSource.match(/const isFreshState =\s*onboarding\.status === 'IN_PROGRESS' &&\s*onboarding\.currentStep === 'WORKSPACE_NAME'/)
    expect(isFreshStateMatch).not.toBeNull()
  })

  it('a missing onboarding row returns 409 before the owner check', () => {
    const missingRowIdx = routeSource.indexOf('if (!onboarding) {')
    const ownerCheckIdx = routeSource.indexOf('onboarding.onboardingOwnerUserId !== userId')
    expect(missingRowIdx).toBeGreaterThan(-1)
    expect(missingRowIdx).toBeLessThan(ownerCheckIdx)
  })
})

describe('workspace-name route — one atomic transaction: rename + claim together', () => {
  it('locates a single $transaction call containing both the workspace update and the onboarding claim', () => {
    const txMatch = routeSource.match(/prisma\.\$transaction\(async \(tx\) => \{[\s\S]*?\n {6}\}\)/)
    expect(txMatch).not.toBeNull()
    const txBody = txMatch?.[0] ?? ''
    expect(txBody).toMatch(/tx\.workspace\.update\(\{\s*where:\s*\{ id: workspaceId \},\s*data:\s*\{ name: normalizedName \},/)
    expect(txBody).toMatch(/tx\.workspaceOnboarding\.updateMany\(/)
  })

  it('the claim where-clause requires exact workspaceId, status IN_PROGRESS, currentStep WORKSPACE_NAME, and exact owner', () => {
    const claimMatch = routeSource.match(/const claim = await tx\.workspaceOnboarding\.updateMany\(\{[\s\S]*?\n {8}\}\)/)
    expect(claimMatch).not.toBeNull()
    const claim = claimMatch?.[0] ?? ''
    expect(claim).toMatch(/workspaceId,/)
    expect(claim).toMatch(/status:\s*'IN_PROGRESS',/)
    expect(claim).toMatch(/currentStep:\s*'WORKSPACE_NAME',/)
    expect(claim).toMatch(/onboardingOwnerUserId:\s*userId,/)
    expect(claim).toMatch(/data:\s*\{ currentStep: 'FIRST_CLIENT' \}/)
  })

  it('a lost claim (count !== 1) throws inside the transaction, rolling back the rename — never a manual undo', () => {
    expect(routeSource).toMatch(/if \(claim\.count !== 1\) throw new ClaimLostError\(\)/)
    expect(routeSource).not.toMatch(/tx\.workspace\.update\(\{[\s\S]*?name:\s*undefined/)
  })
})

describe('workspace-name route — post-rollback classification is exact-match only', () => {
  it('classifyReplay re-reads the onboarding row scoped by workspaceId', () => {
    expect(routeSource).toMatch(/async function classifyReplay\(workspaceId: string, userId: string, normalizedName: string\) \{\s*const onboarding = await prisma\.workspaceOnboarding\.findUnique\(\{ where: \{ workspaceId \} \}\)/)
  })

  it('exact retry success requires currentStep FIRST_CLIENT AND workspace.name === the exact normalized requested name', () => {
    expect(routeSource).toMatch(/onboarding\.status === 'IN_PROGRESS' &&\s*onboarding\.currentStep === 'FIRST_CLIENT'/)
    expect(routeSource).toMatch(/if \(workspace && workspace\.name === normalizedName\)/)
  })

  it('never contains a >=, <=, indexOf, or step-ordering comparison that could treat a further-along state as success', () => {
    expect(routeSource).not.toMatch(/>=|<=|STEP_ORDER|ALL_STEPS/)
  })

  it('any other post-classification shape falls through to 409 conflict, never silent success', () => {
    expect(routeSource).toMatch(/return NextResponse\.json\(\{ error: 'Onboarding state conflict' \}, \{ status: 409 \}\)/)
  })

  it('unexpected exceptions are not swallowed into a conflict — only ClaimLostError triggers classifyReplay from the transaction catch', () => {
    const catchMatch = routeSource.match(/\} catch \(err\) \{\s*if \(err instanceof ClaimLostError\) \{\s*return await classifyReplay\([\s\S]*?\n {6}\}\s*throw err\s*\}/)
    expect(catchMatch).not.toBeNull()
  })
})

describe('generic PATCH /api/workspace remains completely unchanged', () => {
  it('still requires can.manageSettings(membership.role) — OWNER-role gated, untouched by the new onboarding endpoint', () => {
    expect(genericWorkspaceRouteSource).toMatch(/if \(!can\.manageSettings\(membership\.role\)\)/)
  })

  it('does not import or reference anything onboarding-specific', () => {
    expect(genericWorkspaceRouteSource).not.toMatch(/onboarding/i)
  })
})

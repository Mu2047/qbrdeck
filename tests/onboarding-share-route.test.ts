import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: they read app/api/onboarding/share/route.ts as
// plain text and regex-match against it. They do NOT execute the route
// against a real database — this repo has no DB integration-test framework.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const routeSource = readSourceLF('app/api/onboarding/share/route.ts')

describe('onboarding share route — authentication, membership, and the real exportQBR role gate', () => {
  it('authenticates via Clerk auth() and returns 401 when absent', () => {
    expect(routeSource).toMatch(/const \{ userId: clerkId \} = auth\(\)/)
    expect(routeSource).toMatch(/if \(!clerkId\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/)
  })

  it('reuses the same can.exportQBR(membership.role) gate as the generic export/share/send routes', () => {
    expect(routeSource).toMatch(/if \(!can\.exportQBR\(membership\.role\)\)/)
  })
})

describe('onboarding share route — strict discriminated body, no qbrId/clientId/workspaceId/userId authority', () => {
  it('link action carries only { action: "link" }', () => {
    expect(routeSource).toMatch(/const linkSchema = z\.object\(\{ action: z\.literal\('link'\) \}\)\.strict\(\)/)
  })

  it('email action carries only { action: "email", email } — a validated email, nothing else', () => {
    expect(routeSource).toMatch(/const emailSchema = z\.object\(\{ action: z\.literal\('email'\), email: z\.string\(\)\.email\(\) \}\)\.strict\(\)/)
  })

  it('never reads qbrId, clientId, workspaceId, userId, or ownerId from the parsed body', () => {
    expect(routeSource).not.toMatch(/parsed\.data\.qbrId/)
    expect(routeSource).not.toMatch(/body\.qbrId/)
    expect(routeSource).not.toMatch(/parsed\.data\.clientId/)
    expect(routeSource).not.toMatch(/parsed\.data\.workspaceId/)
    expect(routeSource).not.toMatch(/parsed\.data\.userId/)
  })
})

describe('onboarding share route — exact onboarding-state gate, anchored QBR only', () => {
  it('requires exactly status IN_PROGRESS, currentStep SHARE_QBR, and both anchors present', () => {
    expect(routeSource).toMatch(/onboarding\.status !== 'IN_PROGRESS' \|\|\s*onboarding\.currentStep !== 'SHARE_QBR' \|\|\s*onboarding\.onboardingClientId == null \|\|\s*onboarding\.onboardingQbrId == null/)
  })

  it('resolves the anchored QBR by onboarding.onboardingQbrId, scoped to workspaceId, clientId, and deletedAt: null', () => {
    expect(routeSource).toMatch(/const anchoredQbr = await prisma\.qBR\.findFirst\(\{\s*where:\s*\{\s*id:\s*onboarding\.onboardingQbrId,\s*workspaceId,\s*clientId:\s*onboarding\.onboardingClientId,\s*deletedAt:\s*null,/)
  })

  it('a missing anchored QBR returns 409 Onboarding state conflict', () => {
    expect(routeSource).toMatch(/if \(!anchoredQbr\) \{\s*return NextResponse\.json\(\{ error: 'Onboarding state conflict' \}, \{ status: 409 \}\)/)
  })
})

describe('onboarding share route — reuses existing ShareLink/send mechanics exactly, no reimplementation', () => {
  it('imports createShareLink from lib/share-links and sendQBREmail from lib/email — the same libs the generic routes use', () => {
    expect(routeSource).toMatch(/import \{ createShareLink \} from '@\/lib\/share-links'/)
    expect(routeSource).toMatch(/import \{ sendQBREmail \} from '@\/lib\/email'/)
  })

  it('the link action creates a share link scoped to the anchored QBR only, never a browser id', () => {
    const linkBranchMatch = routeSource.match(/if \(parsed\.data\.action === 'link'\) \{[\s\S]*?\n    \}/)
    expect(linkBranchMatch).not.toBeNull()
    expect(linkBranchMatch?.[0] ?? '').toMatch(/createShareLink\(\{ qbrId: anchoredQbr\.id, workspaceId, userId \}\)/)
  })

  it('the email action requires an explicit validated email and never fires without one (zod .email() already rejects a missing/invalid address)', () => {
    expect(routeSource).toMatch(/email: z\.string\(\)\.email\(\)/)
  })

  it('never sends an email outside the explicit action === "email" branch', () => {
    const sendCallOccurrences = routeSource.match(/sendQBREmail\(/g) ?? []
    expect(sendCallOccurrences.length).toBe(1)
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: they read app/api/onboarding/finish/route.ts as
// plain text and regex-match against it. They do NOT execute the route
// against a real database — this repo has no DB integration-test framework.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const routeSource = readSourceLF('app/api/onboarding/finish/route.ts')

describe('finish route — authentication and membership resolution', () => {
  it('authenticates via Clerk auth() and returns 401 when absent', () => {
    expect(routeSource).toMatch(/const \{ userId: clerkId \} = auth\(\)/)
    expect(routeSource).toMatch(/if \(!clerkId\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/)
  })

  it('never reads a request body — no req.json() call anywhere, no workspace/user authority accepted from the client', () => {
    expect(routeSource).not.toMatch(/req\.json\(\)/)
  })

  it('never reads membership.role, imports TeamRole, or calls can.*', () => {
    expect(routeSource).not.toMatch(/membership\.role/)
    expect(routeSource).not.toMatch(/import[^\n]*TeamRole/)
    expect(routeSource).not.toMatch(/\bcan\./)
  })
})

describe('finish route — atomic conditional completion write', () => {
  const updateManyMatch = routeSource.match(/prisma\.workspaceOnboarding\.updateMany\(\{[\s\S]*?\n\s{4}\}\)/)
  const updateManyCall = updateManyMatch?.[0] ?? ''

  it('locates the updateMany call', () => {
    expect(updateManyMatch).not.toBeNull()
  })

  it('where clause requires workspaceId, status IN_PROGRESS, currentStep COMPLETE, and exact onboardingOwnerUserId', () => {
    expect(updateManyCall).toMatch(/where:\s*\{\s*workspaceId,/)
    expect(updateManyCall).toMatch(/status:\s*'IN_PROGRESS',/)
    expect(updateManyCall).toMatch(/currentStep:\s*'COMPLETE',/)
    expect(updateManyCall).toMatch(/onboardingOwnerUserId:\s*userId,/)
  })

  it('data writes status COMPLETED, currentStep COMPLETE, and completedAt in the same atomic write', () => {
    expect(updateManyCall).toMatch(/data:\s*\{\s*status:\s*'COMPLETED',\s*currentStep:\s*'COMPLETE',\s*completedAt:\s*new Date\(\)\s*\}/)
  })
})

describe('finish route — count === 0 re-read and strict idempotency classification', () => {
  it('re-fetches the onboarding row scoped by workspaceId after a count-0 result', () => {
    expect(routeSource).toMatch(/if \(result\.count === 1\)/)
    expect(routeSource).toMatch(/prisma\.workspaceOnboarding\.findUnique\(\{ where: \{ workspaceId \} \}\)/)
  })

  it('missing onboarding row after re-read returns 409', () => {
    expect(routeSource).toMatch(/if \(!onboarding\) \{\s*return NextResponse\.json\(\{ error: 'Onboarding not found' \}, \{ status: 409 \}\)/)
  })

  it('owner mismatch after re-read returns 403', () => {
    expect(routeSource).toMatch(/if \(onboarding\.onboardingOwnerUserId !== userId\) \{\s*return NextResponse\.json\(\{ error: 'Forbidden' \}, \{ status: 403 \}\)/)
  })

  it('idempotent retry success requires status COMPLETED AND currentStep COMPLETE AND completedAt non-null — all three, not any one alone', () => {
    expect(routeSource).toMatch(/onboarding\.status === 'COMPLETED' &&\s*onboarding\.currentStep === 'COMPLETE' &&\s*onboarding\.completedAt != null/)
  })

  it('any other post-re-read shape falls through to 409 conflict, never silent success', () => {
    expect(routeSource).toMatch(/return NextResponse\.json\(\{ error: 'Onboarding state conflict' \}, \{ status: 409 \}\)/)
  })

  it('a second completion write is never issued during retry classification (exactly one updateMany/update call)', () => {
    const updateCalls = routeSource.match(/prisma\.workspaceOnboarding\.(updateMany|update)\(/g) ?? []
    expect(updateCalls.length).toBe(1)
  })
})

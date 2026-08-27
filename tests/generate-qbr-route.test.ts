import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: they read app/api/generate-qbr/route.ts as plain
// text and regex-match against it. They do NOT execute the route against a
// real database, invoke the AI provider, or mutate Production — this repo
// has no DB integration-test framework (see tests/onboarding-advance-route.
// test.ts and tests/onboarding-enrollment-atomicity.test.ts for the same
// precedent). Client-capacity boundary scenarios (at-limit, over-limit after
// downgrade, presence of soft-deleted Clients) are expressed here as source
// assertions that no Client-capacity branch exists to reject the request —
// not as executed runtime/PostgreSQL scenarios.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const routeSource = readSourceLF('app/api/generate-qbr/route.ts')

describe('generate-qbr route — active target Client is still required', () => {
  it('resolves the target Client scoped by clientId, workspaceId, and deletedAt: null', () => {
    expect(routeSource).toMatch(/const client = await prisma\.client\.findFirst\(\{\s*where:\s*\{ id: data\.clientId, workspaceId: membership\.workspaceId, deletedAt: null \},/)
  })

  it('a missing/cross-workspace/deleted target Client still returns 404 Client not found', () => {
    expect(routeSource).toMatch(/if \(!client\) return NextResponse\.json\(\{ error: 'Client not found' \}, \{ status: 404 \}\)/)
  })
})

describe('generate-qbr route — never creates or counts Clients for capacity (PR2)', () => {
  it('contains no Client creation of any kind', () => {
    expect(routeSource).not.toMatch(/prisma\.client\.create/)
    expect(routeSource).not.toMatch(/tx\.client\.create/)
  })

  it('contains no Client-count query at all — the removed capacity check queried prisma.client.count', () => {
    expect(routeSource).not.toMatch(/prisma\.client\.count\(/)
    expect(routeSource).not.toMatch(/tx\.client\.count\(/)
  })

  it('contains no Client-capacity limit check: no limits.clients, no clientCount +/- offset, no LIMIT_REACHED/clients branch', () => {
    expect(routeSource).not.toMatch(/limits\.clients/)
    expect(routeSource).not.toMatch(/clientCount/)
    expect(routeSource).not.toMatch(/clientCount\s*-\s*1/)
    expect(routeSource).not.toMatch(/clientCount\s*\+\s*1/)
    expect(routeSource).not.toMatch(/limit:\s*'clients'/)
  })

  it('capacity-boundary scenarios (at Client limit, over limit after downgrade, workspace has soft-deleted Clients) cannot reject the request — there is no Client-capacity branch left to evaluate them against; this is a source-contract guarantee, not an executed PostgreSQL scenario', () => {
    expect(routeSource).not.toMatch(/isUnderLimit\([^)]*limits\.clients\)/)
  })
})

describe('generate-qbr route — legitimate QBR quota is preserved', () => {
  it('still checks isUnderLimit(qbrCount, limits.qbrsPerMonth)', () => {
    expect(routeSource).toMatch(/isUnderLimit\(qbrCount, limits\.qbrsPerMonth\)/)
  })

  it('a QBR-quota rejection still returns 403 LIMIT_REACHED with limit: \'qbrs\' and the existing plan/max shape', () => {
    expect(routeSource).toMatch(/if \(!isUnderLimit\(qbrCount, limits\.qbrsPerMonth\)\) \{\s*return NextResponse\.json\(\s*\{ error: 'LIMIT_REACHED', limit: 'qbrs', plan, max: limits\.qbrsPerMonth \},\s*\{ status: 403 \}\s*\)/)
  })
})

describe('generate-qbr route — plan/period logic remains intact', () => {
  it('still imports PLAN_LIMITS, shouldResetPeriod, and isUnderLimit from lib/limits', () => {
    expect(routeSource).toMatch(/const \{ PLAN_LIMITS, shouldResetPeriod, isUnderLimit \} = await import\('@\/lib\/limits'\)/)
  })

  it('still falls back to FREE when no Subscription plan is set', () => {
    expect(routeSource).toMatch(/membership\.subscription\?\.plan \?\? 'FREE'/)
  })

  it('still resets qbrCount/exportCount/periodStart via shouldResetPeriod before computing qbrCount', () => {
    const resetIdx = routeSource.indexOf('shouldResetPeriod(new Date(sub.periodStart))')
    const qbrCountIdx = routeSource.indexOf('const qbrCount = sub?.qbrCount ?? 0')
    expect(resetIdx).toBeGreaterThan(-1)
    expect(qbrCountIdx).toBeGreaterThan(-1)
    expect(resetIdx).toBeLessThan(qbrCountIdx)
  })
})

describe('generate-qbr route — authorization and QBR creation unchanged', () => {
  it('still authenticates via Clerk auth() and returns 401 when absent', () => {
    expect(routeSource).toMatch(/const \{ userId: clerkId \} = auth\(\)/)
    expect(routeSource).toMatch(/if \(!clerkId\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/)
  })

  it('still resolves membership via getWorkspaceMembership and checks can.generateQBR', () => {
    expect(routeSource).toMatch(/import \{ getWorkspaceMembership \} from '@\/lib\/workspace'/)
    expect(routeSource).toMatch(/if \(!can\.generateQBR\(membership\.role\)\)/)
  })

  it('creates a QBR (prisma.qBR.create), never a Client', () => {
    expect(routeSource).toMatch(/const qbr = await prisma\.qBR\.create\(\{/)
    expect(routeSource).not.toMatch(/prisma\.client\.create/)
  })
})

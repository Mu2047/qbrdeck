import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PLAN_LIMITS, isUnderLimit, getLimits, type PlanKey } from '@/lib/limits'

// Source-contract tests: they read app/api/clients/route.ts and
// lib/workspace-lock.ts as plain text and regex-match against them. They do
// NOT execute the route against a real database — this repo has no DB
// integration-test framework (same precedent as
// tests/onboarding-first-client-route.test.ts). These tests prove source
// ordering, query contracts, response contracts, and pure limit logic. They
// do NOT perform a real concurrent PostgreSQL execution — the concurrency
// claim rests on reusing the FOR UPDATE-in-$transaction pattern already
// established in lib/workspace.ts (getWorkspaceContext), not on a fresh
// stress test here.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const routeSource = readSourceLF('app/api/clients/route.ts')
const lockSource = readSourceLF('lib/workspace-lock.ts')

// Isolate just the POST handler (not GET, which has its own unrelated
// deletedAt: null query) so assertions below can't be accidentally
// satisfied by GET's source instead.
const postMatch = routeSource.match(/export async function POST\(req: NextRequest\) \{[\s\S]*?\n\}(?:\n|$)/)
const postSource = postMatch?.[0] ?? ''

// Isolate just the transaction callback body within POST.
const txMatch = postSource.match(/prisma\.\$transaction\(async \(tx\) => \{[\s\S]*?\n    \}\)/)
const txSource = txMatch?.[0] ?? ''

describe('workspace-lock helper — anchored to lib/workspace-lock.ts', () => {
  it('exists and is non-empty', () => {
    expect(postMatch).not.toBeNull()
    expect(txMatch).not.toBeNull()
    expect(lockSource.length).toBeGreaterThan(0)
  })

  it('operates on the Workspace table using FOR UPDATE', () => {
    expect(lockSource).toMatch(/FROM "Workspace"/)
    expect(lockSource).toMatch(/FOR UPDATE/)
  })

  it('is parameterized on workspaceId — no string concatenation into the query', () => {
    expect(lockSource).toMatch(/WHERE "id" = \$\{workspaceId\}/)
    expect(lockSource).not.toMatch(/\+\s*workspaceId/)
    expect(lockSource).not.toMatch(/`\s*\+/)
  })

  it('accepts a Prisma transaction client and a workspaceId parameter', () => {
    expect(lockSource).toMatch(/export async function lockWorkspaceRow\(\s*tx: Prisma\.TransactionClient,\s*workspaceId: string,/)
  })

  it('performs no other DB work and starts no transaction of its own', () => {
    expect(lockSource).not.toMatch(/\$transaction\(/)
    expect(lockSource.match(/tx\.\$queryRaw/g)?.length).toBe(1)
  })
})

describe('POST /api/clients — capacity enforcement happens inside prisma.$transaction', () => {
  it('the count/limit check is not reachable before prisma.$transaction( is opened', () => {
    const txIdx = postSource.indexOf('prisma.$transaction(')
    const countIdx = postSource.indexOf('tx.client.count(')
    expect(txIdx).toBeGreaterThan(-1)
    expect(countIdx).toBeGreaterThan(-1)
    expect(txIdx).toBeLessThan(countIdx)
  })

  it('does not perform any bare prisma.client.count or prisma.client.create outside the transaction client', () => {
    expect(postSource).not.toMatch(/(?<!tx\.)\bprisma\.client\.count\(/)
    expect(postSource).not.toMatch(/(?<!tx\.)\bprisma\.client\.create\(/)
  })
})

describe('POST /api/clients — exact logical order inside the transaction', () => {
  it('locks the Workspace row before reading the Subscription', () => {
    const lockIdx = txSource.indexOf('lockWorkspaceRow(tx, membership.workspaceId)')
    const subIdx  = txSource.indexOf('tx.subscription.findUnique(')
    expect(lockIdx).toBeGreaterThan(-1)
    expect(subIdx).toBeGreaterThan(-1)
    expect(lockIdx).toBeLessThan(subIdx)
  })

  it('reads the Subscription before computing limits via getLimits', () => {
    const subIdx  = txSource.indexOf('tx.subscription.findUnique(')
    const limIdx  = txSource.indexOf('getLimits(subscription?.plan')
    expect(subIdx).toBeGreaterThan(-1)
    expect(limIdx).toBeGreaterThan(-1)
    expect(subIdx).toBeLessThan(limIdx)
  })

  it('counts active Clients before evaluating isUnderLimit', () => {
    const countIdx = txSource.indexOf('tx.client.count(')
    const underIdx = txSource.indexOf('isUnderLimit(clientCount, limits.clients)')
    expect(countIdx).toBeGreaterThan(-1)
    expect(underIdx).toBeGreaterThan(-1)
    expect(countIdx).toBeLessThan(underIdx)
  })

  it('evaluates the limit decision before creating the Client', () => {
    const underIdx  = txSource.indexOf('isUnderLimit(clientCount, limits.clients)')
    const createIdx = txSource.indexOf('tx.client.create(')
    expect(underIdx).toBeGreaterThan(-1)
    expect(createIdx).toBeGreaterThan(-1)
    expect(underIdx).toBeLessThan(createIdx)
  })
})

describe('POST /api/clients — active Client count query', () => {
  it('the transaction Client count is scoped by workspaceId and deletedAt: null (not the unrelated GET query)', () => {
    expect(txSource).toMatch(/tx\.client\.count\(\{\s*where:\s*\{ workspaceId: membership\.workspaceId, deletedAt: null \},?\s*\}\)/)
  })
})

describe('POST /api/clients — no numeric offset on the limit comparison', () => {
  it('uses isUnderLimit(clientCount, limits.clients) with no offset', () => {
    expect(txSource).toMatch(/isUnderLimit\(clientCount, limits\.clients\)/)
  })

  it('never subtracts or adds 1 to clientCount for the Client-capacity check', () => {
    expect(txSource).not.toMatch(/clientCount\s*-\s*1/)
    expect(txSource).not.toMatch(/clientCount\s*\+\s*1/)
  })
})

describe('POST /api/clients — fresh Subscription read, FREE fallback, no upsert', () => {
  it('re-reads Subscription.plan under the lock rather than reusing pre-transaction membership.subscription', () => {
    expect(txSource).toMatch(/tx\.subscription\.findUnique\(\{\s*where:\s*\{ workspaceId: membership\.workspaceId \},/)
    expect(txSource).not.toMatch(/getLimits\(membership\.subscription/)
  })

  it('falls back to FREE when no Subscription row exists, without creating/upserting one', () => {
    expect(txSource).toMatch(/getLimits\(subscription\?\.plan \?\? 'FREE'\)/)
    expect(txSource).not.toMatch(/subscription\.(upsert|create)\(/)
  })
})

describe('POST /api/clients — response contracts', () => {
  it('returns exactly 403 { error: \'CLIENT_LIMIT_REACHED\' } on the limit branch', () => {
    expect(postSource).toMatch(/if \(result\.kind === 'limit_reached'\) \{\s*return NextResponse\.json\(\{ error: 'CLIENT_LIMIT_REACHED' \}, \{ status: 403 \}\)/)
  })

  it('does not add plan/max/limit/message fields to the limit-reached response', () => {
    const limitBranch = postSource.match(/if \(result\.kind === 'limit_reached'\) \{[\s\S]*?\n {4}\}/)?.[0] ?? ''
    expect(limitBranch).not.toMatch(/plan:/)
    expect(limitBranch).not.toMatch(/max:/)
    expect(limitBranch).not.toMatch(/limit:/)
    expect(limitBranch).not.toMatch(/message:/)
  })

  it('preserves the existing 201 success contract, returning the Client directly (not re-wrapped)', () => {
    expect(postSource).toMatch(/return NextResponse\.json\(result\.client, \{ status: 201 \}\)/)
  })
})

describe('POST /api/clients — authorization and validation still precede the transaction', () => {
  it('auth, membership resolution, role check, and schema validation all occur before prisma.$transaction(', () => {
    const txIdx = postSource.indexOf('prisma.$transaction(')
    expect(txIdx).toBeGreaterThan(-1)

    const authIdx     = postSource.indexOf('const { userId: clerkId } = auth()')
    const memberIdx    = postSource.indexOf('getWorkspaceMembership(clerkId)')
    const roleIdx      = postSource.indexOf('can.createClient(membership.role)')
    const validateIdx  = postSource.indexOf('createSchema.parse(body)')

    for (const idx of [authIdx, memberIdx, roleIdx, validateIdx]) {
      expect(idx).toBeGreaterThan(-1)
      expect(idx).toBeLessThan(txIdx)
    }
  })

  it('still returns 401/404/403 for the existing auth/membership/role failures, unchanged', () => {
    expect(postSource).toMatch(/if \(!clerkId\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/)
    expect(postSource).toMatch(/if \(!membership\) return NextResponse\.json\(\{ error: 'Workspace not found' \}, \{ status: 404 \}\)/)
    expect(postSource).toMatch(/if \(!can\.createClient\(membership\.role\)\)\s*\n\s*return NextResponse\.json\(\{ error: 'Forbidden' \}, \{ status: 403 \}\)/)
  })
})

// ── Pure logic — canonical plan limits and isUnderLimit semantics ───────────
// Supplemental to the source-contract tests above; imports the real
// lib/limits.ts implementation, never a copy of the values.

describe('canonical Client limits (lib/limits.ts) used by this route', () => {
  it('FREE=2, SOLO=10, GROWTH=50, AGENCY=null (unlimited)', () => {
    expect(PLAN_LIMITS.FREE.clients).toBe(2)
    expect(PLAN_LIMITS.SOLO.clients).toBe(10)
    expect(PLAN_LIMITS.GROWTH.clients).toBe(50)
    expect(PLAN_LIMITS.AGENCY.clients).toBeNull()
  })

  it('getLimits falls back to FREE for an unrecognized plan value', () => {
    expect(getLimits('NOT_A_REAL_PLAN').clients).toBe(PLAN_LIMITS.FREE.clients)
  })
})

describe('isUnderLimit — Client-capacity comparison, per plan', () => {
  const cases: Array<{ plan: PlanKey; count: number; expected: boolean }> = [
    { plan: 'FREE',   count: 0,  expected: true },
    { plan: 'FREE',   count: 1,  expected: true },
    { plan: 'FREE',   count: 2,  expected: false },
    { plan: 'SOLO',   count: 9,  expected: true },
    { plan: 'SOLO',   count: 10, expected: false },
    { plan: 'GROWTH', count: 49, expected: true },
    { plan: 'GROWTH', count: 50, expected: false },
    { plan: 'AGENCY', count: 1_000_000, expected: true },
  ]

  for (const { plan, count, expected } of cases) {
    it(`${plan} at count=${count} → ${expected ? 'allow' : 'reject'}`, () => {
      expect(isUnderLimit(count, PLAN_LIMITS[plan].clients)).toBe(expected)
    })
  }
})

// ── Explicit test-scope limitation ───────────────────────────────────────────
// These tests prove source ordering, query contracts, response contracts,
// and pure limit logic against the real lib/limits.ts implementation. They
// do NOT spin up PostgreSQL, do NOT open real Prisma transactions, and do
// NOT dispatch two simultaneous requests against a live database. The
// concurrency-safety claim for this PR is that it reuses the identical
// FOR UPDATE-inside-prisma.$transaction pattern already relied upon by
// lib/workspace.ts (getWorkspaceContext) for a previously-fixed Production
// race — not a fresh empirical proof performed by this file.

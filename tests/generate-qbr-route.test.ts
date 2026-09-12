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
    expect(routeSource).toMatch(/if \(reserveResult\.kind === 'limit_reached'\) \{\s*return NextResponse\.json\(\s*\{ error: 'LIMIT_REACHED', limit: 'qbrs', plan: reserveResult\.plan, max: reserveResult\.max \},\s*\{ status: 403 \}\s*\)/)
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
    const resetIdx = routeSource.indexOf('shouldResetPeriod(new Date(freshSub.periodStart))')
    const qbrCountIdx = routeSource.indexOf('const qbrCount         = periodNeedsReset ? 0 : (freshSub?.qbrCount ?? 0)')
    expect(resetIdx).toBeGreaterThan(-1)
    expect(qbrCountIdx).toBeGreaterThan(-1)
    expect(resetIdx).toBeLessThan(qbrCountIdx)
  })
})

describe('generate-qbr route — quota reservation is atomic and precedes the Anthropic call (D4B)', () => {
  it('locks the Workspace row before re-reading the Subscription, inside prisma.$transaction', () => {
    const txMatch = routeSource.match(/prisma\.\$transaction\(async \(tx\) => \{[\s\S]*?\n {4}\}\)/)
    expect(txMatch).not.toBeNull()
    const txBody = txMatch?.[0] ?? ''
    const lockIdx = txBody.indexOf('lockWorkspaceRow(tx, membership.workspaceId)')
    const subIdx  = txBody.indexOf('tx.subscription.findUnique(')
    expect(lockIdx).toBeGreaterThan(-1)
    expect(subIdx).toBeGreaterThan(-1)
    expect(lockIdx).toBeLessThan(subIdx)
  })

  it('imports lockWorkspaceRow from lib/workspace-lock', () => {
    expect(routeSource).toMatch(/import \{ lockWorkspaceRow \} from '@\/lib\/workspace-lock'/)
  })

  it('the quota transaction resolves and commits before generateQBRSlides is ever called', () => {
    const txIdx = routeSource.indexOf('const reserveResult = await prisma.$transaction(')
    const aiIdx = routeSource.indexOf('generateQBRSlides(')
    expect(txIdx).toBeGreaterThan(-1)
    expect(aiIdx).toBeGreaterThan(-1)
    expect(txIdx).toBeLessThan(aiIdx)
  })

  it('no reservation transaction remains open across the Anthropic call — POST contains exactly one prisma.$transaction( call (the reservation), and it closes before generateQBRSlides is reached', () => {
    const postMatch = routeSource.match(/export async function POST\(req: NextRequest\) \{[\s\S]*?\n\}(?:\n|$)/)
    const postSource = postMatch?.[0] ?? ''
    const txCount = (postSource.match(/prisma\.\$transaction\(/g) ?? []).length
    expect(txCount).toBe(1)
  })

  it('reserves (increments) the quota unit inside the transaction, not after AI/QBR creation', () => {
    const txMatch = routeSource.match(/const reserveResult = await prisma\.\$transaction\(async \(tx\) => \{[\s\S]*?\n {4}\}\)/)
    const txBody = txMatch?.[0] ?? ''
    expect(txBody).toMatch(/qbrCount: \{ increment: 1 \}/)
    expect(txBody).toMatch(/tx\.subscription\.create\(/)
  })

  it('no bare (unlocked) prisma.subscription.update/create for qbrCount exists outside the tx client', () => {
    expect(routeSource).not.toMatch(/prisma\.subscription\.update\(/)
    expect(routeSource).not.toMatch(/prisma\.subscription\.create\(/)
  })
})

describe('generate-qbr route — failed generation compensates the reservation, never leaves a permanent charge (D4B)', () => {
  it('the catch block compensates the reservation only when one was actually made', () => {
    const catchMatch = routeSource.match(/\} catch \(err: any\) \{[\s\S]*?\n  \}\n\}/)
    const catchBody = catchMatch?.[0] ?? ''
    expect(catchBody).toMatch(/if \(reservation\) \{\s*await compensateQbrReservation\(reservation\.workspaceId, reservation\.periodStart\)\s*\}/)
  })

  it('compensateQbrReservation re-locks the same Workspace row and only decrements — never creates or increments', () => {
    const fnMatch = routeSource.match(/async function compensateQbrReservation\([\s\S]*?\n\}\n?$/)
    expect(fnMatch).not.toBeNull()
    const body = fnMatch?.[0] ?? ''
    expect(body).toMatch(/lockWorkspaceRow\(tx, workspaceId\)/)
    expect(body).toMatch(/qbrCount: \{ decrement: 1 \}/)
    expect(body).not.toMatch(/increment/)
    expect(body).not.toMatch(/\.create\(/)
  })

  it('compensation never decrements below zero and never crosses into a different (already-reset) billing period', () => {
    const fnMatch = routeSource.match(/async function compensateQbrReservation\([\s\S]*?\n\}\n?$/)
    const body = fnMatch?.[0] ?? ''
    expect(body).toMatch(/if \(sub\.qbrCount <= 0\) return/)
    expect(body).toMatch(/if \(sub\.periodStart\.getTime\(\) !== reservedPeriodStart\.getTime\(\)\) return/)
  })

  it('a compensation failure is swallowed (logged, not rethrown) so it never masks the original generation failure response', () => {
    const fnMatch = routeSource.match(/async function compensateQbrReservation\([\s\S]*?\n\}\n?$/)
    const body = fnMatch?.[0] ?? ''
    expect(body).toMatch(/catch \(compErr\) \{\s*console\.error\('\[generate-qbr\] Quota compensation failed', compErr\)\s*\}/)
  })

  it('reservation is declared outside the try block so the catch handler can see it', () => {
    const declIdx = routeSource.indexOf('let reservation: { workspaceId: string; periodStart: Date } | null = null')
    const tryIdx  = routeSource.indexOf('try {')
    expect(declIdx).toBeGreaterThan(-1)
    expect(tryIdx).toBeGreaterThan(-1)
    expect(declIdx).toBeLessThan(tryIdx)
  })
})

describe('generate-qbr route — input-bound safeguard on the three AI prompt free-text fields (D4B)', () => {
  it('ticketCategories, wins, and upsellOpportunities are each bounded to MAX_FREE_TEXT_LENGTH (2000) and remain optional', () => {
    expect(routeSource).toMatch(/const MAX_FREE_TEXT_LENGTH = 2000/)
    expect(routeSource).toMatch(/ticketCategories:\s*z\.string\(\)\.max\(MAX_FREE_TEXT_LENGTH\)\.optional\(\)/)
    expect(routeSource).toMatch(/wins:\s*z\.string\(\)\.max\(MAX_FREE_TEXT_LENGTH\)\.optional\(\)/)
    expect(routeSource).toMatch(/upsellOpportunities:\s*z\.string\(\)\.max\(MAX_FREE_TEXT_LENGTH\)\.optional\(\)/)
  })

  it('oversized input is rejected by schema.safeParse — before the Client lookup, quota reservation, or any Anthropic call', () => {
    const parseIdx = routeSource.indexOf('const parsed = schema.safeParse(body)')
    const clientIdx = routeSource.indexOf('const client = await prisma.client.findFirst(')
    const txIdx = routeSource.indexOf('const reserveResult = await prisma.$transaction(')
    const aiIdx = routeSource.indexOf('generateQBRSlides(')
    expect(parseIdx).toBeGreaterThan(-1)
    expect(parseIdx).toBeLessThan(clientIdx)
    expect(parseIdx).toBeLessThan(txIdx)
    expect(parseIdx).toBeLessThan(aiIdx)
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

describe('generate-qbr route — error hygiene: malformed JSON never reaches the generic 500', () => {
  it('req.json() is wrapped in try/catch, returning 400 Invalid request body on parse failure', () => {
    expect(routeSource).toMatch(/let body: unknown\s*try \{\s*body = await req\.json\(\)\s*\} catch \{\s*return NextResponse\.json\(\{ error: 'Invalid request body' \}, \{ status: 400 \}\)\s*\}/)
  })
})

describe('generate-qbr route — error hygiene: schema validation never reaches the generic 500', () => {
  it('uses schema.safeParse(body), never the throwing schema.parse(body)', () => {
    expect(routeSource).toMatch(/const parsed = schema\.safeParse\(body\)/)
    expect(routeSource).not.toMatch(/schema\.parse\(body\)/)
  })

  it('a failed parse returns 400 Invalid request body, and data is read from parsed.data', () => {
    expect(routeSource).toMatch(/if \(!parsed\.success\) \{\s*return NextResponse\.json\(\{ error: 'Invalid request body' \}, \{ status: 400 \}\)\s*\}/)
    expect(routeSource).toMatch(/const data = parsed\.data/)
  })
})

describe('generate-qbr route — error hygiene: unexpected failures return a stable sanitized 500', () => {
  const catchMatch = routeSource.match(/\} catch \(err: any\) \{[\s\S]*?\n  \}\n\}/)
  const catchBody = catchMatch?.[0] ?? ''

  it('locates the outer catch block', () => {
    expect(catchMatch).not.toBeNull()
  })

  it('still logs server-side via console.error(\'[generate-qbr]\', err)', () => {
    expect(catchBody).toMatch(/console\.error\('\[generate-qbr\]', err\)/)
  })

  it('returns exactly { error: \'Failed to generate QBR\' } at 500, never derived from err.message/err.error', () => {
    expect(catchBody).toMatch(/return NextResponse\.json\(\{ error: 'Failed to generate QBR' \}, \{ status: 500 \}\)/)
    expect(catchBody).not.toMatch(/err\.message/)
    expect(catchBody).not.toMatch(/err\.error/)
  })
})

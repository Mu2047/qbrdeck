import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: they read app/api/onboarding/export/route.ts as
// plain text and regex-match against it. They do NOT execute the route
// against a real database — this repo has no DB integration-test framework
// (see tests/onboarding-first-client-route.test.ts for the same precedent).

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const routeSource = readSourceLF('app/api/onboarding/export/route.ts')

describe('onboarding export route — authentication and membership resolution', () => {
  it('authenticates via Clerk auth() and returns 401 when absent', () => {
    expect(routeSource).toMatch(/const \{ userId: clerkId \} = auth\(\)/)
    expect(routeSource).toMatch(/if \(!clerkId\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/)
  })

  it('resolves identity via getWorkspaceMembership, and preserves the real can.exportQBR role gate', () => {
    expect(routeSource).toMatch(/import \{ getWorkspaceMembership \} from '@\/lib\/workspace'/)
    expect(routeSource).toMatch(/import \{ can \} from '@\/lib\/permissions'/)
    expect(routeSource).toMatch(/if \(!can\.exportQBR\(membership\.role\)\)/)
  })
})

describe('onboarding export route — request body carries no qbrId/clientId/workspaceId/userId authority', () => {
  it('the zod schema defines exactly one field: format', () => {
    expect(routeSource).toMatch(/const bodySchema = z\.object\(\{\s*format: z\.enum\(\['pdf', 'pptx'\]\),\s*\}\)\.strict\(\)/)
  })

  it('never reads qbrId, clientId, workspaceId, userId, or ownerId from the parsed body', () => {
    expect(routeSource).not.toMatch(/parsed\.data\.qbrId/)
    expect(routeSource).not.toMatch(/body\.qbrId/)
    expect(routeSource).not.toMatch(/parsed\.data\.clientId/)
    expect(routeSource).not.toMatch(/parsed\.data\.workspaceId/)
    expect(routeSource).not.toMatch(/parsed\.data\.userId/)
    expect(routeSource).not.toMatch(/parsed\.data\.ownerId/)
  })
})

describe('onboarding export route — exact onboarding-state gate before resolving the anchor', () => {
  it('requires owner identity match before the state guard', () => {
    const ownerIdx = routeSource.indexOf('onboarding.onboardingOwnerUserId !== userId')
    const stateGuardIdx = routeSource.indexOf('onboarding.status !== ')
    expect(ownerIdx).toBeGreaterThan(-1)
    expect(stateGuardIdx).toBeGreaterThan(-1)
    expect(ownerIdx).toBeLessThan(stateGuardIdx)
  })

  it('requires exactly status IN_PROGRESS, currentStep EXPORT_QBR, and both anchors present', () => {
    expect(routeSource).toMatch(/onboarding\.status !== 'IN_PROGRESS' \|\|\s*onboarding\.currentStep !== 'EXPORT_QBR' \|\|\s*onboarding\.onboardingClientId == null \|\|\s*onboarding\.onboardingQbrId == null/)
  })
})

describe('onboarding export route — anchored QBR is server-resolved, never a browser-supplied qbrId', () => {
  it('resolves the QBR by onboarding.onboardingQbrId, scoped to workspaceId, clientId, and deletedAt: null', () => {
    expect(routeSource).toMatch(/const anchoredQbr = await prisma\.qBR\.findFirst\(\{\s*where:\s*\{\s*id:\s*onboarding\.onboardingQbrId,\s*workspaceId,\s*clientId:\s*onboarding\.onboardingClientId,\s*deletedAt:\s*null,/)
  })

  it('a missing anchored QBR returns 409 Onboarding state conflict, not a 404 leaking existence elsewhere', () => {
    expect(routeSource).toMatch(/if \(!anchoredQbr\) \{\s*return NextResponse\.json\(\{ error: 'Onboarding state conflict' \}, \{ status: 409 \}\)/)
  })

  it('the export call itself uses anchoredQbr.id, not any request-supplied value', () => {
    expect(routeSource).toMatch(/performQbrExport\(membership, anchoredQbr\.id, format\)/)
  })
})

describe('onboarding export route — reuses the exact existing export business logic, no duplicated generation code', () => {
  it('imports performQbrExport from the shared lib/qbr-export helper', () => {
    expect(routeSource).toMatch(/import \{ performQbrExport, ExportQbrNotFoundError, ExportNoSlidesError, ExportLimitError \} from '@\/lib\/qbr-export'/)
  })

  it('never re-implements generatePDF/generatePPTX/ExportEvent/exportCount logic inline', () => {
    expect(routeSource).not.toMatch(/generatePDF/)
    expect(routeSource).not.toMatch(/generatePPTX/)
    expect(routeSource).not.toMatch(/exportEvent\.create/)
    expect(routeSource).not.toMatch(/exportCount:\s*\{\s*increment/)
  })

  it('a quota/limit failure never blocks with a hard error — it is classified as LIMIT_REACHED at 403, same shape as the generic export routes', () => {
    expect(routeSource).toMatch(/if \(err instanceof ExportLimitError\) \{\s*return NextResponse\.json\(\s*\{ error: 'LIMIT_REACHED', limit: 'exports', plan: err\.plan, max: err\.max \},\s*\{ status: 403 \}\s*\)/)
  })
})

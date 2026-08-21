import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: they read app/onboarding/[step]/page.tsx as plain
// text and regex-match against it (and assert relative ordering of the
// matched positions), following the same precedent as
// tests/onboarding-selfheal.test.ts and tests/onboarding-enrollment-atomicity.test.ts.
// This repo has no DB integration-test framework and Next.js server
// components with redirect()/notFound() cannot be unit-executed directly.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const pageSource = readSourceLF('app/onboarding/[step]/page.tsx')

function indexOfOrFail(haystack: string, needle: string | RegExp): number {
  const idx = typeof needle === 'string' ? haystack.indexOf(needle) : haystack.search(needle)
  expect(idx).toBeGreaterThan(-1)
  return idx
}

describe('onboarding [step] page — authentication happens first, before anything else', () => {
  it('calls auth() and redirects to /sign-in before any other resolution', () => {
    const authIdx = indexOfOrFail(pageSource, /const \{ userId: clerkId \} = auth\(\)/)
    const signInIdx = indexOfOrFail(pageSource, "redirect('/sign-in')")
    const ctxIdx = indexOfOrFail(pageSource, 'await getWorkspaceContext()')
    expect(authIdx).toBeLessThan(signInIdx)
    expect(signInIdx).toBeLessThan(ctxIdx)
  })
})

describe('onboarding [step] page — workspace context resolution', () => {
  it('uses getWorkspaceContext (lazy-creation is intentional here), and redirects to /sign-in if null', () => {
    expect(pageSource).toMatch(/const ctx = await getWorkspaceContext\(\)/)
    expect(pageSource).toMatch(/if \(!ctx\) redirect\('\/sign-in'\)/)
  })
})

describe('onboarding [step] page — eligibility is re-checked via shouldInterceptOnboarding, never TeamRole', () => {
  it('calls shouldInterceptOnboarding with the onboarding row and the internal member userId', () => {
    expect(pageSource).toMatch(/shouldInterceptOnboarding\(ctx\.onboarding, ctx\.member\.userId\)/)
  })

  it('redirects to /dashboard when shouldInterceptOnboarding returns false', () => {
    expect(pageSource).toMatch(/if \(!shouldInterceptOnboarding\(ctx\.onboarding, ctx\.member\.userId\)\) \{\s*redirect\('\/dashboard'\)/)
  })

  it('never reads ctx.member.role or imports TeamRole to determine eligibility (a comment documenting the omission is fine)', () => {
    expect(pageSource).not.toMatch(/ctx\.member\.role/)
    expect(pageSource).not.toMatch(/import[^\n]*TeamRole/)
    expect(pageSource).not.toMatch(/:\s*TeamRole\b/)
  })

  it('the eligibility check happens before the persisted-step and slug checks', () => {
    const eligibilityIdx = indexOfOrFail(pageSource, 'shouldInterceptOnboarding(ctx.onboarding, ctx.member.userId)')
    const implementedIdx = indexOfOrFail(pageSource, 'isStepImplemented(currentStep)')
    const slugIdx = indexOfOrFail(pageSource, 'slugToStep(params.step)')
    expect(eligibilityIdx).toBeLessThan(implementedIdx)
    expect(implementedIdx).toBeLessThan(slugIdx)
  })
})

describe('onboarding [step] page — persisted-but-unimplemented currentStep fails open to /dashboard', () => {
  it('checks isStepImplemented(currentStep) and redirects to /dashboard when false', () => {
    expect(pageSource).toMatch(/if \(!isStepImplemented\(currentStep\)\) \{\s*redirect\('\/dashboard'\)/)
  })
})

describe('onboarding [step] page — slug validation only after eligibility/state checks', () => {
  it('invalid slug (slugToStep returns undefined) invokes notFound()', () => {
    expect(pageSource).toMatch(/const requestedStep = slugToStep\(params\.step\)/)
    expect(pageSource).toMatch(/if \(!requestedStep\) \{\s*notFound\(\)/)
  })

  it('a valid slug that disagrees with the persisted currentStep redirects to the persisted step, not the requested one', () => {
    expect(pageSource).toMatch(/if \(requestedStep !== currentStep\) \{\s*redirect\(`\/onboarding\/\$\{stepToSlug\(currentStep\)\}`\)/)
  })
})

describe('onboarding [step] page — renders only for the exact matching, implemented, eligible step', () => {
  it('renders WelcomeScreen for WELCOME and WorkspaceNameScreen for WORKSPACE_NAME, prefilled from ctx.workspace.name', () => {
    expect(pageSource).toMatch(/if \(currentStep === 'WELCOME'\) return <WelcomeScreen \/>/)
    expect(pageSource).toMatch(/if \(currentStep === 'WORKSPACE_NAME'\) return <WorkspaceNameScreen initialName=\{ctx\.workspace\.name\} \/>/)
  })

  it('renders FirstClientScreen for FIRST_CLIENT with read-only, workspace-scoped Prisma lookups only', () => {
    expect(pageSource).toMatch(/if \(currentStep === 'FIRST_CLIENT'\) \{/)
    expect(pageSource).toMatch(/<FirstClientScreen/)
    expect(pageSource).toMatch(/prisma\.workspaceOnboarding\.findUnique\(\{\s*where:\s*\{ workspaceId: ctx\.workspaceId \},\s*select:\s*\{ clientStepIdempotencyKey: true \},/)
    expect(pageSource).toMatch(/prisma\.client\.findMany\(\{\s*where:\s*\{ workspaceId: ctx\.workspaceId, deletedAt: null \},/)
  })

  it('renders FirstQbrScreen for FIRST_QBR with a read-only, workspace-scoped Prisma lookup only', () => {
    expect(pageSource).toMatch(/if \(currentStep === 'FIRST_QBR'\) \{/)
    expect(pageSource).toMatch(/<FirstQbrScreen persistedKey=\{onboardingRow\?\.qbrStepIdempotencyKey \?\? null\} \/>/)
    expect(pageSource).toMatch(/prisma\.workspaceOnboarding\.findUnique\(\{\s*where:\s*\{ workspaceId: ctx\.workspaceId \},\s*select:\s*\{ qbrStepIdempotencyKey: true \},/)
  })

  it('never performs a write (create/update/upsert/delete) anywhere in this render-only page', () => {
    expect(pageSource).not.toMatch(/prisma\.\w+\.(create|update|upsert|delete|updateMany|deleteMany)\(/)
  })
})

describe('onboarding [step] page — REVIEW_QBR renders the exact anchored QBR, never a browser-supplied id', () => {
  it('resolves onboardingClientId/onboardingQbrId from a workspace-scoped lookup, never from params or request data', () => {
    const reviewBlockMatch = pageSource.match(/if \(currentStep === 'REVIEW_QBR'\) \{[\s\S]*?\n  \}/)
    expect(reviewBlockMatch).not.toBeNull()
    const block = reviewBlockMatch?.[0] ?? ''
    expect(block).toMatch(/prisma\.workspaceOnboarding\.findUnique\(\{\s*where:\s*\{ workspaceId: ctx\.workspaceId \},\s*select:\s*\{ onboardingClientId: true, onboardingQbrId: true \},/)
  })

  it('fails open to /dashboard when the anchor is missing/malformed, before ever querying the QBR', () => {
    const reviewBlockMatch = pageSource.match(/if \(currentStep === 'REVIEW_QBR'\) \{[\s\S]*?\n  \}/)
    const block = reviewBlockMatch?.[0] ?? ''
    const guardIdx = block.indexOf("redirect('/dashboard')")
    const qbrLookupIdx = block.indexOf('prisma.qBR.findFirst(')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(qbrLookupIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(qbrLookupIdx)
  })

  it('the anchored QBR lookup is scoped by id, workspaceId, and clientId together, with deletedAt: null', () => {
    expect(pageSource).toMatch(/const anchoredQbr = await prisma\.qBR\.findFirst\(\{\s*where:\s*\{\s*id:\s*onboardingRow\.onboardingQbrId,\s*workspaceId:\s*ctx\.workspaceId,\s*clientId:\s*onboardingRow\.onboardingClientId,\s*deletedAt:\s*null,/)
  })

  it('a missing anchored QBR (id/workspace/client mismatch) fails open to /dashboard, never renders a broken screen', () => {
    expect(pageSource).toMatch(/if \(!anchoredQbr\) redirect\('\/dashboard'\)/)
  })

  it('renders ReviewQbrScreen with only display data — no edit/dashboard-editor link is ever passed or imported here', () => {
    expect(pageSource).toMatch(/<ReviewQbrScreen/)
    expect(pageSource).not.toMatch(/qbr\/\$\{anchoredQbr\.id\}/)
  })

  // Hotfix regression: Screen 5 originally rendered anchoredQbr.slides and
  // anchoredQbr.summary raw, leaking literal {{healthScore}}/{{healthStatus}}
  // tokens into Production — those fields are persisted unresolved by design
  // (see app/api/onboarding/qbr/route.ts), and every other QBR renderer
  // (dashboard GET /api/qbrs/[qbrId], the portal, lib/qbr-export.ts) already
  // resolves+sanitizes before display. This block proves Screen 5 now follows
  // the identical established boundary.
  it('resolves the anchored QBR through the same resolve-then-sanitize boundary used elsewhere, in order', () => {
    const reviewBlockMatch = pageSource.match(/if \(currentStep === 'REVIEW_QBR'\) \{[\s\S]*?\n  \}/)
    expect(reviewBlockMatch).not.toBeNull()
    const block = reviewBlockMatch?.[0] ?? ''

    const anchorCheckIdx  = block.indexOf('if (!anchoredQbr) redirect')
    const brandingIdx     = block.indexOf('resolveBranding(')
    const placeholderIdx  = block.indexOf('buildPlaceholderContext(')
    const resolveIdx      = block.indexOf('resolveSlides(')
    const sanitizeIdx     = block.indexOf('sanitizeResolvedSlides(')
    const jsxIdx          = block.indexOf('<ReviewQbrScreen')

    expect(anchorCheckIdx).toBeGreaterThan(-1)
    expect(brandingIdx).toBeGreaterThan(-1)
    expect(placeholderIdx).toBeGreaterThan(-1)
    expect(resolveIdx).toBeGreaterThan(-1)
    expect(sanitizeIdx).toBeGreaterThan(-1)
    expect(jsxIdx).toBeGreaterThan(-1)

    // Exact required order: anchor verified → branding → placeholder context
    // → resolveSlides → sanitizeResolvedSlides → render.
    expect(anchorCheckIdx).toBeLessThan(brandingIdx)
    expect(brandingIdx).toBeLessThan(placeholderIdx)
    expect(placeholderIdx).toBeLessThan(resolveIdx)
    expect(resolveIdx).toBeLessThan(sanitizeIdx)
    expect(sanitizeIdx).toBeLessThan(jsxIdx)
  })

  it('resolveSlides is called against anchoredQbr.slides (raw), never against an already-sanitized or empty stand-in', () => {
    expect(pageSource).toMatch(/const resolvedSlides = resolveSlides\(\s*\(anchoredQbr\.slides as Array<Record<string, unknown>>\) \?\? \[\],\s*placeholderCtx\s*\)/)
  })

  it('passes only the sanitized resolved slides to ReviewQbrScreen — never anchoredQbr.slides or anchoredQbr.summary directly', () => {
    const reviewJsxMatch = pageSource.match(/<ReviewQbrScreen[\s\S]*?\/>/)
    expect(reviewJsxMatch).not.toBeNull()
    const jsx = reviewJsxMatch?.[0] ?? ''
    expect(jsx).toMatch(/slides=\{safeResolvedSlides\}/)
    expect(jsx).not.toMatch(/anchoredQbr\.slides/)
    expect(jsx).not.toMatch(/anchoredQbr\.summary/)
    expect(jsx).not.toMatch(/\bsummary=/)
  })

  it('anchoredQbr.slides/anchoredQbr.summary are never referenced anywhere in the JSX returned for this branch', () => {
    const reviewBlockMatch = pageSource.match(/if \(currentStep === 'REVIEW_QBR'\) \{[\s\S]*?\n  \}/)
    const block = reviewBlockMatch?.[0] ?? ''
    const returnMatch = block.match(/return \(\s*<ReviewQbrScreen[\s\S]*?\/>\s*\)/)
    expect(returnMatch).not.toBeNull()
    const returnBlock = returnMatch?.[0] ?? ''
    expect(returnBlock).not.toMatch(/anchoredQbr\.slides/)
    expect(returnBlock).not.toMatch(/anchoredQbr\.summary/)
  })
})

describe('onboarding [step] page — EXPORT_QBR and SHARE_QBR only presence-check the anchor, resolving nothing client-facing', () => {
  it('EXPORT_QBR fails open to /dashboard on a missing/malformed anchor before rendering ExportQbrScreen', () => {
    const exportBlockMatch = pageSource.match(/if \(currentStep === 'EXPORT_QBR'\) \{[\s\S]*?\n  \}/)
    expect(exportBlockMatch).not.toBeNull()
    const block = exportBlockMatch?.[0] ?? ''
    expect(block).toMatch(/redirect\('\/dashboard'\)/)
    expect(block).toMatch(/<ExportQbrScreen \/>/)
  })

  it('SHARE_QBR resolves only the anchored Client contactEmail as a convenience prefill, never a qbrId', () => {
    const shareBlockMatch = pageSource.match(/if \(currentStep === 'SHARE_QBR'\) \{[\s\S]*?\n  \}/)
    expect(shareBlockMatch).not.toBeNull()
    const block = shareBlockMatch?.[0] ?? ''
    expect(block).toMatch(/redirect\('\/dashboard'\)/)
    expect(block).toMatch(/prisma\.client\.findFirst\(\{\s*where:\s*\{ id: onboardingRow\.onboardingClientId, workspaceId: ctx\.workspaceId, deletedAt: null \},\s*select:\s*\{ contactEmail: true \},/)
    expect(block).toMatch(/<ShareQbrScreen prefillEmail=\{anchoredClient\?\.contactEmail \|\| null\} \/>/)
  })
})

describe('onboarding [step] page — COMPLETE derives invite capacity from actual seat occupancy, never plan type alone', () => {
  it('uses canInviteMoreMembers(plan, memberCount), not canInviteTeam(plan)', () => {
    const completeBlockMatch = pageSource.match(/if \(currentStep === 'COMPLETE'\) \{[\s\S]*?\n  \}/)
    expect(completeBlockMatch).not.toBeNull()
    const block = completeBlockMatch?.[0] ?? ''
    expect(block).toMatch(/canInviteMoreMembers\(plan, memberCount\)/)
    expect(block).not.toMatch(/canInviteTeam\(/)
  })

  it('memberCount comes from a live prisma.workspaceMember.count, not a cached/derived value', () => {
    expect(pageSource).toMatch(/const memberCount = await prisma\.workspaceMember\.count\(\{\s*where:\s*\{ workspaceId: ctx\.workspaceId \},/)
  })

  it('never writes status: COMPLETED or a completedAt timestamp on this page — only Finish (a separate API route) may do that', () => {
    expect(pageSource).not.toMatch(/status:\s*'COMPLETED'/)
    expect(pageSource).not.toMatch(/completedAt:\s*new Date/)
  })
})

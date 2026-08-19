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
})

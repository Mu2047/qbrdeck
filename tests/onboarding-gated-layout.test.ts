import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: they read app/(app)/dashboard/(gated)/layout.tsx as
// plain text and regex-match against it. They do NOT execute the layout
// against a real database — this repo has no DB integration-test framework
// (see tests/onboarding-route-authorization.test.ts for the same precedent
// applied to app/onboarding/[step]/page.tsx).

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

function indexOfOrFail(haystack: string, needle: string | RegExp): number {
  const idx = typeof needle === 'string' ? haystack.indexOf(needle) : haystack.search(needle)
  expect(idx).toBeGreaterThan(-1)
  return idx
}

const layoutSource = readSourceLF('app/(app)/dashboard/(gated)/layout.tsx')

describe('gated dashboard layout — kill switch is checked first, before any DB/context work', () => {
  it('checks process.env.ONBOARDING_GATE_ENABLED !== \'true\' and returns children immediately when disabled', () => {
    expect(layoutSource).toMatch(/if \(process\.env\.ONBOARDING_GATE_ENABLED !== 'true'\) \{\s*return <>\{children\}<\/>\s*\}/)
  })

  it('the disabled-gate check is the first statement in the function body — nothing else precedes it', () => {
    const fnIdx = indexOfOrFail(layoutSource, 'export default async function GatedDashboardLayout')
    const disabledIdx = indexOfOrFail(layoutSource, "if (process.env.ONBOARDING_GATE_ENABLED !== 'true')")
    const between = layoutSource.slice(fnIdx, disabledIdx)
    // Only the function signature/opening brace may appear between the
    // function declaration and the kill-switch check — no const/await/call.
    expect(between).not.toMatch(/const |await |getWorkspaceContext/)
  })

  it('the disabled branch returns before getWorkspaceContext is ever called', () => {
    const disabledIdx = indexOfOrFail(layoutSource, "if (process.env.ONBOARDING_GATE_ENABLED !== 'true')")
    const ctxIdx = indexOfOrFail(layoutSource, 'await getWorkspaceContext()')
    expect(disabledIdx).toBeLessThan(ctxIdx)
  })

  it('exact opt-in semantics: only the literal string \'true\' enables the gate — everything else (undefined, empty, \'false\', \'TRUE\', \'1\') disables it', () => {
    // A strict !== 'true' comparison is exactly this semantics: only the
    // literal 'true' fails the check and falls through to the real gate.
    expect(layoutSource).not.toMatch(/ONBOARDING_GATE_ENABLED\s*===\s*'false'/)
    expect(layoutSource).not.toMatch(/ONBOARDING_GATE_ENABLED\s*==\s*/)
    expect(layoutSource).toMatch(/ONBOARDING_GATE_ENABLED !== 'true'/)
  })
})

describe('gated dashboard layout — enabled path uses the real, unchanged onboarding helpers', () => {
  it('imports getWorkspaceContext, shouldInterceptOnboarding, and stepToSlug — no new decision logic invented here', () => {
    expect(layoutSource).toMatch(/import \{ getWorkspaceContext \} from '@\/lib\/workspace'/)
    expect(layoutSource).toMatch(/import \{ shouldInterceptOnboarding, stepToSlug \} from '@\/lib\/onboarding'/)
  })

  it('redirects to /sign-in when getWorkspaceContext returns null', () => {
    expect(layoutSource).toMatch(/if \(!ctx\) redirect\('\/sign-in'\)/)
  })

  it('calls shouldInterceptOnboarding with ctx.onboarding and ctx.member.userId — never ctx.member.role (a comment documenting the omission is fine)', () => {
    expect(layoutSource).toMatch(/shouldInterceptOnboarding\(ctx\.onboarding, ctx\.member\.userId\)/)
    expect(layoutSource).not.toMatch(/shouldInterceptOnboarding\([^)]*\.role/)
    expect(layoutSource).not.toMatch(/import[^\n]*TeamRole/)
  })

  it('redirects to the exact persisted step via stepToSlug, never a hardcoded slug', () => {
    expect(layoutSource).toMatch(/redirect\(`\/onboarding\/\$\{stepToSlug\(ctx\.onboarding!\.currentStep!\)\}`\)/)
  })

  it('renders children when not intercepted', () => {
    const notInterceptedReturn = layoutSource.match(/redirect\(`\/onboarding\/\$\{stepToSlug\(ctx\.onboarding!\.currentStep!\)\}`\)\s*\}\s*\n\s*return <>\{children\}<\/>/)
    expect(notInterceptedReturn).not.toBeNull()
  })
})

describe('gated dashboard layout — no middleware dependency, no API gating, no TeamRole', () => {
  it('this file does not touch middleware.ts', () => {
    const middlewareSource = readSourceLF('middleware.ts')
    expect(middlewareSource).not.toMatch(/onboarding/i)
  })

  it('never imports TeamRole or type-annotates anything as TeamRole (a comment documenting the omission is fine)', () => {
    expect(layoutSource).not.toMatch(/import[^\n]*TeamRole/)
    expect(layoutSource).not.toMatch(/:\s*TeamRole\b/)
  })

  it('never redirects an /api/ path', () => {
    expect(layoutSource).not.toMatch(/\/api\//)
  })
})

describe('gated dashboard layout — Billing is not nested under (gated)', () => {
  it('app/(app)/dashboard/billing/page.tsx exists outside the (gated) route group', () => {
    const billingSource = readSourceLF('app/(app)/dashboard/billing/page.tsx')
    expect(billingSource).toMatch(/export default async function BillingPage/)
  })

  it('the gated layout file itself lives under app/(app)/dashboard/(gated)/, not app/(app)/dashboard/billing/', () => {
    // Reading it via the exact (gated) path above already proves this —
    // readSourceLF would throw ENOENT if the file were anywhere else.
    expect(layoutSource.length).toBeGreaterThan(0)
  })
})

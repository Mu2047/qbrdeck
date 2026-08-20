import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests: they read the two onboarding screen components as
// plain text and regex-match against them (asserting relative ordering of
// matched positions where sequence matters), following the same precedent
// as tests/onboarding-selfheal.test.ts and tests/onboarding-enrollment-atomicity.test.ts.
// This repo has no DB integration-test framework and these are 'use client'
// components driven by browser fetch(), not server logic that can be
// unit-executed directly here.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const welcomeSource = readSourceLF('app/onboarding/_screens/welcome.tsx')
const workspaceNameSource = readSourceLF('app/onboarding/_screens/workspace-name.tsx')
const firstClientSource = readSourceLF('app/onboarding/_screens/first-client.tsx')
const firstQbrSource = readSourceLF('app/onboarding/_screens/first-qbr.tsx')

describe('Welcome screen — advances to WORKSPACE_NAME, then navigates only on confirmed success', () => {
  it('POSTs /api/onboarding/advance with toStep: WORKSPACE_NAME', () => {
    expect(welcomeSource).toMatch(/fetch\('\/api\/onboarding\/advance', \{\s*method:\s*'POST',/)
    expect(welcomeSource).toMatch(/body:\s*JSON\.stringify\(\{ toStep: 'WORKSPACE_NAME' \}\)/)
  })

  it('navigates to /onboarding/workspace-name only after the advance call, not optimistically before it', () => {
    const advanceIdx = welcomeSource.indexOf("fetch('/api/onboarding/advance'")
    const throwIdx = welcomeSource.indexOf('throw new Error')
    const navIdx = welcomeSource.indexOf("router.push('/onboarding/workspace-name')")
    expect(advanceIdx).toBeGreaterThan(-1)
    expect(throwIdx).toBeGreaterThan(-1)
    expect(navIdx).toBeGreaterThan(-1)
    // the failure throw (guarding a non-ok response) comes before navigation,
    // so navigation is unreachable on a failed advance call
    expect(advanceIdx).toBeLessThan(throwIdx)
    expect(throwIdx).toBeLessThan(navIdx)
  })

  it('does not infer success locally — it checks res.ok before treating the call as successful', () => {
    expect(welcomeSource).toMatch(/if \(!res\.ok\) \{/)
  })

  it('guards against duplicate submission while a request is in flight', () => {
    expect(welcomeSource).toMatch(/if \(loading\) return/)
    expect(welcomeSource).toMatch(/disabled=\{loading\}/)
  })
})

describe('Workspace Name screen — PATCH workspace name, then advance, in strict order', () => {
  it('PATCHes /api/workspace before ever calling the advance endpoint', () => {
    const patchIdx = workspaceNameSource.indexOf("fetch('/api/workspace'")
    const advanceIdx = workspaceNameSource.indexOf("fetch('/api/onboarding/advance'")
    expect(patchIdx).toBeGreaterThan(-1)
    expect(advanceIdx).toBeGreaterThan(-1)
    expect(patchIdx).toBeLessThan(advanceIdx)
  })

  it('uses PATCH method against /api/workspace with the existing { name } contract', () => {
    expect(workspaceNameSource).toMatch(/method:\s*'PATCH',/)
    expect(workspaceNameSource).toMatch(/body:\s*JSON\.stringify\(\{ name: trimmed \}\)/)
  })

  it('advance is not attempted if the PATCH failed — the failure throw sits between the two fetch calls', () => {
    const patchIdx = workspaceNameSource.indexOf("fetch('/api/workspace'")
    const patchThrowIdx = workspaceNameSource.indexOf('Failed to save workspace name')
    const advanceIdx = workspaceNameSource.indexOf("fetch('/api/onboarding/advance'")
    expect(patchIdx).toBeLessThan(patchThrowIdx)
    expect(patchThrowIdx).toBeLessThan(advanceIdx)
  })

  it('advance body requests toStep: FIRST_CLIENT', () => {
    expect(workspaceNameSource).toMatch(/body:\s*JSON\.stringify\(\{ toStep: 'FIRST_CLIENT' \}\)/)
  })

  it('on successful FIRST_CLIENT advancement, navigates to /dashboard — never calls router.push toward /onboarding/first-client (a comment explaining why is fine)', () => {
    expect(workspaceNameSource).toMatch(/router\.push\('\/dashboard'\)/)
    expect(workspaceNameSource).not.toMatch(/router\.push\(['"`]\/onboarding\/first-client/)
  })

  it('navigation happens only after the advance call resolves successfully, not before', () => {
    const advanceIdx = workspaceNameSource.indexOf("fetch('/api/onboarding/advance'")
    const advanceThrowIdx = workspaceNameSource.indexOf('Failed to continue')
    const navIdx = workspaceNameSource.indexOf("router.push('/dashboard')")
    expect(advanceIdx).toBeLessThan(advanceThrowIdx)
    expect(advanceThrowIdx).toBeLessThan(navIdx)
  })

  it('requires a non-empty trimmed name before submitting', () => {
    expect(workspaceNameSource).toMatch(/const trimmed = name\.trim\(\)/)
    expect(workspaceNameSource).toMatch(/if \(!trimmed\) \{/)
  })

  it('guards against duplicate submission while a request is in flight', () => {
    expect(workspaceNameSource).toMatch(/if \(loading\) return/)
    expect(workspaceNameSource).toMatch(/disabled=\{loading\}/)
  })

  it('is prefilled from the server-provided initialName prop', () => {
    expect(workspaceNameSource).toMatch(/useState\(initialName\)/)
  })
})

describe('First Client screen — no render-time key writes, no browser-authority fields', () => {
  it('the idempotency key ref is seeded from the persisted prop, not generated eagerly', () => {
    expect(firstClientSource).toMatch(/const keyRef = useRef<string \| null>\(persistedKey\)/)
  })

  it('crypto.randomUUID() is only reachable from inside ensureKey(), called lazily from a submit handler — never at component-body/render scope', () => {
    const randomUUIDOccurrences = firstClientSource.match(/crypto\.randomUUID\(\)/g) ?? []
    expect(randomUUIDOccurrences.length).toBe(1)
    expect(firstClientSource).toMatch(/function ensureKey\(\) \{\s*if \(!keyRef\.current\) keyRef\.current = crypto\.randomUUID\(\)/)
  })

  it('attach mode POSTs only { mode: "attach", retryKey } — no clientId/existingClientId/workspaceId in the body', () => {
    expect(firstClientSource).toMatch(/body:\s*JSON\.stringify\(\{ mode: 'attach', retryKey \}\)/)
  })

  it('create mode never includes clientId, existingClientId, workspaceId, or userId in its request body', () => {
    const submitCreateMatch = firstClientSource.match(/async function submitCreate\(\) \{[\s\S]*?\n  \}/)
    expect(submitCreateMatch).not.toBeNull()
    const body = submitCreateMatch?.[0] ?? ''
    expect(body).not.toMatch(/clientId/)
    expect(body).not.toMatch(/existingClientId/)
    expect(body).not.toMatch(/workspaceId/)
    expect(body).not.toMatch(/userId/)
  })

  it('navigates to /onboarding/first-qbr after a confirmed successful response, for both attach and create', () => {
    const navOccurrences = firstClientSource.match(/router\.push\('\/onboarding\/first-qbr'\)/g) ?? []
    expect(navOccurrences.length).toBe(2)
  })

  it('the 2+ existing-client state renders no fetch call and only a "Return to dashboard" navigation', () => {
    const multiClientBlock = firstClientSource.match(/if \(existingClientCount > 1\) \{[\s\S]*?\n  \}/)
    expect(multiClientBlock).not.toBeNull()
    const block = multiClientBlock?.[0] ?? ''
    expect(block).not.toMatch(/fetch\(/)
    expect(block).toMatch(/router\.push\('\/dashboard'\)/)
    expect(block).toMatch(/Choose a client later/)
  })

  it('the single-existing-client state renders an attach action, not a create form', () => {
    const soleClientBlock = firstClientSource.match(/if \(existingClientCount === 1 && soleExistingClientName\) \{[\s\S]*?\n  \}/)
    expect(soleClientBlock).not.toBeNull()
    const block = soleClientBlock?.[0] ?? ''
    expect(block).toMatch(/onClick=\{submitAttach\}/)
    expect(block).not.toMatch(/onClick=\{submitCreate\}/)
  })

  it('guards against duplicate submission while a request is in flight, for both actions', () => {
    expect(firstClientSource).toMatch(/async function submitAttach\(\) \{\s*if \(loading\) return/)
    expect(firstClientSource).toMatch(/async function submitCreate\(\) \{\s*if \(loading\) return/)
  })
})

describe('First QBR screen — no render-time key writes, no client-authority fields, correct navigation', () => {
  it('the idempotency key ref is seeded from the persisted prop, not generated eagerly', () => {
    expect(firstQbrSource).toMatch(/const keyRef = useRef<string \| null>\(persistedKey\)/)
  })

  it('crypto.randomUUID() is only reachable from inside ensureKey(), called lazily from the generate() submit handler', () => {
    const randomUUIDOccurrences = firstQbrSource.match(/crypto\.randomUUID\(\)/g) ?? []
    expect(randomUUIDOccurrences.length).toBe(1)
    expect(firstQbrSource).toMatch(/function ensureKey\(\) \{\s*if \(!keyRef\.current\) keyRef\.current = crypto\.randomUUID\(\)/)
  })

  it('the generate() request body never includes a clientId — the anchored Client is resolved server-side', () => {
    const generateFnMatch = firstQbrSource.match(/async function generate\(\) \{[\s\S]*?\n  \}/)
    expect(generateFnMatch).not.toBeNull()
    expect(generateFnMatch?.[0] ?? '').not.toMatch(/clientId/)
  })

  it('navigates to /dashboard on success — never to /onboarding/review-qbr (a comment explaining why is fine)', () => {
    expect(firstQbrSource).toMatch(/router\.push\('\/dashboard'\)/)
    expect(firstQbrSource).not.toMatch(/router\.push\(['"`]\/onboarding\/review-qbr/)
  })

  it('navigation happens only after the generate call resolves successfully, not before', () => {
    const fetchIdx = firstQbrSource.indexOf("fetch('/api/onboarding/qbr'")
    const throwIdx = firstQbrSource.indexOf('Generation failed. Please try again.')
    const navIdx = firstQbrSource.indexOf("router.push('/dashboard')")
    expect(fetchIdx).toBeGreaterThan(-1)
    expect(throwIdx).toBeGreaterThan(-1)
    expect(fetchIdx).toBeLessThan(navIdx)
    expect(throwIdx).toBeLessThan(navIdx)
  })

  it('guards against duplicate submission while a request is in flight', () => {
    expect(firstQbrSource).toMatch(/async function generate\(\) \{\s*if \(loading\) return/)
    expect(firstQbrSource).toMatch(/disabled=\{loading\}/)
  })

})

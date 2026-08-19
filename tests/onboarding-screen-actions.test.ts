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

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract parity test: app/api/onboarding/client/route.ts mirrors
// app/api/clients/route.ts's Client field validation by hand (Option B from
// the P2 onboarding preflight) rather than importing a shared schema module,
// to avoid touching the generic Client API's file for this PR. This test
// exists to catch drift between the two shapes if either one changes later —
// it is the substitute for a shared import, not a suggestion that one is
// missing.

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const genericClientsSource = readSourceLF('app/api/clients/route.ts')
const onboardingClientSource = readSourceLF('app/api/onboarding/client/route.ts')

function extractFieldNames(schemaBlock: string): string[] {
  const matches = schemaBlock.matchAll(/^\s*(\w+):\s*z\./gm)
  return Array.from(matches, (m) => m[1]).sort()
}

describe('generic Client API is untouched by this PR', () => {
  it('app/api/clients/route.ts still defines its own inline createSchema (not imported from a shared module)', () => {
    expect(genericClientsSource).toMatch(/const createSchema = z\.object\(\{/)
    expect(genericClientsSource).not.toMatch(/from '@\/lib\/schemas\/client'/)
  })
})

describe('onboarding client create-mode field shape mirrors the generic Client createSchema exactly', () => {
  const genericSchemaMatch = genericClientsSource.match(/const createSchema = z\.object\(\{([\s\S]*?)\}\)/)
  const onboardingSchemaMatch = onboardingClientSource.match(/const createSchema = z\.object\(\{([\s\S]*?)\}\)\.strict\(\)/)

  it('locates both schema blocks', () => {
    expect(genericSchemaMatch).not.toBeNull()
    expect(onboardingSchemaMatch).not.toBeNull()
  })

  const genericFields = extractFieldNames(genericSchemaMatch?.[1] ?? '')
  // mode/retryKey are onboarding-specific control fields, not Client data
  // fields — excluded before comparing against the generic Client shape.
  const onboardingFields = extractFieldNames(onboardingSchemaMatch?.[1] ?? '').filter(
    (f) => f !== 'mode' && f !== 'retryKey'
  )

  it('the exact same set of Client data field names appears in both schemas', () => {
    expect(onboardingFields).toEqual(genericFields)
  })

  it('name is required (z.string().min(1)) in both schemas', () => {
    expect(genericSchemaMatch?.[1]).toMatch(/name:\s*z\.string\(\)\.min\(1\)/)
    expect(onboardingSchemaMatch?.[1]).toMatch(/name:\s*z\.string\(\)\.min\(1\)/)
  })

  it('contactEmail accepts a valid email or an empty string in both schemas', () => {
    expect(genericSchemaMatch?.[1]).toMatch(/contactEmail:\s*z\.string\(\)\.email\(\)\.optional\(\)\.or\(z\.literal\(''\)\)/)
    expect(onboardingSchemaMatch?.[1]).toMatch(/contactEmail:\s*z\.string\(\)\.email\(\)\.optional\(\)\.or\(z\.literal\(''\)\)/)
  })

  it('userCount is an optional number in both schemas', () => {
    expect(genericSchemaMatch?.[1]).toMatch(/userCount:\s*z\.number\(\)\.optional\(\)/)
    expect(onboardingSchemaMatch?.[1]).toMatch(/userCount:\s*z\.number\(\)\.optional\(\)/)
  })
})

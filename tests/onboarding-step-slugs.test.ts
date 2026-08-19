import { describe, it, expect } from 'vitest'
import {
  stepToSlug,
  slugToStep,
  isStepImplemented,
  isAdvanceableStep,
  requiredFromStepFor,
} from '@/lib/onboarding'
import type { OnboardingStep } from '@prisma/client'

// Real behavioral tests against the actual, imported helpers — lib/onboarding.ts
// is a pure module (no Prisma runtime import, no Clerk import, no redirect, no
// fetch), so it can be called directly here.

const ALL_STEPS: OnboardingStep[] = [
  'WELCOME',
  'WORKSPACE_NAME',
  'FIRST_CLIENT',
  'FIRST_QBR',
  'REVIEW_QBR',
  'EXPORT_QBR',
  'SHARE_QBR',
  'COMPLETE',
]

const EXPECTED_SLUGS: Record<OnboardingStep, string> = {
  WELCOME:        'welcome',
  WORKSPACE_NAME: 'workspace-name',
  FIRST_CLIENT:   'first-client',
  FIRST_QBR:      'first-qbr',
  REVIEW_QBR:     'review-qbr',
  EXPORT_QBR:     'export-qbr',
  SHARE_QBR:      'share-qbr',
  COMPLETE:       'complete',
}

describe('stepToSlug — all eight persisted steps', () => {
  it.each(ALL_STEPS)('maps %s to its exact expected slug', (step) => {
    expect(stepToSlug(step)).toBe(EXPECTED_SLUGS[step])
  })
})

describe('slugToStep — all eight slugs', () => {
  it.each(ALL_STEPS)('maps the slug for %s back to that exact step', (step) => {
    expect(slugToStep(EXPECTED_SLUGS[step])).toBe(step)
  })

  it('returns undefined for an unrecognized slug', () => {
    expect(slugToStep('not-a-real-step')).toBeUndefined()
  })

  it('returns undefined for an empty string', () => {
    expect(slugToStep('')).toBeUndefined()
  })

  it('is case-sensitive — an uppercased valid slug is not recognized', () => {
    expect(slugToStep('WELCOME')).toBeUndefined()
  })
})

describe('stepToSlug / slugToStep — round-trip', () => {
  it.each(ALL_STEPS)('round-trips %s through slug and back', (step) => {
    expect(slugToStep(stepToSlug(step))).toBe(step)
  })
})

describe('isStepImplemented — allowlist for this deployment', () => {
  it('WELCOME is implemented', () => {
    expect(isStepImplemented('WELCOME')).toBe(true)
  })

  it('WORKSPACE_NAME is implemented', () => {
    expect(isStepImplemented('WORKSPACE_NAME')).toBe(true)
  })

  it.each(['FIRST_CLIENT', 'FIRST_QBR', 'REVIEW_QBR', 'EXPORT_QBR', 'SHARE_QBR', 'COMPLETE'] as OnboardingStep[])(
    '%s is not implemented in this deployment',
    (step) => {
      expect(isStepImplemented(step)).toBe(false)
    }
  )
})

describe('isAdvanceableStep — only the two steps this slice can advance to', () => {
  it('WORKSPACE_NAME is advanceable', () => {
    expect(isAdvanceableStep('WORKSPACE_NAME')).toBe(true)
  })

  it('FIRST_CLIENT is advanceable', () => {
    expect(isAdvanceableStep('FIRST_CLIENT')).toBe(true)
  })

  it.each(['WELCOME', 'FIRST_QBR', 'REVIEW_QBR', 'EXPORT_QBR', 'SHARE_QBR', 'COMPLETE', 'BOGUS'])(
    '%s is not advanceable in this slice',
    (value) => {
      expect(isAdvanceableStep(value)).toBe(false)
    }
  )
})

describe('requiredFromStepFor — the exact fixed transition pair for this slice', () => {
  it('WORKSPACE_NAME requires the row to currently be at WELCOME', () => {
    expect(requiredFromStepFor('WORKSPACE_NAME')).toBe('WELCOME')
  })

  it('FIRST_CLIENT requires the row to currently be at WORKSPACE_NAME', () => {
    expect(requiredFromStepFor('FIRST_CLIENT')).toBe('WORKSPACE_NAME')
  })
})

import { describe, it, expect } from 'vitest'
import {
  stepToSlug,
  slugToStep,
  isStepImplemented,
  isAdvanceableStep,
  requiredFromStepFor,
  isSkippableStep,
  skipTransitionFor,
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
  it.each(ALL_STEPS)('%s is implemented (all eight, as of PR 7)', (step) => {
    expect(isStepImplemented(step)).toBe(true)
  })
})

describe('isAdvanceableStep — the five UI-only "Continue" transitions this slice supports', () => {
  it.each(['WORKSPACE_NAME', 'FIRST_CLIENT', 'EXPORT_QBR', 'SHARE_QBR', 'COMPLETE'])(
    '%s is advanceable',
    (value) => {
      expect(isAdvanceableStep(value)).toBe(true)
    }
  )

  it.each(['WELCOME', 'FIRST_QBR', 'REVIEW_QBR', 'BOGUS'])(
    '%s is not advanceable — FIRST_QBR/REVIEW_QBR are resource-dependent transitions handled by their own routes, not generic advance',
    (value) => {
      expect(isAdvanceableStep(value)).toBe(false)
    }
  )
})

describe('requiredFromStepFor — the exact fixed transition table for this slice', () => {
  it('WORKSPACE_NAME requires the row to currently be at WELCOME', () => {
    expect(requiredFromStepFor('WORKSPACE_NAME')).toBe('WELCOME')
  })

  it('FIRST_CLIENT requires the row to currently be at WORKSPACE_NAME', () => {
    expect(requiredFromStepFor('FIRST_CLIENT')).toBe('WORKSPACE_NAME')
  })

  it('EXPORT_QBR requires the row to currently be at REVIEW_QBR', () => {
    expect(requiredFromStepFor('EXPORT_QBR')).toBe('REVIEW_QBR')
  })

  it('SHARE_QBR requires the row to currently be at EXPORT_QBR', () => {
    expect(requiredFromStepFor('SHARE_QBR')).toBe('EXPORT_QBR')
  })

  it('COMPLETE requires the row to currently be at SHARE_QBR', () => {
    expect(requiredFromStepFor('COMPLETE')).toBe('SHARE_QBR')
  })
})

describe('isSkippableStep — only the two optional PR 7 steps', () => {
  it.each(['EXPORT_QBR', 'SHARE_QBR'])('%s is skippable', (value) => {
    expect(isSkippableStep(value)).toBe(true)
  })

  it.each(['WELCOME', 'WORKSPACE_NAME', 'FIRST_CLIENT', 'FIRST_QBR', 'REVIEW_QBR', 'COMPLETE', 'BOGUS'])(
    '%s is not skippable',
    (value) => {
      expect(isSkippableStep(value)).toBe(false)
    }
  )
})

describe('skipTransitionFor — the exact fixed skip-field + target pair for each skippable step', () => {
  it('EXPORT_QBR skip sets exportSkippedAt and advances to SHARE_QBR', () => {
    expect(skipTransitionFor('EXPORT_QBR')).toEqual({ skipField: 'exportSkippedAt', toStep: 'SHARE_QBR' })
  })

  it('SHARE_QBR skip sets shareSkippedAt and advances to COMPLETE', () => {
    expect(skipTransitionFor('SHARE_QBR')).toEqual({ skipField: 'shareSkippedAt', toStep: 'COMPLETE' })
  })
})

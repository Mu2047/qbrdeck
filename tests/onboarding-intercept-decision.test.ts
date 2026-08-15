import { describe, it, expect } from 'vitest'
import { shouldInterceptOnboarding, type OnboardingInterceptCandidate } from '@/lib/onboarding'
import type { OnboardingStep } from '@prisma/client'

// Real behavioral tests against the actual, imported shouldInterceptOnboarding
// — not a reimplementation/mirror. lib/onboarding.ts is a pure module (no
// Prisma runtime import, no Clerk import, no redirect, no fetch), so it can
// be called directly here with plain object literals shaped like the
// narrowed OnboardingInterceptCandidate type.

const OWNER_ID = 'user_owner_123'
const OTHER_USER_ID = 'user_other_456'

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

function candidate(overrides: Partial<OnboardingInterceptCandidate>): OnboardingInterceptCandidate {
  return {
    status: 'IN_PROGRESS',
    currentStep: 'WELCOME',
    onboardingOwnerUserId: OWNER_ID,
    ...overrides,
  }
}

describe('shouldInterceptOnboarding — the eligible, matching owner mid-journey', () => {
  it.each(ALL_STEPS)('returns true for IN_PROGRESS + currentStep=%s + matching owner', (step) => {
    expect(shouldInterceptOnboarding(candidate({ currentStep: step }), OWNER_ID)).toBe(true)
  })
})

describe('shouldInterceptOnboarding — role is never consulted; only onboardingOwnerUserId matters', () => {
  it('a different (invited) user viewing the eligible owner\'s in-progress onboarding is never intercepted', () => {
    expect(shouldInterceptOnboarding(candidate({}), OTHER_USER_ID)).toBe(false)
  })

  it('an invited member who was granted TeamRole.OWNER is still not intercepted merely by holding that role — only onboardingOwnerUserId identity matters, and the helper receives no role parameter at all', () => {
    // shouldInterceptOnboarding's signature takes no role argument, so an
    // invited OWNER can only ever match if onboardingOwnerUserId happens to
    // equal their id — which self-heal/enrollment never sets for anyone but
    // the original creator. Here the invited OWNER's id does not match the
    // durable creator anchor, so it must be false regardless of their role.
    const invitedOwnerId = 'user_invited_owner_789'
    expect(shouldInterceptOnboarding(candidate({ onboardingOwnerUserId: OWNER_ID }), invitedOwnerId)).toBe(false)
  })
})

describe('shouldInterceptOnboarding — missing anchor / missing step', () => {
  it('onboardingOwnerUserId null returns false even if currentUserId happens to be truthy', () => {
    expect(shouldInterceptOnboarding(candidate({ onboardingOwnerUserId: null }), OWNER_ID)).toBe(false)
  })

  it('currentStep null returns false even though status is IN_PROGRESS and the owner matches', () => {
    expect(shouldInterceptOnboarding(candidate({ currentStep: null }), OWNER_ID)).toBe(false)
  })

  it('both onboardingOwnerUserId and currentStep null returns false', () => {
    expect(shouldInterceptOnboarding(candidate({ onboardingOwnerUserId: null, currentStep: null }), OWNER_ID)).toBe(false)
  })
})

describe('shouldInterceptOnboarding — terminal/non-active statuses never intercept', () => {
  it('EXEMPT returns false, even with a matching owner and a non-null step', () => {
    expect(shouldInterceptOnboarding(candidate({ status: 'EXEMPT', currentStep: 'WELCOME' }), OWNER_ID)).toBe(false)
  })

  it('EXEMPT returns false when currentStep is null (the realistic self-heal shape)', () => {
    expect(shouldInterceptOnboarding(candidate({ status: 'EXEMPT', currentStep: null }), OWNER_ID)).toBe(false)
  })

  it('COMPLETED returns false, even with a matching owner and a non-null step', () => {
    expect(shouldInterceptOnboarding(candidate({ status: 'COMPLETED', currentStep: 'COMPLETE' }), OWNER_ID)).toBe(false)
  })
})

describe('shouldInterceptOnboarding — missing onboarding row', () => {
  it('null onboarding returns false', () => {
    expect(shouldInterceptOnboarding(null, OWNER_ID)).toBe(false)
  })

  it('undefined onboarding returns false', () => {
    expect(shouldInterceptOnboarding(undefined, OWNER_ID)).toBe(false)
  })
})

describe('shouldInterceptOnboarding — malformed/partial currentUserId fails open to false', () => {
  it('null currentUserId returns false', () => {
    expect(shouldInterceptOnboarding(candidate({}), null)).toBe(false)
  })

  it('undefined currentUserId returns false', () => {
    expect(shouldInterceptOnboarding(candidate({}), undefined)).toBe(false)
  })

  it('empty-string currentUserId returns false, even against an onboardingOwnerUserId that happens to also be empty', () => {
    expect(shouldInterceptOnboarding(candidate({ onboardingOwnerUserId: '' }), '')).toBe(false)
  })
})

describe('shouldInterceptOnboarding — malformed/unknown onboarding shape fails open to false', () => {
  it('an unrecognized status string (defensive runtime check, not just relying on the TS type) returns false', () => {
    const malformed = { status: 'SOMETHING_ELSE', currentStep: 'WELCOME', onboardingOwnerUserId: OWNER_ID } as unknown as OnboardingInterceptCandidate
    expect(shouldInterceptOnboarding(malformed, OWNER_ID)).toBe(false)
  })

  it('a partial object missing currentStep entirely returns false rather than throwing', () => {
    const partial = { status: 'IN_PROGRESS', onboardingOwnerUserId: OWNER_ID } as unknown as OnboardingInterceptCandidate
    expect(() => shouldInterceptOnboarding(partial, OWNER_ID)).not.toThrow()
    expect(shouldInterceptOnboarding(partial, OWNER_ID)).toBe(false)
  })

  it('an empty object returns false rather than throwing', () => {
    const empty = {} as unknown as OnboardingInterceptCandidate
    expect(() => shouldInterceptOnboarding(empty, OWNER_ID)).not.toThrow()
    expect(shouldInterceptOnboarding(empty, OWNER_ID)).toBe(false)
  })
})

describe('shouldInterceptOnboarding — the true-eligible case is exact-match, not substring/case-insensitive', () => {
  it('a similar-but-not-identical owner id is never treated as a match', () => {
    expect(shouldInterceptOnboarding(candidate({ onboardingOwnerUserId: OWNER_ID }), `${OWNER_ID}_extra`)).toBe(false)
  })

  it('differing case is never treated as a match (ids are compared exactly, not normalized)', () => {
    expect(shouldInterceptOnboarding(candidate({ onboardingOwnerUserId: OWNER_ID.toUpperCase() }), OWNER_ID)).toBe(false)
  })
})

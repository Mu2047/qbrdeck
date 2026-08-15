// Pure onboarding decision helpers. No Prisma import, no Clerk import, no
// redirect(), no fetch, no side effects — this file must be safely importable
// and callable from tests (or a future routing layer) without a database or
// auth context. Only `import type` is used below, which is erased at compile
// time and never pulls in the Prisma Client runtime.
import type { OnboardingStatus, OnboardingStep } from '@prisma/client'

// Shape of the WorkspaceOnboarding fields this decision needs — intentionally
// a narrow subset of the real Prisma model, not the model itself, so this
// file stays decoupled from Prisma at runtime while still tracking the real
// column types.
export type OnboardingInterceptCandidate = {
  status: OnboardingStatus
  currentStep: OnboardingStep | null
  onboardingOwnerUserId: string | null
}

// Returns true only when the currently authenticated user is the exact,
// durably-anchored owner of an onboarding journey that is still in progress.
// Role (TeamRole.OWNER) is never consulted here — an invited member can also
// hold TeamRole.OWNER, so role alone can never establish onboarding
// eligibility. Any missing, malformed, or partial input fails open to false.
export function shouldInterceptOnboarding(
  onboarding: OnboardingInterceptCandidate | null | undefined,
  currentUserId: string | null | undefined
): boolean {
  if (!onboarding) return false
  if (typeof currentUserId !== 'string' || currentUserId.length === 0) return false

  if (onboarding.status !== 'IN_PROGRESS') return false
  if (!onboarding.currentStep) return false
  if (!onboarding.onboardingOwnerUserId) return false

  return onboarding.onboardingOwnerUserId === currentUserId
}

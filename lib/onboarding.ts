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

// Deterministic, exhaustive step<->slug mapping for all eight persisted
// steps. Kept here (not in the route layer) so both the route and its tests
// import the same real mapping rather than a regex-matched mirror of it.
const STEP_SLUGS: Record<OnboardingStep, string> = {
  WELCOME:        'welcome',
  WORKSPACE_NAME: 'workspace-name',
  FIRST_CLIENT:   'first-client',
  FIRST_QBR:      'first-qbr',
  REVIEW_QBR:     'review-qbr',
  EXPORT_QBR:     'export-qbr',
  SHARE_QBR:      'share-qbr',
  COMPLETE:       'complete',
}

const SLUG_TO_STEP: Record<string, OnboardingStep> = Object.fromEntries(
  (Object.entries(STEP_SLUGS) as [OnboardingStep, string][]).map(([step, slug]) => [slug, step])
)

export function stepToSlug(step: OnboardingStep): string {
  return STEP_SLUGS[step]
}

// Returns undefined for any string that isn't one of the eight known slugs —
// callers (the route) must treat that as "invalid route", not "valid step".
export function slugToStep(slug: string): OnboardingStep | undefined {
  return SLUG_TO_STEP[slug]
}

// Steps with a rendered onboarding screen in THIS deployment. Deliberately a
// narrow, hand-maintained allowlist rather than "all OnboardingStep values"
// — a persisted currentStep can legitimately be ahead of what this specific
// deployment has shipped a screen for (e.g. the advance API already knows
// how to move a row to FIRST_CLIENT before the FIRST_CLIENT screen exists).
// Extend this set only when the corresponding screen ships in the same PR.
const IMPLEMENTED_STEPS: ReadonlySet<OnboardingStep> = new Set<OnboardingStep>([
  'WELCOME',
  'WORKSPACE_NAME',
  'FIRST_CLIENT',
  'FIRST_QBR',
  'REVIEW_QBR',
  'EXPORT_QBR',
  'SHARE_QBR',
  'COMPLETE',
])

export function isStepImplemented(step: OnboardingStep): boolean {
  return IMPLEMENTED_STEPS.has(step)
}

// Fixed, exhaustive transition table for the advance API in THIS deployment
// slice. Intentionally not a generic state machine over all OnboardingStep
// values — adding a transition requires an explicit new entry, never a loop.
// Only UI-only transitions belong here: ones that write nothing but
// currentStep. WORKSPACE_NAME->FIRST_CLIENT used to live here too, but PR 8
// replaced it with a dedicated POST /api/onboarding/workspace-name endpoint
// (one transaction: workspace rename + onboarding claim together) — see P2
// onboarding PR 8 preflight, "Workspace Name — must-fix". Keeping the old
// transition here as well would leave a second, non-atomic path to the same
// state change, so it was removed rather than left as an unused alternate.
// FIRST_CLIENT->FIRST_QBR (Client attach/create) and FIRST_QBR->REVIEW_QBR
// (QBR persistence) are resource-creating and stay in their own dedicated
// routes; EXPORT_QBR->SHARE_QBR and SHARE_QBR->COMPLETE have a *different*
// write (a skip marker) on their explicit-Skip path, so that path lives in
// /api/onboarding/skip instead — this table only ever covers the plain
// "Continue" path for each of those two steps.
const ADVANCE_TRANSITIONS = {
  WORKSPACE_NAME: 'WELCOME',
  EXPORT_QBR:     'REVIEW_QBR',
  SHARE_QBR:      'EXPORT_QBR',
  COMPLETE:       'SHARE_QBR',
} as const satisfies Record<string, OnboardingStep>

export type AdvanceableStep = keyof typeof ADVANCE_TRANSITIONS

const ADVANCEABLE_STEPS: ReadonlySet<string> = new Set(Object.keys(ADVANCE_TRANSITIONS))

export function isAdvanceableStep(toStep: string): toStep is AdvanceableStep {
  return ADVANCEABLE_STEPS.has(toStep)
}

// The exact persisted currentStep an onboarding row must already be at
// before `toStep` may be written. Only called after isAdvanceableStep has
// narrowed toStep, so the lookup can never miss.
export function requiredFromStepFor(toStep: AdvanceableStep): OnboardingStep {
  return ADVANCE_TRANSITIONS[toStep]
}

// Fixed, exhaustive table for the explicit-Skip API. Each entry pairs the
// step being skipped with the WorkspaceOnboarding column that records the
// explicit skip and the step it advances to — a different write shape than
// ADVANCE_TRANSITIONS above, which is exactly why skip lives in its own
// endpoint rather than being folded into the generic advance table.
const SKIP_TRANSITIONS = {
  EXPORT_QBR: { skipField: 'exportSkippedAt', toStep: 'SHARE_QBR' },
  SHARE_QBR:  { skipField: 'shareSkippedAt',  toStep: 'COMPLETE'  },
} as const satisfies Record<string, { skipField: string; toStep: OnboardingStep }>

export type SkippableStep = keyof typeof SKIP_TRANSITIONS

const SKIPPABLE_STEPS: ReadonlySet<string> = new Set(Object.keys(SKIP_TRANSITIONS))

export function isSkippableStep(step: string): step is SkippableStep {
  return SKIPPABLE_STEPS.has(step)
}

export function skipTransitionFor(step: SkippableStep): { skipField: 'exportSkippedAt' | 'shareSkippedAt'; toStep: OnboardingStep } {
  return SKIP_TRANSITIONS[step]
}

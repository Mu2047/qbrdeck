-- ============================================================================
-- P2 Onboarding PR 9 — Activation-Boundary Normalization (DATA ONLY)
--
-- Purpose: close the rollout race between enrollment and interception.
-- Before this PR's application code change (lib/workspace.ts), new-workspace
-- enrollment always created WorkspaceOnboarding as IN_PROGRESS/WELCOME
-- regardless of ONBOARDING_GATE_ENABLED, while dashboard interception
-- (app/(app)/dashboard/(gated)/layout.tsx) was already gated on that exact
-- variable. Any workspace created while the gate was OFF therefore received
-- a "live" IN_PROGRESS row that would retroactively become interceptable
-- the instant the gate was later enabled, even though its creator was never
-- shown an onboarding flow at signup.
--
-- This migration performs NO schema changes — exemptReason is already
-- String? (see PR 1, 20260812024918_p2_onboarding_schema_foundation). It
-- converts every remaining historical IN_PROGRESS row into a permanently
-- EXEMPT row, clearing all in-progress state so it can never resume or be
-- intercepted later. It does not touch already-completed or existing EXEMPT rows,
-- and it does not delete or modify any Client or QBR record — clearing
-- onboardingClientId/onboardingQbrId only detaches the onboarding anchor
-- reference (both columns are nullable @unique, so setting any number of
-- rows to NULL is always valid under Postgres unique-index semantics).
--
-- DEPLOYMENT ORDERING — READ BEFORE APPLYING:
-- This migration MUST be applied only after the env-aware enrollment code
-- in lib/workspace.ts is already live in Production, and only while
-- ONBOARDING_GATE_ENABLED is still not equal to the literal string 'true'.
-- Once that code is live, the gate-disabled enrollment branch itself always
-- creates new rows as EXEMPT ('pre_activation_gate_disabled') — never
-- IN_PROGRESS — so no code path in that state can produce a new IN_PROGRESS
-- row. That is what makes `WHERE status = 'IN_PROGRESS'` alone a safe,
-- generic predicate here: every row it matches is provably a pre-correction
-- legacy row, without this file needing to hard-code any workspace id, user
-- id, email, or timestamp cutoff. This migration does not and cannot verify
-- Vercel deployment state or environment variables itself — that ordering
-- is an operational precondition enforced by the deploy/migrate procedure,
-- not by this SQL.
--
-- Idempotency: safely rerunnable. A second execution matches zero rows,
-- because the first execution already converted every IN_PROGRESS row to
-- EXEMPT, and this statement never re-selects EXEMPT rows.
-- ============================================================================

UPDATE "WorkspaceOnboarding"
SET
    "status" = 'EXEMPT'::"OnboardingStatus",
    "currentStep" = NULL,
    "onboardingOwnerUserId" = NULL,
    "onboardingClientId" = NULL,
    "onboardingQbrId" = NULL,
    "clientStepIdempotencyKey" = NULL,
    "qbrStepIdempotencyKey" = NULL,
    "exportSkippedAt" = NULL,
    "shareSkippedAt" = NULL,
    "exemptReason" = 'pre_activation_gate_disabled',
    "startedAt" = NULL,
    "completedAt" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'IN_PROGRESS'::"OnboardingStatus";

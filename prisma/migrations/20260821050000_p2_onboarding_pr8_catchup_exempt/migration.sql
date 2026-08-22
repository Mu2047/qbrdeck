-- ============================================================================
-- P2 Onboarding PR 8 — Rollout-Window Catch-Up Exemption (DATA ONLY)
--
-- Purpose: close the unavoidable gap between the PR 2 backfill migration
-- (20260813025558_p2_onboarding_existing_workspace_exemption) and PR 8
-- activation. Normal fresh-workspace creation has already created its own
-- WorkspaceOnboarding row atomically since PR 14 — this migration does NOT
-- assume every workspace created in that window lacks a row; it simply
-- closes whatever gap actually exists at execution time, for whatever
-- reason (an operational failure in the atomic create, a workspace created
-- through a path that predates PR 14, etc.).
--
-- This migration performs NO schema changes (see PR 1,
-- 20260812024918_p2_onboarding_schema_foundation, and PR 7,
-- 20260820120000_p2_onboarding_export_share_skip_markers, for all
-- WorkspaceOnboarding columns/enums/constraints). It does not activate
-- onboarding for anyone: no IN_PROGRESS row is created here, and the
-- runtime gate (app/(app)/dashboard/(gated)/layout.tsx) only intercepts
-- IN_PROGRESS rows with a non-null owner anchor — EXEMPT rows are never
-- intercepted regardless of when this migration runs relative to gate
-- activation.
--
-- Scope — identical rules to the PR 2 backfill migration:
--   - Every Workspace WITHOUT an existing WorkspaceOnboarding row (including
--     soft-deleted workspaces) gets exactly one EXEMPT row.
--   - Any Workspace that already has a WorkspaceOnboarding row (regardless
--     of its status — IN_PROGRESS, COMPLETED, or EXEMPT) is left completely
--     untouched. This migration never overwrites, updates, or deletes an
--     existing row.
--   - No Client or QBR is inspected or set as an onboarding anchor;
--     onboardingClientId/onboardingQbrId are NULL for every inserted row.
--
-- exemptReason: reuses the exact same literal already used by the runtime
-- missing-row self-heal (lib/workspace.ts, getWorkspaceContext) for this
-- identical scenario — 'post_backfill_pre_activation_gap' — rather than
-- introducing a third exempt-reason value. This migration is simply the
-- durable, ahead-of-time closure of the same gap that self-heal exists to
-- catch lazily, per-request, as an emergency fallback.
--
-- ID generation: WorkspaceOnboarding.id has no PostgreSQL-level DEFAULT
-- (cuid() is generated only by the Prisma client). Deterministic id derived
-- from the unique workspaceId with a fixed prefix distinct from the PR 2
-- backfill's own prefix ('wsob_exempt_') purely for traceability of which
-- migration produced which row — 'wsob_catchup_' || Workspace.id. A
-- workspace can only ever be missing a row before exactly one of these two
-- migrations runs, so the two prefixes can never collide in practice.
--
-- Idempotency: WorkspaceOnboarding.workspaceId carries a UNIQUE constraint
-- (WorkspaceOnboarding_workspaceId_key, from PR 1). The WHERE NOT EXISTS
-- guard skips workspaces that already have a row, and
-- ON CONFLICT ("workspaceId") DO NOTHING is a belt-and-suspenders guard
-- against a concurrent/retried run — this migration is safely rerunnable.
-- ============================================================================

INSERT INTO "WorkspaceOnboarding" (
    "id",
    "workspaceId",
    "status",
    "currentStep",
    "onboardingClientId",
    "onboardingQbrId",
    "clientStepIdempotencyKey",
    "qbrStepIdempotencyKey",
    "exportSkippedAt",
    "shareSkippedAt",
    "exemptReason",
    "onboardingOwnerUserId",
    "startedAt",
    "completedAt",
    "createdAt",
    "updatedAt"
)
SELECT
    'wsob_catchup_' || w."id",
    w."id",
    'EXEMPT'::"OnboardingStatus",
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'post_backfill_pre_activation_gap',
    NULL,
    NULL,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Workspace" w
WHERE NOT EXISTS (
    SELECT 1 FROM "WorkspaceOnboarding" wo WHERE wo."workspaceId" = w."id"
)
ON CONFLICT ("workspaceId") DO NOTHING;

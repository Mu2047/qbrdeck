-- ============================================================================
-- P2 Onboarding PR 2 — Existing Workspace Exemption Backfill (DATA ONLY)
--
-- Purpose: every Workspace row that already exists at the time this migration
-- runs must receive an EXEMPT WorkspaceOnboarding row, so mandatory new-owner
-- onboarding (introduced in a later slice) never applies retroactively to
-- pre-existing workspaces.
--
-- This migration performs NO schema changes (see PR 1,
-- 20260812024918_p2_onboarding_schema_foundation, for the WorkspaceOnboarding
-- table/enums/constraints). It does not activate onboarding: no IN_PROGRESS
-- rows are created, and no application code path reads/writes onboarding
-- state as a result of this migration.
--
-- Scope:
--   - Every Workspace WITHOUT an existing WorkspaceOnboarding row (including
--     soft-deleted workspaces, i.e. deletedAt IS NOT NULL — a restored legacy
--     workspace must not be forced through onboarding merely because it was
--     soft-deleted when this migration ran) gets exactly one EXEMPT row.
--   - Any Workspace that already has a WorkspaceOnboarding row (regardless of
--     its status) is left untouched — this migration never overwrites an
--     existing row, and never converts IN_PROGRESS/COMPLETED to EXEMPT.
--   - No Client or QBR is inspected, selected, or set as an onboarding
--     anchor; onboardingClientId/onboardingQbrId are NULL for every backfilled
--     row.
--
-- ID generation:
--   WorkspaceOnboarding.id has no PostgreSQL-level DEFAULT (see PR 1's
--   migration.sql: "id" TEXT NOT NULL, no DEFAULT — cuid() is generated only
--   by the Prisma client, never by the database). No repository convention
--   exists yet for deterministic IDs in a raw-SQL data migration (no prior
--   migration in this repo contains an INSERT). We derive the id
--   deterministically from the unique workspaceId with a fixed prefix
--   ('wsob_exempt_' || Workspace.id). This is deterministic, unique per
--   Workspace, requires no PostgreSQL extension (no pgcrypto/uuid-ossp/
--   gen_random_uuid), and is safe if this migration is ever retried — the
--   same input Workspace always produces the same candidate id.
--
-- Idempotency:
--   WorkspaceOnboarding.workspaceId already carries a UNIQUE constraint
--   (WorkspaceOnboarding_workspaceId_key, from PR 1). The WHERE NOT EXISTS
--   guard skips workspaces that already have a row, and ON CONFLICT
--   ("workspaceId") DO NOTHING is a belt-and-suspenders guard against a
--   concurrent/retried run — either way, no existing row is ever overwritten
--   and no duplicate is ever created.
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
    "exemptReason",
    "startedAt",
    "completedAt",
    "createdAt",
    "updatedAt"
)
SELECT
    'wsob_exempt_' || w."id",
    w."id",
    'EXEMPT'::"OnboardingStatus",
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'pre_onboarding_rollout',
    NULL,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Workspace" w
WHERE NOT EXISTS (
    SELECT 1 FROM "WorkspaceOnboarding" wo WHERE wo."workspaceId" = w."id"
)
ON CONFLICT ("workspaceId") DO NOTHING;

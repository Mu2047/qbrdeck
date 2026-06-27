-- ============================================================================
-- P05 Step 1 — Schema Hardening (STAGED / REWRITTEN FOR EXISTING DATA)
--
-- This migration was hand-rewritten from Prisma's generated SQL to be safe on a
-- database that already contains QBR rows. The ONLY substantive change vs the
-- generated file is the handling of QBR.workspaceId and the composite FK:
--   generated: ADD COLUMN "workspaceId" TEXT NOT NULL   (aborts on non-empty table)
--   here:      add nullable -> backfill from Client -> verify -> enforce NOT NULL
--
-- Everything is wrapped in a single transaction. If any verification check trips
-- the RAISE EXCEPTION, the WHOLE migration rolls back and your DB is unchanged.
-- ============================================================================

BEGIN;

-- ── Phase 0: Drop FKs/indexes that are being replaced ───────────────────────
ALTER TABLE "Client"      DROP CONSTRAINT "Client_createdById_fkey";
ALTER TABLE "ExportEvent" DROP CONSTRAINT "ExportEvent_clientId_fkey";
ALTER TABLE "ExportEvent" DROP CONSTRAINT "ExportEvent_qbrId_fkey";
ALTER TABLE "ExportEvent" DROP CONSTRAINT "ExportEvent_workspaceId_fkey";
ALTER TABLE "QBR"         DROP CONSTRAINT "QBR_clientId_fkey";

DROP INDEX "QBR_createdAt_idx";
DROP INDEX "WorkspaceInvite_token_idx";

-- ── Phase 1: Additive columns (safe on non-empty tables) ────────────────────
ALTER TABLE "Client"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ALTER COLUMN "createdById" DROP NOT NULL;

ALTER TABLE "Workspace"
  ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "WorkspaceInvite"
  ADD COLUMN "acceptedAt"       TIMESTAMP(3),
  ADD COLUMN "acceptedByUserId" TEXT,
  ADD COLUMN "revokedAt"        TIMESTAMP(3);

-- QBR additive columns — workspaceId added NULLABLE here (Prisma had it NOT NULL).
ALTER TABLE "QBR"
  ADD COLUMN "deletedAt"    TIMESTAMP(3),
  ADD COLUMN "isCurrent"    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "supersededAt" TIMESTAMP(3),
  ADD COLUMN "version"      INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "workspaceId"  TEXT;            -- <-- nullable for now

-- ── Phase 2: Backfill QBR.workspaceId from the owning Client ────────────────
UPDATE "QBR" q
SET "workspaceId" = c."workspaceId"
FROM "Client" c
WHERE q."clientId" = c."id"
  AND q."workspaceId" IS NULL;

-- ── Phase 3: Verify backfill BEFORE enforcing constraints ───────────────────
-- Any failure here raises an exception and rolls back the whole migration.
DO $$
DECLARE
  null_ws      bigint;
  ws_mismatch  bigint;
  orphan_qbr   bigint;
BEGIN
  SELECT count(*) INTO null_ws
    FROM "QBR" WHERE "workspaceId" IS NULL;

  SELECT count(*) INTO ws_mismatch
    FROM "QBR" q JOIN "Client" c ON c."id" = q."clientId"
    WHERE q."workspaceId" <> c."workspaceId";

  SELECT count(*) INTO orphan_qbr
    FROM "QBR" q LEFT JOIN "Client" c ON c."id" = q."clientId"
    WHERE c."id" IS NULL;

  IF null_ws > 0 THEN
    RAISE EXCEPTION 'ABORT: % QBR row(s) have NULL workspaceId after backfill', null_ws;
  END IF;
  IF ws_mismatch > 0 THEN
    RAISE EXCEPTION 'ABORT: % QBR row(s) have workspaceId != client workspaceId', ws_mismatch;
  END IF;
  IF orphan_qbr > 0 THEN
    RAISE EXCEPTION 'ABORT: % QBR row(s) reference a non-existent client', orphan_qbr;
  END IF;

  RAISE NOTICE 'Backfill verified: all QBR rows have a consistent workspaceId.';
END $$;

-- ── Phase 4: Enforce NOT NULL now that every row is populated ────────────────
ALTER TABLE "QBR" ALTER COLUMN "workspaceId" SET NOT NULL;

-- ── Phase 5: New indexes (on existing tables) ───────────────────────────────
CREATE INDEX        "Client_workspaceId_nextQbrDate_idx" ON "Client"("workspaceId", "nextQbrDate");
CREATE INDEX        "Client_deletedAt_idx"               ON "Client"("deletedAt");
CREATE UNIQUE INDEX "Client_id_workspaceId_key"          ON "Client"("id", "workspaceId");

CREATE INDEX        "QBR_workspaceId_createdAt_idx"             ON "QBR"("workspaceId", "createdAt");
CREATE INDEX        "QBR_clientId_createdAt_idx"                ON "QBR"("clientId", "createdAt");
CREATE INDEX        "QBR_clientId_quarter_year_createdAt_idx"   ON "QBR"("clientId", "quarter", "year", "createdAt");
CREATE INDEX        "QBR_deletedAt_idx"                         ON "QBR"("deletedAt");
CREATE UNIQUE INDEX "QBR_id_workspaceId_key"                    ON "QBR"("id", "workspaceId");

CREATE INDEX        "Workspace_deletedAt_idx"            ON "Workspace"("deletedAt");
CREATE INDEX        "WorkspaceMember_workspaceId_role_idx" ON "WorkspaceMember"("workspaceId", "role");

-- ── Phase 6: ShareLink table ────────────────────────────────────────────────
CREATE TABLE "ShareLink" (
    "id"              TEXT NOT NULL,
    "tokenHash"       TEXT NOT NULL,
    "qbrId"           TEXT NOT NULL,
    "workspaceId"     TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"       TIMESTAMP(3),
    "revokedAt"       TIMESTAMP(3),
    "lastViewedAt"    TIMESTAMP(3),
    "viewCount"       INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShareLink_qbrId_idx"                ON "ShareLink"("qbrId");
CREATE UNIQUE INDEX "ShareLink_tokenHash_key"     ON "ShareLink"("tokenHash");
CREATE INDEX "ShareLink_workspaceId_createdAt_idx" ON "ShareLink"("workspaceId", "createdAt");
CREATE INDEX "ShareLink_expiresAt_idx"            ON "ShareLink"("expiresAt");
CREATE INDEX "ShareLink_revokedAt_idx"            ON "ShareLink"("revokedAt");

-- ── Phase 7: Re-add / add foreign keys ──────────────────────────────────────
-- Composite FK is added AFTER workspaceId is populated + NOT NULL, so it succeeds.
ALTER TABLE "WorkspaceInvite"
  ADD CONSTRAINT "WorkspaceInvite_acceptedByUserId_fkey"
  FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Client"
  ADD CONSTRAINT "Client_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QBR"
  ADD CONSTRAINT "QBR_clientId_workspaceId_fkey"
  FOREIGN KEY ("clientId", "workspaceId") REFERENCES "Client"("id", "workspaceId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QBR"
  ADD CONSTRAINT "QBR_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ShareLink"
  ADD CONSTRAINT "ShareLink_qbrId_workspaceId_fkey"
  FOREIGN KEY ("qbrId", "workspaceId") REFERENCES "QBR"("id", "workspaceId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ShareLink"
  ADD CONSTRAINT "ShareLink_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ShareLink"
  ADD CONSTRAINT "ShareLink_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ExportEvent"
  ADD CONSTRAINT "ExportEvent_qbrId_fkey"
  FOREIGN KEY ("qbrId") REFERENCES "QBR"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExportEvent"
  ADD CONSTRAINT "ExportEvent_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExportEvent"
  ADD CONSTRAINT "ExportEvent_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;

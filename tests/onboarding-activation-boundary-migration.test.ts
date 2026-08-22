import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract test for the PR 9 activation-boundary normalization
// migration — verifies it is a pure-data UPDATE, matching the same
// conventions as the PR 8 catch-up migration
// (20260821050000_p2_onboarding_pr8_catchup_exempt). Does NOT execute the
// migration — see tests conventions elsewhere in this repo for why (no DB
// integration-test framework).

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const migrationSource = readSourceLF(
  'prisma/migrations/20260822010000_p2_onboarding_activation_boundary_normalization/migration.sql'
)

describe('PR 9 activation-boundary migration — targets only historical IN_PROGRESS rows', () => {
  it('is an UPDATE "WorkspaceOnboarding"', () => {
    expect(migrationSource).toMatch(/UPDATE "WorkspaceOnboarding"/)
  })

  it('is predicated on WHERE status = IN_PROGRESS only', () => {
    expect(migrationSource).toMatch(/WHERE\s+"status"\s*=\s*'IN_PROGRESS'::"OnboardingStatus";/)
  })

  it('never appears there is more than one statement targeting the table', () => {
    const updateOccurrences = migrationSource.match(/UPDATE "WorkspaceOnboarding"/g) ?? []
    expect(updateOccurrences.length).toBe(1)
  })
})

describe('PR 9 activation-boundary migration — sets every required field', () => {
  it('sets status = EXEMPT', () => {
    expect(migrationSource).toMatch(/"status"\s*=\s*'EXEMPT'::"OnboardingStatus",/)
  })

  it('sets currentStep = NULL', () => {
    expect(migrationSource).toMatch(/"currentStep"\s*=\s*NULL,/)
  })

  it('sets onboardingOwnerUserId = NULL', () => {
    expect(migrationSource).toMatch(/"onboardingOwnerUserId"\s*=\s*NULL,/)
  })

  it('sets onboardingClientId = NULL and onboardingQbrId = NULL — detaches anchors, never touches Client/QBR rows themselves', () => {
    expect(migrationSource).toMatch(/"onboardingClientId"\s*=\s*NULL,/)
    expect(migrationSource).toMatch(/"onboardingQbrId"\s*=\s*NULL,/)
  })

  it('sets clientStepIdempotencyKey = NULL and qbrStepIdempotencyKey = NULL', () => {
    expect(migrationSource).toMatch(/"clientStepIdempotencyKey"\s*=\s*NULL,/)
    expect(migrationSource).toMatch(/"qbrStepIdempotencyKey"\s*=\s*NULL,/)
  })

  it('sets exportSkippedAt = NULL and shareSkippedAt = NULL', () => {
    expect(migrationSource).toMatch(/"exportSkippedAt"\s*=\s*NULL,/)
    expect(migrationSource).toMatch(/"shareSkippedAt"\s*=\s*NULL,/)
  })

  it('sets exemptReason to exactly pre_activation_gate_disabled', () => {
    expect(migrationSource).toMatch(/"exemptReason"\s*=\s*'pre_activation_gate_disabled',/)
  })

  it('sets startedAt = NULL and completedAt = NULL', () => {
    expect(migrationSource).toMatch(/"startedAt"\s*=\s*NULL,/)
    expect(migrationSource).toMatch(/"completedAt"\s*=\s*NULL,/)
  })

  it('sets updatedAt = CURRENT_TIMESTAMP (the final SET clause, no trailing comma)', () => {
    expect(migrationSource).toMatch(/"updatedAt"\s*=\s*CURRENT_TIMESTAMP\s*\nWHERE/)
  })

  it('never assigns id, workspaceId, or createdAt', () => {
    expect(migrationSource).not.toMatch(/"id"\s*=/)
    expect(migrationSource).not.toMatch(/"workspaceId"\s*=/)
    expect(migrationSource).not.toMatch(/"createdAt"\s*=/)
  })
})

describe('PR 9 activation-boundary migration — pure data mutation, no destructive or schema DDL', () => {
  it('never contains DELETE, TRUNCATE, DROP, ALTER TABLE, or ALTER TYPE', () => {
    expect(migrationSource).not.toMatch(/\bDELETE\b/)
    expect(migrationSource).not.toMatch(/\bTRUNCATE\b/)
    expect(migrationSource).not.toMatch(/\bDROP\b/)
    expect(migrationSource).not.toMatch(/\bALTER TABLE\b/)
    expect(migrationSource).not.toMatch(/\bALTER TYPE\b/)
  })

  it('never contains INSERT — this migration only updates existing rows, it never creates one', () => {
    expect(migrationSource).not.toMatch(/\bINSERT\b/)
  })
})

describe('PR 9 activation-boundary migration — structurally excludes COMPLETED and existing EXEMPT rows', () => {
  it('never targets the COMPLETED enum literal in SQL — the predicate/casts never reference it', () => {
    expect(migrationSource).not.toMatch(/'COMPLETED'/)
  })

  it('never references the two other reserved exempt reasons — it must not rewrite existing EXEMPT rows', () => {
    expect(migrationSource).not.toMatch(/pre_onboarding_rollout/)
    expect(migrationSource).not.toMatch(/post_backfill_pre_activation_gap/)
  })

  it('never hard-codes a workspace id, user id, or email — the predicate is generic status-only', () => {
    expect(migrationSource).not.toMatch(/@gmail\.com/)
    expect(migrationSource).not.toMatch(/cmsz\w+/)
    expect(migrationSource).not.toMatch(/cmqx\w+/)
  })
})

describe('PR 9 activation-boundary migration — no schema change accompanies it', () => {
  it('schema.prisma has no pending diff attributable to this migration (WorkspaceOnboarding model fields are unchanged)', () => {
    const schemaSource = readSourceLF('prisma/schema.prisma')
    expect(schemaSource).toMatch(/model WorkspaceOnboarding \{/)
    expect(schemaSource).toMatch(/exemptReason String\?/)
  })
})

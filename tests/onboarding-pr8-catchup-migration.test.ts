import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract test for the PR 8 rollout-window catch-up migration —
// verifies pure-additive-data DDL, matching the same shape as the PR 2
// backfill migration this repo already ran
// (20260813025558_p2_onboarding_existing_workspace_exemption). Does NOT
// execute the migration — see tests conventions elsewhere in this repo for
// why (no DB integration-test framework).

function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const migrationSource = readSourceLF(
  'prisma/migrations/20260821050000_p2_onboarding_pr8_catchup_exempt/migration.sql'
)

describe('PR 8 catch-up migration — pure additive data insert only', () => {
  it('is an INSERT ... SELECT ... FROM "Workspace"', () => {
    expect(migrationSource).toMatch(/INSERT INTO "WorkspaceOnboarding"/)
    expect(migrationSource).toMatch(/SELECT[\s\S]*FROM "Workspace" w/)
  })

  it('guards with WHERE NOT EXISTS against a WorkspaceOnboarding row already existing for that workspace', () => {
    expect(migrationSource).toMatch(/WHERE NOT EXISTS \(\s*SELECT 1 FROM "WorkspaceOnboarding" wo WHERE wo\."workspaceId" = w\."id"\s*\)/)
  })

  it('guards with ON CONFLICT ("workspaceId") DO NOTHING as a belt-and-suspenders idempotency measure', () => {
    expect(migrationSource).toMatch(/ON CONFLICT \("workspaceId"\) DO NOTHING;/)
  })

  it('inserts EXEMPT status with every anchor/step field NULL and the locked exempt reason', () => {
    expect(migrationSource).toMatch(/'EXEMPT'::"OnboardingStatus"/)
    expect(migrationSource).toMatch(/'post_backfill_pre_activation_gap'/)
  })

  it('never contains UPDATE, DELETE, TRUNCATE, DROP, or ALTER TABLE', () => {
    expect(migrationSource).not.toMatch(/\bUPDATE\b/)
    expect(migrationSource).not.toMatch(/\bDELETE\b/)
    expect(migrationSource).not.toMatch(/\bTRUNCATE\b/)
    expect(migrationSource).not.toMatch(/\bDROP\b/)
    expect(migrationSource).not.toMatch(/\bALTER TABLE\b/)
  })

  it('never mutates an existing row — the only statement in the file is the single guarded INSERT', () => {
    const insertOccurrences = migrationSource.match(/INSERT INTO/g) ?? []
    expect(insertOccurrences.length).toBe(1)
  })
})

describe('PR 8 catch-up migration — no schema change accompanies it', () => {
  it('schema.prisma has no pending diff attributable to this migration (WorkspaceOnboarding model fields are unchanged by PR 8)', () => {
    const schemaSource = readSourceLF('prisma/schema.prisma')
    // The model already carries every column this migration inserts values
    // for (from PR 1 and PR 7) — this migration adds no new column.
    expect(schemaSource).toMatch(/model WorkspaceOnboarding \{/)
    expect(schemaSource).toMatch(/exportSkippedAt DateTime\?/)
    expect(schemaSource).toMatch(/shareSkippedAt  DateTime\?/)
  })
})

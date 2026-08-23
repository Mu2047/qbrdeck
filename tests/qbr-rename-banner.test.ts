import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// This repo has no jsdom/@testing-library/react (see tests/reminder-status-
// consistency.test.ts for the established precedent this file follows).
// Two kinds of tests appear below, clearly separated by describe block:
//
//  - "source contract" tests read page.tsx as plain text and regex/slice-
//    match against it. They do NOT render React, do NOT mount the component,
//    and do NOT execute saveEdit(). They prove the source contains the
//    expected code shape and statement order — ordering assertions rely on
//    ordinary JS control flow (a conditional guard textually preceding a
//    state-mutating call means that call cannot run unless the guard passes),
//    not on any runtime trace.
//  - "behavioral harness" tests reimplement the notice's state-transition
//    logic as a small, pure, in-memory reducer, driven through a sequence of
//    events, asserting on its actual return values — not on regex matches.
//    The reducer's shape (only ever returns true on a qualifying rename,
//    only ever returns false on dismiss, otherwise passes the current value
//    through unchanged) is pinned to the real source by the source-contract
//    tests in the same file, so the two cannot silently drift apart.

const PAGE_PATH = join(process.cwd(), 'app/(app)/dashboard/(gated)/clients/[id]/page.tsx')
// Normalized to LF regardless of the checked-out line-ending style.
const pageSource = readFileSync(PAGE_PATH, 'utf-8').replace(/\r\n/g, '\n')

function extractSaveEdit(): string {
  return pageSource.slice(
    pageSource.indexOf('async function saveEdit()'),
    pageSource.indexOf('function cancelEdit()')
  )
}

// ─────────────────────────────────────────────────────────────────────────
// A. State declaration
// ─────────────────────────────────────────────────────────────────────────

describe('page.tsx — showRenameExportNotice state', () => {
  it('declares a dedicated boolean state, initialized false', () => {
    expect(pageSource).toMatch(
      /const \[showRenameExportNotice, setShowRenameExportNotice\] = useState\(false\)/
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────
// B. saveEdit() — rename detection is pre-save, event-driven, ON-only
// ─────────────────────────────────────────────────────────────────────────

describe('saveEdit() — rename/QBR-count capture happens before setClient(data)', () => {
  it('renamed is computed by comparing client.name (pre-save) to data.name (server-confirmed)', () => {
    expect(extractSaveEdit()).toMatch(/const renamed = client\.name !== data\.name/)
  })

  it('hadQbrs reads client.qbrs (the pre-save array), never data.qbrs', () => {
    const saveEditSource = extractSaveEdit()
    expect(saveEditSource).toMatch(/const hadQbrs = \(client\.qbrs\?\.length \?\? 0\) > 0/)
    expect(saveEditSource).not.toMatch(/data\.qbrs/)
  })

  it('both renamed and hadQbrs are computed, and setClient(data) called, strictly after the res.ok success guard', () => {
    const saveEditSource = extractSaveEdit()
    const okGuardIdx   = saveEditSource.search(/if \(!res\.ok\) throw new Error\(data\.error\)/)
    const renamedIdx   = saveEditSource.search(/const renamed = client\.name !== data\.name/)
    const hadQbrsIdx   = saveEditSource.search(/const hadQbrs = /)
    expect(okGuardIdx).toBeGreaterThan(-1)
    expect(renamedIdx).toBeGreaterThan(okGuardIdx)
    expect(hadQbrsIdx).toBeGreaterThan(okGuardIdx)
  })

  it('renamed and hadQbrs are both computed BEFORE the setClient merge — proving the QBR count is read pre-save, not from the (qbrs-less) PATCH response', () => {
    const saveEditSource = extractSaveEdit()
    const renamedIdx    = saveEditSource.search(/const renamed = client\.name !== data\.name/)
    const hadQbrsIdx     = saveEditSource.search(/const hadQbrs = /)
    // Anchored to the start of the statement line, matching the functional
    // merge (setClient(data) alone no longer appears in saveEdit() — see
    // the QBR-history-after-client-patch fix).
    const setClientIdx   = saveEditSource.search(/^\s*setClient\(\(prev: any\) => \(\{ \.\.\.prev, \.\.\.data \}\)\)/m)
    expect(renamedIdx).toBeGreaterThan(-1)
    expect(hadQbrsIdx).toBeGreaterThan(-1)
    expect(setClientIdx).toBeGreaterThan(-1)
    expect(renamedIdx).toBeLessThan(setClientIdx)
    expect(hadQbrsIdx).toBeLessThan(setClientIdx)
  })

  it('the notice is set to true only inside an if (renamed && hadQbrs) guard — both facts are required, not just a rename alone', () => {
    expect(extractSaveEdit()).toMatch(
      /if \(renamed && hadQbrs\) setShowRenameExportNotice\(true\)/
    )
  })

  it('saveEdit() never calls setShowRenameExportNotice(false) — a save can only ever turn the notice on, never clear an active one', () => {
    const saveEditSource = extractSaveEdit()
    expect(saveEditSource).not.toMatch(/setShowRenameExportNotice\(false\)/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// C. Dismissal
// ─────────────────────────────────────────────────────────────────────────

describe('dismiss control', () => {
  it('a dismiss button calls setShowRenameExportNotice(false)', () => {
    expect(pageSource).toMatch(
      /onClick=\{\(\) => setShowRenameExportNotice\(false\)\}/
    )
  })

  it('setShowRenameExportNotice(false) appears exactly once in the whole file — only the dismiss control can turn the notice off', () => {
    const calls = pageSource.match(/setShowRenameExportNotice\(false\)/g) ?? []
    expect(calls.length).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// D. Visibility is flag-driven, not editing-driven
// ─────────────────────────────────────────────────────────────────────────

describe('banner visibility', () => {
  it('the banner JSX is gated on showRenameExportNotice', () => {
    expect(pageSource).toMatch(/\{showRenameExportNotice && \(/)
  })

  it('the old !editing-only gate on the regenerate notice is gone — the comment/condition immediately preceding the banner markup no longer reads "{!editing && ("', () => {
    const bannerIdx = pageSource.indexOf('If you updated the client name')
    expect(bannerIdx).toBeGreaterThan(-1)
    const precedingSlice = pageSource.slice(Math.max(0, bannerIdx - 300), bannerIdx)
    expect(precedingSlice).not.toMatch(/\{!editing && \(/)
    expect(precedingSlice).toMatch(/\{showRenameExportNotice && \(/)
  })

  it('the QBR Schedule block below still legitimately uses !editing for its own, unrelated purpose — this fix did not remove !editing usage globally', () => {
    expect(pageSource).toMatch(/\{\/\* QBR Schedule \*\/\}\s*\n\s*\{!editing && \(/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// E. Scope — no unrelated changes
// ─────────────────────────────────────────────────────────────────────────

describe('scope guardrails', () => {
  it('the quick reminder-date-only editor never references showRenameExportNotice', () => {
    const anchor = 'nextQbrDate: form.nextQbrDate ? new Date(form.nextQbrDate).toISOString() : null'
    const anchorIdx = pageSource.indexOf(anchor)
    expect(anchorIdx).toBeGreaterThan(-1)
    const startIdx = pageSource.lastIndexOf('onClick={async () => {', anchorIdx)
    const endIdx   = pageSource.indexOf('disabled={saving}', anchorIdx)
    const quickEditorHandler = pageSource.slice(startIdx, endIdx)
    expect(quickEditorHandler).not.toMatch(/showRenameExportNotice/)
  })

  it('cancelEdit() never references showRenameExportNotice', () => {
    const cancelEditSource = pageSource.slice(
      pageSource.indexOf('function cancelEdit()'),
      pageSource.indexOf('if (!client)')
    )
    expect(cancelEditSource).not.toMatch(/showRenameExportNotice/)
  })

  it('still no client-side getReminderStatus and no /api/reminders — unrelated reminder-status work is untouched', () => {
    expect(pageSource).not.toMatch(/getReminderStatus\(/)
    expect(pageSource).not.toMatch(/\/api\/reminders/)
  })

  it('still exactly 3 fetch calls to /api/clients/[id] — no new API request was introduced', () => {
    const fetchCalls = pageSource.match(/fetch\(`\/api\/clients\/\$\{params\.id\}`/g) ?? []
    expect(fetchCalls.length).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Behavioral harness — real reducer logic, in-memory event sequences.
// Mirrors the notice's actual state-transition rule (pinned to the real
// source above): only ever true on a qualifying rename, only ever false on
// dismiss, otherwise passes the current value through unchanged.
// ─────────────────────────────────────────────────────────────────────────

type SaveEvent = { type: 'save'; oldName: string; newName: string; preSaveQbrCount: number }
type DismissEvent = { type: 'dismiss' }

function mirrorNoticeReducer(current: boolean, event: SaveEvent | DismissEvent): boolean {
  if (event.type === 'dismiss') return false
  const renamed = event.oldName !== event.newName
  const hadQbrs = event.preSaveQbrCount > 0
  if (renamed && hadQbrs) return true
  return current // non-qualifying save: an active notice is left untouched
}

describe('notice state machine — behavioral harness', () => {
  it('rename with >=1 QBR turns the notice on', () => {
    const next = mirrorNoticeReducer(false, { type: 'save', oldName: 'Acme', newName: 'Acme Corp', preSaveQbrCount: 2 })
    expect(next).toBe(true)
  })

  it('rename with 0 QBRs does NOT turn the notice on', () => {
    const next = mirrorNoticeReducer(false, { type: 'save', oldName: 'Acme', newName: 'Acme Corp', preSaveQbrCount: 0 })
    expect(next).toBe(false)
  })

  it('a non-rename save while the notice is active leaves it active (not cleared)', () => {
    const active = true
    const next = mirrorNoticeReducer(active, { type: 'save', oldName: 'Acme Corp', newName: 'Acme Corp', preSaveQbrCount: 3 })
    expect(next).toBe(true)
  })

  it('a non-rename save while the notice is inactive leaves it inactive', () => {
    const next = mirrorNoticeReducer(false, { type: 'save', oldName: 'Acme Corp', newName: 'Acme Corp', preSaveQbrCount: 3 })
    expect(next).toBe(false)
  })

  it('dismiss clears an active notice', () => {
    const next = mirrorNoticeReducer(true, { type: 'dismiss' })
    expect(next).toBe(false)
  })

  it('a qualifying rename after dismissal shows the notice again', () => {
    let state = true
    state = mirrorNoticeReducer(state, { type: 'dismiss' })
    expect(state).toBe(false)
    state = mirrorNoticeReducer(state, { type: 'save', oldName: 'Acme Corp', newName: 'Acme Corp Inc', preSaveQbrCount: 1 })
    expect(state).toBe(true)
  })

  it('the QBR count used is the pre-save count even when a save changes both the name and (hypothetically) what the count would later become — the reducer only ever receives preSaveQbrCount, never a post-save value', () => {
    // Same rename, evaluated with the pre-save count of 1 (qualifies) vs. a
    // hypothetical pre-save count of 0 (does not) — demonstrating the
    // decision is entirely driven by whatever count was captured before the
    // save, exactly as saveEdit() captures client.qbrs before setClient(data).
    const withPreSaveQbrs = mirrorNoticeReducer(false, { type: 'save', oldName: 'A', newName: 'B', preSaveQbrCount: 1 })
    const withoutPreSaveQbrs = mirrorNoticeReducer(false, { type: 'save', oldName: 'A', newName: 'B', preSaveQbrCount: 0 })
    expect(withPreSaveQbrs).toBe(true)
    expect(withoutPreSaveQbrs).toBe(false)
  })

  it('rename detection is a strict string comparison — a whitespace-only difference that normalizes to the same stored string is not a rename (matches existing server/client trim normalization, not a new rule)', () => {
    // Both sides of the real comparison (client.name and data.name) are
    // always already-normalized strings by construction (both the client's
    // pre-send trim and the server's trim produce identical output for
    // whitespace-only edits), so this case never reaches the reducer as a
    // "different" name in practice. Documented here as a fixture-level
    // sanity check of the comparison's own semantics, not a new rule.
    const next = mirrorNoticeReducer(false, { type: 'save', oldName: 'Acme Corp', newName: 'Acme Corp', preSaveQbrCount: 1 })
    expect(next).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// F. QBR-history-after-client-patch fix — both PATCH-success paths merge
// the scalar-only PATCH response over previous state instead of replacing
// it, so relations the PATCH response never carries (qbrs) survive.
// ─────────────────────────────────────────────────────────────────────────

describe('page.tsx — both PATCH-success paths use a functional merge (prev first, data second)', () => {
  const MERGE_PATTERN = /setClient\(\(prev: any\) => \(\{ \.\.\.prev, \.\.\.data \}\)\)/

  it('saveEdit() merges with prev spread before data, never the reverse order', () => {
    const saveEditSource = extractSaveEdit()
    expect(saveEditSource).toMatch(MERGE_PATTERN)
    expect(saveEditSource).not.toMatch(/setClient\(\(prev: any\) => \(\{ \.\.\.data, \.\.\.prev \}\)\)/)
  })

  it('the QBR Schedule "Save date" quick-editor also merges with prev spread before data', () => {
    const anchor = 'nextQbrDate: form.nextQbrDate ? new Date(form.nextQbrDate).toISOString() : null'
    const anchorIdx = pageSource.indexOf(anchor)
    expect(anchorIdx).toBeGreaterThan(-1)
    const startIdx = pageSource.lastIndexOf('onClick={async () => {', anchorIdx)
    const endIdx   = pageSource.indexOf('disabled={saving}', anchorIdx)
    const quickEditorHandler = pageSource.slice(startIdx, endIdx)
    expect(quickEditorHandler).toMatch(MERGE_PATTERN)
    expect(quickEditorHandler).not.toMatch(/setClient\(\(prev: any\) => \(\{ \.\.\.data, \.\.\.prev \}\)\)/)
  })

  it('the initial GET effect does NOT use the merge form — a full replacement is correct there, since the GET response already carries the complete Client detail shape including qbrs', () => {
    const effectBody = pageSource.slice(
      pageSource.indexOf('useEffect(() => {'),
      pageSource.indexOf('}, [params.id])')
    )
    expect(effectBody).not.toMatch(MERGE_PATTERN)
    expect(effectBody).toMatch(/setClient\(data\)/)
  })

  it('the PATCH API route itself is untouched — no include: { qbrs } was added to prisma.client.update()', () => {
    const routeSource = readFileSync(
      join(process.cwd(), 'app/api/clients/[id]/route.ts'), 'utf-8'
    ).replace(/\r\n/g, '\n')
    const patchBody = routeSource.slice(
      routeSource.indexOf('export async function PATCH'),
      routeSource.indexOf('export async function DELETE')
    )
    expect(patchBody).not.toMatch(/include:\s*\{\s*qbrs/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// G. QBR-preservation behavioral harness — the actual merge expression,
// exercised as a pure function, proving both halves of the invariant at
// once: relations absent from the PATCH response survive, while every
// field the PATCH response DOES return stays fresh.
// ─────────────────────────────────────────────────────────────────────────

function mergeClientState(prev: any, data: any) {
  return { ...prev, ...data }
}

describe('client-state merge — qbrs survives, fresh PATCH fields win', () => {
  it('preserves prev.qbrs (absent from the PATCH response) while adopting fresh reminderStatus and industry from data', () => {
    const existingQbr = { id: 'qbr-1', quarter: '2', year: 2026, status: 'GENERATED' }
    const prev = {
      id: 'client-1',
      qbrs: [existingQbr],
      reminderStatus: 'OLD',
      industry: 'Old Industry',
      name: 'Acme',
    }
    const data = {
      id: 'client-1',
      reminderStatus: 'NEW',
      industry: 'Updated',
      name: 'Acme',
    }

    const result = mergeClientState(prev, data)

    // 1. Relations absent from PATCH survive.
    expect(result.qbrs).toBe(prev.qbrs)
    expect(result.qbrs).toEqual([existingQbr])

    // 2. Fields PATCH does return stay fresh, never the stale prev value.
    expect(result.reminderStatus).toBe('NEW')
    expect(result.industry).toBe('Updated')
  })

  it('Client.id is preserved and unchanged across the merge', () => {
    const prev = { id: 'client-1', qbrs: [{ id: 'qbr-1' }] }
    const data = { id: 'client-1', name: 'Renamed' }
    const result = mergeClientState(prev, data)
    expect(result.id).toBe('client-1')
  })

  it('a Client with zero prior QBRs still merges correctly — qbrs remains an empty array, not fabricated or dropped to undefined', () => {
    const prev = { id: 'client-1', qbrs: [] }
    const data = { id: 'client-1', name: 'Renamed' }
    const result = mergeClientState(prev, data)
    expect(result.qbrs).toEqual([])
  })

  it('the reverse spread order ({...data, ...prev}) would incorrectly resurrect stale fields — demonstrating why prev-first/data-second order is required', () => {
    const prev = { id: 'client-1', qbrs: [{ id: 'qbr-1' }], reminderStatus: 'OLD' }
    const data = { id: 'client-1', reminderStatus: 'NEW' }
    const wrongOrderResult = { ...data, ...prev }
    // The wrong order lets the stale prev.reminderStatus win — exactly the
    // regression the required ...prev, ...data order prevents.
    expect(wrongOrderResult.reminderStatus).toBe('OLD')
    const correctResult = { ...prev, ...data }
    expect(correctResult.reminderStatus).toBe('NEW')
  })
})

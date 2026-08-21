import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract tests throughout this file: they read the relevant source
// files as plain text and regex-match against them. They do NOT render
// React, do NOT invoke the route handlers, and do NOT execute
// getReminderStatus() against real data — they prove the code contains (or
// no longer contains) a given shape. Runtime behavior of getReminderStatus()
// itself is covered separately by tests/reminder-utils.test.ts (real unit
// tests against the actual function), which this change does not modify.

// Normalized to LF regardless of the checked-out line-ending style, so the
// literal multi-line toContain() checks below aren't sensitive to CRLF.
function readSourceLF(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8').replace(/\r\n/g, '\n')
}

const clientPageSource     = readSourceLF('app/(app)/dashboard/(gated)/clients/[id]/page.tsx')
const clientRouteSource    = readSourceLF('app/api/clients/[id]/route.ts')
const dashboardSource      = readSourceLF('app/(app)/dashboard/(gated)/page.tsx')
const remindersRouteSource = readSourceLF('app/api/reminders/route.ts')
const reminderUtilsSource  = readSourceLF('lib/reminder-utils.ts')
const schemaSource         = readSourceLF('prisma/schema.prisma')

// ─────────────────────────────────────────────────────────────────────────
// A. Client page — no browser-side reminder-status derivation
// ─────────────────────────────────────────────────────────────────────────

describe('client detail page — reminder status is server-authoritative, not browser-derived', () => {
  it('does NOT import getReminderStatus for runtime use', () => {
    expect(clientPageSource).not.toMatch(
      /import\s*\{[^}]*\bgetReminderStatus\b[^}]*\}\s*from\s*['"]@\/lib\/reminder-utils['"]/
    )
  })

  it('does NOT call getReminderStatus anywhere in the file', () => {
    expect(clientPageSource).not.toMatch(/getReminderStatus\(/)
  })

  it('still imports formatReminderStatus from the shared reminder-utils module', () => {
    expect(clientPageSource).toMatch(
      /import\s*\{[^}]*\bformatReminderStatus\b[^}]*\}\s*from\s*['"]@\/lib\/reminder-utils['"]/
    )
  })

  it('type-only imports ReminderStatus from the shared reminder-utils module, reusing the existing union rather than an arbitrary string type', () => {
    expect(clientPageSource).toMatch(
      /import type \{ ReminderStatus \} from ['"]@\/lib\/reminder-utils['"]/
    )
  })

  it('consumes client.reminderStatus directly and still formats it via formatReminderStatus', () => {
    expect(clientPageSource).toMatch(/formatReminderStatus\(client\.reminderStatus/)
  })

  it('does not construct new Date(client.nextQbrDate) — the conversion that existed only to feed the removed getReminderStatus() call', () => {
    expect(clientPageSource).not.toMatch(/new Date\(client\.nextQbrDate\)/)
  })

  it('the reminderDisplay line itself contains no Date/Date.now — reminder-status derivation involves zero client-side clock reads', () => {
    const line = clientPageSource.match(/^.*reminderDisplay\s*=.*$/m)?.[0] ?? ''
    expect(line).not.toBe('')
    expect(line).not.toMatch(/new Date\(/)
    expect(line).not.toMatch(/Date\.now\(/)
  })

  it('unrelated Date usage elsewhere in the page (e.g. QBR history createdAt, the edit form date field) is untouched — this file does not ban Date usage globally', () => {
    // format(new Date(qbr.createdAt), ...) is pre-existing, unrelated UI and must still be present.
    expect(clientPageSource).toMatch(/format\(new Date\(qbr\.createdAt\), 'MMM d, yyyy'\)/)
  })

  it('no longer contains the old raw 7-day millisecond threshold expression', () => {
    expect(clientPageSource).not.toMatch(/7\s*\*\s*86400000/)
  })

  it('no longer contains the old raw 30-day millisecond threshold expression', () => {
    expect(clientPageSource).not.toMatch(/30\s*\*\s*86400000/)
  })

  it('no longer contains the old direct nextQbrDate < new Date() overdue comparison', () => {
    expect(clientPageSource).not.toMatch(/new Date\(client\.nextQbrDate\)\s*<\s*new Date\(\)/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// E (partial, page-side). Scope — no extra request, no timezone policy
// ─────────────────────────────────────────────────────────────────────────

describe('client detail page — scope guardrails', () => {
  it('never fetches /api/reminders — no extra status request was introduced', () => {
    expect(clientPageSource).not.toMatch(/\/api\/reminders/)
  })

  it('fetches only the pre-existing /api/clients/[id] endpoint (GET on load, PATCH on save, PATCH from the inline reminder-date editor) — no new endpoint added', () => {
    // 3 pre-existing call sites: the initial GET, the main edit-form PATCH,
    // and the inline "update reminder date" quick-editor PATCH. All three
    // now transparently receive reminderStatus from the same route change.
    const fetchCalls = clientPageSource.match(/fetch\(`\/api\/clients\/\$\{params\.id\}`/g) ?? []
    expect(fetchCalls.length).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// B. GET /api/clients/[id]
// ─────────────────────────────────────────────────────────────────────────

describe('GET /api/clients/[id] — includes server-computed reminderStatus', () => {
  it('imports getReminderStatus from the shared reminder-utils module — reuse, not reimplementation', () => {
    expect(clientRouteSource).toMatch(
      /import\s*\{\s*getReminderStatus\s*\}\s*from\s*['"]@\/lib\/reminder-utils['"]/
    )
  })

  it('the successful GET response spreads the full client record plus reminderStatus computed from client.nextQbrDate', () => {
    expect(clientRouteSource).toContain(
      'return NextResponse.json({ ...client, reminderStatus: getReminderStatus(client.nextQbrDate) })'
    )
  })

  it('existing client fields remain returned — the response spreads ...client rather than an allowlisted subset', () => {
    expect(clientRouteSource).toMatch(/\{ \.\.\.client, reminderStatus:/)
  })

  it('does not persist reminderStatus — GET performs no database write at all', () => {
    const getBody = clientRouteSource.slice(
      clientRouteSource.indexOf('export async function GET'),
      clientRouteSource.indexOf('export async function PATCH')
    )
    expect(getBody).not.toMatch(/prisma\.client\.(update|create)/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// C. PATCH /api/clients/[id]
// ─────────────────────────────────────────────────────────────────────────

describe('PATCH /api/clients/[id] — recomputes reminderStatus so post-edit state is never stale', () => {
  it('the successful PATCH response spreads the updated client record plus reminderStatus computed from updated.nextQbrDate', () => {
    expect(clientRouteSource).toContain(
      'return NextResponse.json({ ...updated, reminderStatus: getReminderStatus(updated.nextQbrDate) })'
    )
  })

  it('PATCH computes reminderStatus from the just-updated record (updated.nextQbrDate), not a stale pre-update value or a second read', () => {
    const patchBody = clientRouteSource.slice(
      clientRouteSource.indexOf('export async function PATCH'),
      clientRouteSource.indexOf('export async function DELETE')
    )
    // Exactly one prisma.client.update call (the write) and no additional
    // prisma.client.findFirst/findUnique after it — reminderStatus is derived
    // from that same `updated` result, never a second database read.
    const updateCalls = patchBody.match(/prisma\.client\.update\(/g) ?? []
    expect(updateCalls.length).toBe(1)
    const afterUpdate = patchBody.slice(patchBody.indexOf('prisma.client.update('))
    expect(afterUpdate).not.toMatch(/prisma\.client\.find(First|Unique)\(/)
    expect(afterUpdate).toMatch(/getReminderStatus\(updated\.nextQbrDate\)/)
  })

  it('this is the mechanism that prevents stale status after editing nextQbrDate: the client page replaces its state with the PATCH response (setClient(data)), so that response must itself carry a freshly computed status', () => {
    expect(clientPageSource).toMatch(/const data = await res\.json\(\)[\s\S]{0,80}setClient\(data\)/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// D. Shared logic — lib/reminder-utils.ts and its other server callers
// ─────────────────────────────────────────────────────────────────────────

describe('lib/reminder-utils.ts — untouched by this branch', () => {
  it('getReminderStatus retains its exact original signature and threshold logic (verbatim contains-check, not just a partial match)', () => {
    expect(reminderUtilsSource).toContain(
      `export function getReminderStatus(nextQbrDate: Date | null | undefined): ReminderStatus {\n` +
      `  if (!nextQbrDate) return 'none'\n` +
      `\n` +
      `  const today = new Date()\n` +
      `  today.setHours(0, 0, 0, 0)\n` +
      `\n` +
      `  const due = new Date(nextQbrDate)\n` +
      `  due.setHours(0, 0, 0, 0)\n` +
      `\n` +
      `  const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))\n` +
      `\n` +
      `  if (diffDays < 0) return 'overdue'\n` +
      `  if (diffDays <= 7) return 'due-this-week'\n`
    )
  })

  it('the ReminderStatus union is unchanged', () => {
    expect(reminderUtilsSource).toContain(
      `export type ReminderStatus = 'overdue' | 'due-this-week' | 'due-this-month' | 'upcoming' | 'none'`
    )
  })

  it('no timezone configuration (Intl.DateTimeFormat, a timeZone option, or a TZ constant) was introduced', () => {
    expect(reminderUtilsSource).not.toMatch(/Intl\.DateTimeFormat/)
    expect(reminderUtilsSource).not.toMatch(/timeZone/)
  })
})

describe('dashboard and /api/reminders continue to compute reminderStatus server-side via the shared helper', () => {
  it('app/(app)/dashboard/page.tsx still imports and calls getReminderStatus', () => {
    expect(dashboardSource).toMatch(
      /import\s*\{[^}]*\bgetReminderStatus\b[^}]*\}\s*from\s*['"]@\/lib\/reminder-utils['"]/
    )
    expect(dashboardSource).toMatch(/getReminderStatus\(client\.nextQbrDate\)/)
  })

  it('app/api/reminders/route.ts still imports and calls getReminderStatus', () => {
    expect(remindersRouteSource).toMatch(
      /import\s*\{\s*getReminderStatus\s*\}\s*from\s*['"]@\/lib\/reminder-utils['"]/
    )
    expect(remindersRouteSource).toMatch(/getReminderStatus\(client\.nextQbrDate\)/)
  })

  it('neither the dashboard nor /api/reminders reimplements the threshold logic inline', () => {
    for (const src of [dashboardSource, remindersRouteSource]) {
      expect(src).not.toMatch(/7\s*\*\s*86400000/)
      expect(src).not.toMatch(/30\s*\*\s*86400000/)
    }
  })

  it('app/api/clients/[id]/route.ts (the newly-extended route) does not reimplement the threshold logic inline either', () => {
    expect(clientRouteSource).not.toMatch(/7\s*\*\s*86400000/)
    expect(clientRouteSource).not.toMatch(/30\s*\*\s*86400000/)
    expect(clientRouteSource).not.toMatch(/\.getMonth\(\)\s*===/) // no reimplemented same-month check
  })
})

// ─────────────────────────────────────────────────────────────────────────
// E. Persistence/scope
// ─────────────────────────────────────────────────────────────────────────

describe('scope: no persistence, no schema change, no timezone policy', () => {
  it('no reminderStatus field exists in prisma/schema.prisma', () => {
    expect(schemaSource).not.toMatch(/\breminderStatus\b/)
  })

  it('nextQbrDate remains the only reminder-relevant Client schema field, unchanged as DateTime?', () => {
    expect(schemaSource).toMatch(/nextQbrDate\s+DateTime\?/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Follow-up: response-validation holes closed (source-contract tests only —
// they read page.tsx as text and reason about statement order; they do not
// render React, do not mount the component, and do not execute the fetch
// handlers. The ordering assertions rely on ordinary JS control flow
// (an early `return`/`throw` unconditionally skips later statements in the
// same block) rather than on any runtime trace.)
// ─────────────────────────────────────────────────────────────────────────

describe('client detail page — initial GET response-boundary guard', () => {
  function extractInitialEffect(): string {
    return clientPageSource.slice(
      clientPageSource.indexOf('useEffect(() => {'),
      clientPageSource.indexOf('}, [params.id])')
    )
  }

  it('checks r.ok before calling setClient(data)', () => {
    const effectBody = extractInitialEffect()
    const okCheckIdx  = effectBody.search(/if\s*\(!r\.ok\)\s*\{/)
    const setClientIdx = effectBody.search(/setClient\(data\)/)
    expect(okCheckIdx).toBeGreaterThan(-1)
    expect(setClientIdx).toBeGreaterThan(-1)
    expect(okCheckIdx).toBeLessThan(setClientIdx)
  })

  it('the non-2xx branch returns before reaching setClient — a failed initial GET can never populate client state with the error payload', () => {
    const effectBody = extractInitialEffect()
    const notOkBlock = effectBody.match(/if\s*\(!r\.ok\)\s*\{[\s\S]*?\n\s{8}\}/)?.[0] ?? ''
    expect(notOkBlock).not.toBe('')
    expect(notOkBlock).toMatch(/return/)
    expect(notOkBlock).not.toMatch(/setClient\(/)
  })

  it('the non-2xx branch surfaces the failure via the existing error state, not a new notification mechanism', () => {
    const effectBody = extractInitialEffect()
    expect(effectBody).toMatch(/setError\(data\.error/)
  })

  it('does not fabricate a Client object or fall back to a hardcoded reminderStatus to paper over a failed load', () => {
    const effectBody = extractInitialEffect()
    expect(effectBody).not.toMatch(/reminderStatus\s*:\s*['"]none['"]/)
    expect(effectBody).not.toMatch(/\?\?\s*'none'/)
  })

  it('a failed load resolves out of the loading state into a visible error, rather than hanging on "Loading..." forever with no feedback', () => {
    expect(clientPageSource).toMatch(
      /if \(!client\) \{[\s\S]*?if \(error\) return[\s\S]*?return <div className="p-8 text-gray-400 text-sm">Loading\.\.\.<\/div>/
    )
  })
})

describe('client detail page — inline reminder-date PATCH response-boundary guard', () => {
  // The inline "Save date" quick-editor is the second of two onClick handlers
  // that PATCH /api/clients/[id] (the first is saveEdit()). Isolated here by
  // its distinguishing request-body field rather than a fragile line number,
  // so this keeps working if unrelated lines above it shift.
  function extractQuickEditorHandler(): string {
    const anchor = 'nextQbrDate: form.nextQbrDate ? new Date(form.nextQbrDate).toISOString() : null'
    const anchorIdx = clientPageSource.indexOf(anchor)
    expect(anchorIdx).toBeGreaterThan(-1)
    const startIdx = clientPageSource.lastIndexOf('onClick={async () => {', anchorIdx)
    const endIdx   = clientPageSource.indexOf('disabled={saving}', anchorIdx)
    expect(startIdx).toBeGreaterThan(-1)
    expect(endIdx).toBeGreaterThan(startIdx)
    return clientPageSource.slice(startIdx, endIdx)
  }

  it('checks res.ok before calling setClient, via the same throw-on-failure shape saveEdit() already uses', () => {
    const handler = extractQuickEditorHandler()
    const okCheckIdx   = handler.search(/if\s*\(!res\.ok\)\s*throw new Error\(data\.error\)/)
    const setClientIdx = handler.search(/setClient\(data\)/)
    expect(okCheckIdx).toBeGreaterThan(-1)
    expect(setClientIdx).toBeGreaterThan(-1)
    expect(okCheckIdx).toBeLessThan(setClientIdx)
  })

  it('wraps the request in try/catch/finally, matching the existing saveEdit() pattern', () => {
    const handler = extractQuickEditorHandler()
    expect(handler).toMatch(/try\s*\{/)
    expect(handler).toMatch(/catch\s*\(e: any\)\s*\{/)
    expect(handler).toMatch(/finally\s*\{/)
    expect(handler).toMatch(/setError\(e\.message\)/)
  })

  it('the throw on failure precedes setClient in the same try block, so a non-2xx response can never reach setClient — the previously valid client object is preserved, never overwritten with the error payload', () => {
    const handler = extractQuickEditorHandler()
    const tryBlock = handler.match(/try\s*\{[\s\S]*?\n\s*\} catch/)?.[0] ?? ''
    expect(tryBlock).not.toBe('')
    const throwIdx     = tryBlock.search(/throw new Error\(data\.error\)/)
    const setClientIdx = tryBlock.search(/setClient\(data\)/)
    expect(throwIdx).toBeGreaterThan(-1)
    expect(setClientIdx).toBeGreaterThan(-1)
    expect(throwIdx).toBeLessThan(setClientIdx)
  })

  it('does not introduce a second API call — still exactly one fetch, to the same PATCH endpoint', () => {
    const handler = extractQuickEditorHandler()
    const fetchCalls = handler.match(/fetch\(/g) ?? []
    expect(fetchCalls.length).toBe(1)
  })

  it('does not recompute reminderStatus in the browser on failure or success', () => {
    const handler = extractQuickEditorHandler()
    expect(handler).not.toMatch(/getReminderStatus\(/)
  })
})

describe('client detail page — saveEdit() protection is unchanged by this follow-up', () => {
  it('saveEdit() still checks res.ok before setClient, in the same order as before', () => {
    const saveEditSource = clientPageSource.slice(
      clientPageSource.indexOf('async function saveEdit()'),
      clientPageSource.indexOf('function cancelEdit()')
    )
    expect(saveEditSource).toContain('if (!res.ok) throw new Error(data.error)')
    const okIdx = saveEditSource.search(/if \(!res\.ok\) throw new Error\(data\.error\)/)
    const setClientIdx = saveEditSource.search(/setClient\(data\)/)
    expect(okIdx).toBeGreaterThan(-1)
    expect(setClientIdx).toBeGreaterThan(-1)
    expect(okIdx).toBeLessThan(setClientIdx)
  })
})

describe('client detail page — no new endpoints and no reintroduced browser status derivation (re-verified after the response-boundary fix)', () => {
  it('still never fetches /api/reminders', () => {
    expect(clientPageSource).not.toMatch(/\/api\/reminders/)
  })

  it('still exactly 3 fetch calls to the same /api/clients/[id] endpoint — the guards added no new endpoint or extra request', () => {
    const fetchCalls = clientPageSource.match(/fetch\(`\/api\/clients\/\$\{params\.id\}`/g) ?? []
    expect(fetchCalls.length).toBe(3)
  })

  it('still no getReminderStatus import or call anywhere in the file', () => {
    expect(clientPageSource).not.toMatch(
      /import\s*\{[^}]*\bgetReminderStatus\b[^}]*\}\s*from\s*['"]@\/lib\/reminder-utils['"]/
    )
    expect(clientPageSource).not.toMatch(/getReminderStatus\(/)
  })

  it('still no new Date()/Date.now() used to derive reminder status', () => {
    const line = clientPageSource.match(/^.*reminderDisplay\s*=.*$/m)?.[0] ?? ''
    expect(line).not.toMatch(/new Date\(/)
    expect(line).not.toMatch(/Date\.now\(/)
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Source-contract test: guards against the client detail page silently
// reintroducing its own inline reminder/status calculation instead of using
// the shared lib/reminder-utils helpers that the dashboard and
// /api/reminders already rely on.
const CLIENT_PAGE_PATH = join(process.cwd(), 'app/(app)/dashboard/clients/[id]/page.tsx')
const source = readFileSync(CLIENT_PAGE_PATH, 'utf-8')

describe('client detail page — reminder status source contract', () => {
  it('imports getReminderStatus from the shared reminder-utils module', () => {
    expect(source).toMatch(/import\s*\{[^}]*\bgetReminderStatus\b[^}]*\}\s*from\s*['"]@\/lib\/reminder-utils['"]/)
  })

  it('imports formatReminderStatus from the shared reminder-utils module', () => {
    expect(source).toMatch(/import\s*\{[^}]*\bformatReminderStatus\b[^}]*\}\s*from\s*['"]@\/lib\/reminder-utils['"]/)
  })

  it('calls the shared getReminderStatus() helper', () => {
    expect(source).toMatch(/getReminderStatus\(/)
  })

  it('calls the shared formatReminderStatus() helper', () => {
    expect(source).toMatch(/formatReminderStatus\(/)
  })

  it('no longer contains the old raw 7-day millisecond threshold expression', () => {
    expect(source).not.toMatch(/7\s*\*\s*86400000/)
  })

  it('no longer contains the old raw 30-day millisecond threshold expression', () => {
    expect(source).not.toMatch(/30\s*\*\s*86400000/)
  })

  it('no longer contains the old direct nextQbrDate < new Date() overdue comparison', () => {
    expect(source).not.toMatch(/new Date\(client\.nextQbrDate\)\s*<\s*new Date\(\)/)
  })
})

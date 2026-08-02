// lib/reminder-utils.ts

export type ReminderStatus = 'overdue' | 'due-this-week' | 'due-this-month' | 'upcoming' | 'none'

export function getReminderStatus(nextQbrDate: Date | null | undefined): ReminderStatus {
  if (!nextQbrDate) return 'none'

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const due = new Date(nextQbrDate)
  due.setHours(0, 0, 0, 0)

  const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays < 0) return 'overdue'
  if (diffDays <= 7) return 'due-this-week'

  // Due this month = same calendar month and year, not just within 30 days
  if (
    due.getMonth() === today.getMonth() &&
    due.getFullYear() === today.getFullYear()
  ) return 'due-this-month'

  return 'upcoming'
}

const QUARTER_MONTH_MAP: Record<string, { month: number; yearOffset: number }> = {
  Q1: { month: 3,  yearOffset: 0 }, // April 1
  Q2: { month: 6,  yearOffset: 0 }, // July 1
  Q3: { month: 9,  yearOffset: 0 }, // October 1
  Q4: { month: 0,  yearOffset: 1 }, // January 1 next year
}

// Accepts both bare digit ("3") and Q-prefixed ("Q3", case-insensitive) quarter
// values and normalizes them to the "Q1"-"Q4" keys used by QUARTER_MONTH_MAP.
function normalizeQuarterKey(quarter: string): string {
  const trimmed = quarter.trim().toUpperCase()
  return trimmed.startsWith('Q') ? trimmed : `Q${trimmed}`
}

export function suggestNextQbrDate(quarter: string, year: number): Date {
  const key = normalizeQuarterKey(quarter)
  // Unrecognized quarter values fall back to the Q1 default, preserving the
  // existing behavior for invalid input.
  const { month, yearOffset } = QUARTER_MONTH_MAP[key] ?? { month: 3, yearOffset: 0 }
  // Built via Date.UTC so the result is a fixed UTC-midnight instant for the
  // intended calendar date, independent of the executing server's local
  // timezone — consistent with how nextQbrDate is stored and displayed
  // elsewhere (see lib/qbr-display.ts).
  return new Date(Date.UTC(year + yearOffset, month, 1))
}

export function formatReminderStatus(status: ReminderStatus): {
  label: string
  color: string
} {
  switch (status) {
    case 'overdue':       return { label: 'Overdue',        color: 'text-red-600'    }
    case 'due-this-week': return { label: 'Due This Week',  color: 'text-orange-500' }
    case 'due-this-month':return { label: 'Due This Month', color: 'text-yellow-600' }
    case 'upcoming':      return { label: 'Upcoming',       color: 'text-green-600'  }
    case 'none':          return { label: 'Not Set',        color: 'text-gray-400'   }
  }
}

export function nextQuarterLabel(quarter: string): string {
  const map: Record<string, string> = {
    Q1: 'Q2', Q2: 'Q3', Q3: 'Q4', Q4: 'Q1',
  }
  return map[quarter.toUpperCase()] ?? 'Q1'
}
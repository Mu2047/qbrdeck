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

export function suggestNextQbrDate(quarter: string, year: number): Date {
  const map: Record<string, { month: number; yearOffset: number }> = {
    Q1: { month: 3,  yearOffset: 0 }, // April 1
    Q2: { month: 6,  yearOffset: 0 }, // July 1
    Q3: { month: 9,  yearOffset: 0 }, // October 1
    Q4: { month: 0,  yearOffset: 1 }, // January 1 next year
  }
  const q = quarter.toUpperCase()
  const { month, yearOffset } = map[q] ?? { month: 3, yearOffset: 0 }
  return new Date(year + yearOffset, month, 1)
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
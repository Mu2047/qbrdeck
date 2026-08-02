import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { getReminderStatus, suggestNextQbrDate } from '@/lib/reminder-utils'

function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day))
}

// getReminderStatus operates entirely on local-timezone Date getters
// (setHours, getMonth, getFullYear), so its day/month/year-boundary behavior
// is only deterministic if the tests fix the process timezone. Pinned to UTC
// for this describe block only, restored afterward.
function localDate(year: number, monthIndex: number, day: number, hours = 0, minutes = 0): Date {
  return new Date(year, monthIndex, day, hours, minutes)
}

describe('suggestNextQbrDate', () => {
  describe('valid quarter forms — bare digit and Q-prefixed both resolve to the same date', () => {
    it('"1" and "Q1", 2026 => April 1, 2026', () => {
      const expected = utcDate(2026, 3, 1).getTime()
      expect(suggestNextQbrDate('1', 2026).getTime()).toBe(expected)
      expect(suggestNextQbrDate('Q1', 2026).getTime()).toBe(expected)
    })

    it('"2" and "Q2", 2026 => July 1, 2026', () => {
      const expected = utcDate(2026, 6, 1).getTime()
      expect(suggestNextQbrDate('2', 2026).getTime()).toBe(expected)
      expect(suggestNextQbrDate('Q2', 2026).getTime()).toBe(expected)
    })

    it('"3" and "Q3", 2026 => October 1, 2026', () => {
      const expected = utcDate(2026, 9, 1).getTime()
      expect(suggestNextQbrDate('3', 2026).getTime()).toBe(expected)
      expect(suggestNextQbrDate('Q3', 2026).getTime()).toBe(expected)
    })

    it('"4" and "Q4", 2026 => January 1, 2027', () => {
      const expected = utcDate(2027, 0, 1).getTime()
      expect(suggestNextQbrDate('4', 2026).getTime()).toBe(expected)
      expect(suggestNextQbrDate('Q4', 2026).getTime()).toBe(expected)
    })
  })

  describe('case-insensitive Q-prefixed input', () => {
    it('accepts lowercase and mixed-case "q"-prefixed quarters', () => {
      expect(suggestNextQbrDate('q1', 2026).getTime()).toBe(utcDate(2026, 3, 1).getTime())
      expect(suggestNextQbrDate('q3', 2026).getTime()).toBe(utcDate(2026, 9, 1).getTime())
      expect(suggestNextQbrDate('Q4', 2026).getTime()).toBe(utcDate(2027, 0, 1).getTime())
    })

    it('tolerates surrounding whitespace', () => {
      expect(suggestNextQbrDate(' Q3 ', 2026).getTime()).toBe(utcDate(2026, 9, 1).getTime())
      expect(suggestNextQbrDate(' 3 ', 2026).getTime()).toBe(utcDate(2026, 9, 1).getTime())
    })
  })

  describe('UTC calendar-date behavior', () => {
    it('returns a Date whose UTC calendar fields match the intended date, independent of local timezone', () => {
      const result = suggestNextQbrDate('3', 2026)
      expect(result.getUTCFullYear()).toBe(2026)
      expect(result.getUTCMonth()).toBe(9) // October
      expect(result.getUTCDate()).toBe(1)
      expect(result.getUTCHours()).toBe(0)
      expect(result.getUTCMinutes()).toBe(0)
      expect(result.getUTCSeconds()).toBe(0)
    })

    it('rolls Q4 into January of the following year in UTC terms', () => {
      const result = suggestNextQbrDate('Q4', 2026)
      expect(result.getUTCFullYear()).toBe(2027)
      expect(result.getUTCMonth()).toBe(0) // January
      expect(result.getUTCDate()).toBe(1)
    })
  })

  describe('invalid input — existing Q1-default fallback contract preserved', () => {
    it('falls back to the Q1 default (April 1 of the given year) for an out-of-range digit', () => {
      expect(suggestNextQbrDate('5', 2026).getTime()).toBe(utcDate(2026, 3, 1).getTime())
    })

    it('falls back to the Q1 default for an empty string', () => {
      expect(suggestNextQbrDate('', 2026).getTime()).toBe(utcDate(2026, 3, 1).getTime())
    })

    it('falls back to the Q1 default for a non-numeric, non-Q value', () => {
      expect(suggestNextQbrDate('abc', 2026).getTime()).toBe(utcDate(2026, 3, 1).getTime())
    })
  })
})

describe('getReminderStatus', () => {
  let originalTZ: string | undefined

  beforeAll(() => {
    originalTZ = process.env.TZ
    process.env.TZ = 'UTC'
  })

  afterAll(() => {
    process.env.TZ = originalTZ
  })

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "none" for null and undefined', () => {
    expect(getReminderStatus(null)).toBe('none')
    expect(getReminderStatus(undefined)).toBe('none')
  })

  it('returns "overdue" for a date one day in the past', () => {
    vi.setSystemTime(localDate(2026, 0, 15, 12)) // Jan 15, 2026, noon
    expect(getReminderStatus(localDate(2026, 0, 14))).toBe('overdue')
  })

  it('returns "due-this-week" — never "overdue" — for a date due today', () => {
    vi.setSystemTime(localDate(2026, 0, 15, 18)) // late in the day
    expect(getReminderStatus(localDate(2026, 0, 15, 0))).toBe('due-this-week')
  })

  it('returns "due-this-week" for a date exactly 7 days away', () => {
    vi.setSystemTime(localDate(2026, 0, 15))
    expect(getReminderStatus(localDate(2026, 0, 22))).toBe('due-this-week')
  })

  it('returns "due-this-month" for a date 8 days away in the same calendar month', () => {
    vi.setSystemTime(localDate(2026, 0, 10))
    expect(getReminderStatus(localDate(2026, 0, 18))).toBe('due-this-month')
  })

  it('returns "upcoming" for a date within 30 days but in the next calendar month', () => {
    vi.setSystemTime(localDate(2026, 0, 25)) // Jan 25, 2026
    expect(getReminderStatus(localDate(2026, 1, 19))).toBe('upcoming') // Feb 19, 25 days away
  })

  it('returns "upcoming" for a December-to-January rollover outside the seven-day window', () => {
    vi.setSystemTime(localDate(2026, 11, 15)) // Dec 15, 2026
    expect(getReminderStatus(localDate(2027, 0, 4))).toBe('upcoming') // Jan 4, 2027, 20 days away
  })

  it('returns "upcoming" for a far-future date', () => {
    vi.setSystemTime(localDate(2026, 0, 15))
    expect(getReminderStatus(localDate(2027, 5, 1))).toBe('upcoming')
  })

  it('does not mutate the supplied Date', () => {
    vi.setSystemTime(localDate(2026, 0, 15))
    const input = localDate(2026, 0, 20, 14, 30)
    const before = input.getTime()
    getReminderStatus(input)
    expect(input.getTime()).toBe(before)
  })
})

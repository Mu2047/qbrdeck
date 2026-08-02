import { describe, it, expect } from 'vitest'
import { suggestNextQbrDate } from '@/lib/reminder-utils'

function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day))
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

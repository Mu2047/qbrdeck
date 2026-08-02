import { describe, it, expect, afterEach } from 'vitest'
import { formatQbrQuarter, formatQbrDate } from '@/lib/qbr-display'

describe('formatQbrQuarter', () => {
  it('formats a bare digit quarter and year as "Q3 2026"', () => {
    expect(formatQbrQuarter('3', 2026)).toBe('Q3 2026')
  })
})

describe('formatQbrDate', () => {
  const STORED_UTC_MIDNIGHT = '2026-10-01T00:00:00.000Z'

  it('formats an ISO UTC string in long form as "Oct 1, 2026"', () => {
    expect(formatQbrDate(STORED_UTC_MIDNIGHT, 'long')).toBe('Oct 1, 2026')
  })

  it('formats an ISO UTC string in short form as "Oct 1"', () => {
    expect(formatQbrDate(STORED_UTC_MIDNIGHT, 'short')).toBe('Oct 1')
  })

  it('defaults to long form when no style is given', () => {
    expect(formatQbrDate(STORED_UTC_MIDNIGHT)).toBe('Oct 1, 2026')
  })

  it('formats a Date object constructed at UTC midnight the same way as the equivalent string', () => {
    const date = new Date(Date.UTC(2026, 9, 1, 0, 0, 0, 0)) // month is 0-indexed: 9 = October
    expect(formatQbrDate(date, 'long')).toBe('Oct 1, 2026')
    expect(formatQbrDate(date, 'short')).toBe('Oct 1')
  })

  it('never renders Sep 30 for a 2026-10-01T00:00:00.000Z stored value', () => {
    expect(formatQbrDate(STORED_UTC_MIDNIGHT, 'long')).not.toContain('Sep 30')
    expect(formatQbrDate(STORED_UTC_MIDNIGHT, 'short')).not.toContain('Sep 30')
  })

  it('returns "—" for null, undefined, and unparseable input', () => {
    expect(formatQbrDate(null)).toBe('—')
    expect(formatQbrDate(undefined)).toBe('—')
    expect(formatQbrDate('not-a-date')).toBe('—')
    expect(formatQbrDate(new Date('invalid'))).toBe('—')
  })

  it('does not mutate a Date object passed in', () => {
    const date = new Date(Date.UTC(2026, 9, 1, 0, 0, 0, 0))
    const before = date.getTime()
    formatQbrDate(date, 'long')
    formatQbrDate(date, 'short')
    expect(date.getTime()).toBe(before)
  })

  describe('timezone independence', () => {
    const originalTZ = process.env.TZ

    afterEach(() => {
      process.env.TZ = originalTZ
    })

    it('produces the same output under America/Los_Angeles as under any other local timezone', () => {
      process.env.TZ = 'America/Los_Angeles'
      expect(formatQbrDate(STORED_UTC_MIDNIGHT, 'long')).toBe('Oct 1, 2026')
      expect(formatQbrDate(STORED_UTC_MIDNIGHT, 'short')).toBe('Oct 1')
    })
  })
})

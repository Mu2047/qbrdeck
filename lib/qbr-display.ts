// Shared display formatting for QBR schedule dates and quarter labels.
//
// nextQbrDate is stored as a UTC instant representing a calendar date, not a
// point in time. Formatting it with a locale-aware formatter that reads the
// environment's local timezone (e.g. date-fns' format()) shifts the
// displayed day backward by one for any negative UTC-offset timezone. These
// formatters read UTC calendar fields explicitly so the displayed date is
// identical regardless of where the code runs (server, browser, any TZ).

const LONG_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
})

export type QbrDateStyle = 'long' | 'short'

/**
 * Formats a QBR quarter/year pair as "Q3 2026".
 * `quarter` is the bare digit string stored on the QBR record (e.g. "3").
 */
export function formatQbrQuarter(quarter: string | number, year: string | number): string {
  return `Q${quarter} ${year}`
}

/**
 * Formats a date-only value (string or Date) using its UTC calendar date,
 * so a stored value like 2026-10-01T00:00:00.000Z always displays as
 * Oct 1, regardless of the local timezone of the browser or server.
 *
 * style 'long'  => "Oct 1, 2026"
 * style 'short' => "Oct 1"
 *
 * Returns '—' for null/undefined/unparseable input.
 */
export function formatQbrDate(input: string | Date | null | undefined, style: QbrDateStyle = 'long'): string {
  if (input === null || input === undefined) return '—'

  const date = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(date.getTime())) return '—'

  const formatter = style === 'short' ? SHORT_DATE_FORMATTER : LONG_DATE_FORMATTER
  return formatter.format(date)
}

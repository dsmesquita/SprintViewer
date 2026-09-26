import type { ISODate, SprintDay } from './types'

/**
 * Date helpers. Everything is a local calendar date — no times, no timezones. Parsing goes
 * through the local-component constructor rather than `new Date(string)`, which would treat
 * `YYYY-MM-DD` as UTC and shift the day for anyone west of Greenwich.
 */

export function toISO(date: Date): ISODate {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function fromISO(iso: ISODate): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function todayISO(): ISODate {
  return toISO(new Date())
}

export function addDays(iso: ISODate, days: number): ISODate {
  const date = fromISO(iso)
  date.setDate(date.getDate() + days)
  return toISO(date)
}

/** The Monday of the week `iso` falls in. Sunday counts as the end of the previous week. */
export function startOfWeek(iso: ISODate): ISODate {
  const day = fromISO(iso).getDay()
  return addDays(iso, day === 0 ? -6 : 1 - day)
}

export function isWeekend(iso: ISODate): boolean {
  const day = fromISO(iso).getDay()
  return day === 0 || day === 6
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Mon 31/08" — matches the day headers in the sprint template. */
export function formatDayHeader(iso: ISODate): string {
  const date = fromISO(iso)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${WEEKDAYS[date.getDay()]} ${day}/${month}`
}

/** "31 Aug – 11 Sep" */
export function formatRange(from: ISODate, to: ISODate): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const a = fromISO(from)
  const b = fromISO(to)
  return `${a.getDate()} ${months[a.getMonth()]} – ${b.getDate()} ${months[b.getMonth()]}`
}

/**
 * Build the day columns for a sprint starting on `start`.
 *
 * @param weeks Sprint length in weeks.
 * @param includeWeekends When false (the default) Saturdays and Sundays are left out
 *   entirely rather than added as zero-capacity columns.
 */
export function buildSprintDays(
  start: ISODate,
  weeks: number,
  hoursPerDay: number,
  includeWeekends = false
): SprintDay[] {
  const days: SprintDay[] = []
  for (let offset = 0; offset < weeks * 7; offset++) {
    const date = addDays(start, offset)
    if (!includeWeekends && isWeekend(date)) continue
    days.push({ date, capacity: hoursPerDay })
  }
  return days
}

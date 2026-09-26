import type { ISODate } from '../types'

/** Time already taken on a day, and the gaps left between it — in hours from the start of the day. */

export interface Interval {
  start: number
  end: number
}

/** The parts of a day that are inside capacity and not already taken, left to right. */
export function freeIntervals(capacity: number, taken: Interval[] | undefined): Interval[] {
  if (!taken || taken.length === 0) return [{ start: 0, end: capacity }]

  const gaps: Interval[] = []
  let cursor = 0
  for (const interval of [...taken].sort((a, b) => a.start - b.start)) {
    if (interval.start > cursor)
      gaps.push({ start: cursor, end: Math.min(interval.start, capacity) })
    cursor = Math.max(cursor, interval.end)
    if (cursor >= capacity) break
  }
  if (cursor < capacity) gaps.push({ start: cursor, end: capacity })
  return gaps.filter((gap) => gap.end > gap.start)
}

/** Marks `interval` of `date` as taken. */
export function claim(occupied: Map<ISODate, Interval[]>, date: ISODate, interval: Interval): void {
  const existing = occupied.get(date)
  if (existing) existing.push(interval)
  else occupied.set(date, [interval])
}

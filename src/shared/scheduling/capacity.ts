import { clamp } from '../math'
import type { ISODate, Sprint } from '../types'

/** Hours this person can work on this day, after the sprint-wide and personal overrides. */
export function effectiveCapacity(sprint: Sprint, memberId: string, date: ISODate): number {
  const day = sprint.days.find((d) => d.date === date)
  if (!day) return 0
  const override = sprint.capacityOverrides[memberId]?.[date]
  const capacity = override === undefined ? day.capacity : Math.min(day.capacity, override)
  return clamp(capacity, 0, sprint.hoursPerDay)
}

/** True when the day is off for the whole team, as opposed to just this person. */
export function isDayDisabledForAll(sprint: Sprint, date: ISODate): boolean {
  return (sprint.days.find((d) => d.date === date)?.capacity ?? 0) <= 0
}

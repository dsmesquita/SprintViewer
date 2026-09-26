import type { ISODate, Segment, Sprint } from '../types'
import { layoutMember, layoutSprint } from './layout'

/**
 * Writing the past down: the record a refresh keeps, and the older plan snapshots.
 */

/**
 * The reported hours drawn on each day before the anchor, per person — what a refresh stores
 * as {@link Sprint.pastRecord}. Pieces that ran onto today are left out: today is not over.
 */
export function recordPast(
  sprint: Sprint,
  anchor: ISODate
): Record<string, Record<ISODate, Segment[]>> {
  const record: Record<string, Record<ISODate, Segment[]>> = {}
  for (const [memberId, layout] of Object.entries(layoutSprint(sprint, anchor))) {
    const byDate: Record<ISODate, Segment[]> = {}
    for (const segment of layout.segments) {
      if (segment.date >= anchor || !(segment.isDone || segment.fromHistory)) continue
      const { doneOverflow: _overflow, fromHistory: _history, pinned: _pinned, ...piece } = segment
      const day = (byDate[segment.date] ??= [])
      day.push({ ...piece, blockId: `done:${segment.workItemId}`, isDone: true })
    }
    record[memberId] = byDate
  }
  return record
}

/**
 * Snapshot the days before `anchor` so they stop being re-flowed.
 *
 * Called at each refresh: the days that have passed keep showing what was scheduled at the
 * time, while the hours still remaining in TFS re-flow forward from the anchor. A block can
 * therefore appear both in history and ahead of the anchor — that is the point, since work
 * carried over is exactly what a partially finished task looks like.
 */
export function freezeHistoryBefore(
  sprint: Sprint,
  anchor: ISODate
): Record<string, Record<ISODate, Segment[]>> {
  const first = sprint.days[0]?.date
  if (!first) return {}
  const history: Record<string, Record<ISODate, Segment[]>> = {}

  for (const member of sprint.members) {
    const previous = sprint.history[member.id] ?? {}
    // Flow from the top of the sprint so the past is laid out, then keep only the past.
    const { segments } = layoutMember({ ...sprint, history: {} }, member.id, first)
    // Pinned blocks are already an explicit record of the past, so snapshotting them too
    // would show the same work twice.
    const flowed = segments.filter((segment) => !segment.pinned && !segment.fromHistory)
    const byDate: Record<ISODate, Segment[]> = {}
    for (const day of sprint.days) {
      if (day.date >= anchor) break
      byDate[day.date] = previous[day.date] ?? flowed.filter((s) => s.date === day.date)
    }
    history[member.id] = byDate
  }
  return history
}

import { round } from '../math'
import { completedHours } from '../sizing'
import type { ISODate, Segment, Sprint } from '../types'

/**
 * The recorded past as it should be drawn now.
 *
 * Two things can overrule it. A reported pin: dragging a task's done hours is the user saying
 * where they belong, so that task's recorded pieces give way and are drawn from the pin. And
 * TFS itself: when Completed Work goes *down* — a typo corrected — the record cannot go on
 * showing hours nobody reports, so the most recent of them are dropped. Nothing else moves.
 */
export function liveRecord(
  sprint: Sprint,
  anchor: ISODate
): Record<string, Record<ISODate, Segment[]>> {
  if (!sprint.pastRecord) return {}
  const all: Array<{ memberId: string; piece: Segment }> = []
  for (const [memberId, byDate] of Object.entries(sprint.pastRecord)) {
    for (const [date, pieces] of Object.entries(byDate)) {
      if (date >= anchor) continue
      for (const piece of pieces) all.push({ memberId, piece })
    }
  }
  all.sort(
    (a, b) => a.piece.date.localeCompare(b.piece.date) || a.piece.startHour - b.piece.startHour
  )

  const used = new Map<number, number>()
  const out: Record<string, Record<ISODate, Segment[]>> = {}
  // Done hours kept in the backlog are drawn nowhere, the record included, until placed.
  const waiting = new Set(sprint.doneInBacklog ?? [])
  for (const { memberId, piece } of all) {
    if (sprint.reportedPins?.[piece.workItemId] || waiting.has(piece.workItemId)) continue
    const allowed = completedHours(sprint.workItems[piece.workItemId])
    let hours = piece.hours
    if (allowed !== undefined) {
      const room = round(allowed - (used.get(piece.workItemId) ?? 0))
      if (room <= 0) continue
      hours = Math.min(hours, room)
    }
    used.set(piece.workItemId, round((used.get(piece.workItemId) ?? 0) + hours))
    const byDate = (out[memberId] ??= {})
    const day = (byDate[piece.date] ??= [])
    day.push({ ...piece, hours, isDone: true, fromHistory: undefined })
  }
  return out
}

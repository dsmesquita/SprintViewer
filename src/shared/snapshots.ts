import { layoutSprint } from './scheduling'
import type { ISODate, Sprint } from './types'

/**
 * Keeping a copy of the board as it stood, and saying what has changed since.
 *
 * The useful question mid-sprint is not "what does the plan say" but "what has moved since we
 * agreed it". That needs the plan as it was on planning day, which is otherwise gone the
 * moment somebody drags anything.
 */

export interface SnapshotMeta {
  id: string
  sprintId: string
  name: string
  /** ISO timestamp of when it was taken. */
  takenAt: string
  /**
   * `baseline` for the one the app keeps automatically as the sprint's plan — see
   * `baseline.ts`. Taken by hand otherwise, including every snapshot from before this existed.
   */
  kind?: 'manual' | 'baseline'
}

export interface Snapshot extends SnapshotMeta {
  sprint: Sprint
}

export type ChangeKind = 'moved' | 'slipped' | 'pulled' | 'grew' | 'shrank' | 'gone' | 'added'

export interface Change {
  workItemId: number
  title: string
  kinds: ChangeKind[]
  /** Human-readable account, e.g. "Diogo -> Beatriz" or "8h -> 12h". */
  detail: string
}

interface Placement {
  memberId: string
  memberName: string
  date: ISODate
  hours: number
}

/** Where each work item sits on a board, and how much of it there is. */
function placements(sprint: Sprint, anchor: ISODate): Map<number, Placement> {
  const names = new Map(sprint.members.map((m) => [m.id, m.name]))
  const found = new Map<number, Placement>()

  for (const [memberId, layout] of Object.entries(layoutSprint(sprint, anchor))) {
    for (const segment of layout.segments) {
      // History and reported hours are records of the past, not the plan. Comparing them
      // would report a change every time a day rolls over, which is noise, not drift.
      if (segment.fromHistory || segment.isDone) continue
      const existing = found.get(segment.workItemId)
      if (!existing) {
        found.set(segment.workItemId, {
          memberId,
          memberName: names.get(memberId) ?? memberId,
          date: segment.date,
          hours: segment.hours
        })
        continue
      }
      // One work item, however many blocks it is split into: earliest position, total hours.
      existing.hours = round(existing.hours + segment.hours)
      if (segment.date < existing.date) {
        existing.date = segment.date
        existing.memberId = memberId
        existing.memberName = names.get(memberId) ?? memberId
      }
    }
  }
  return found
}

/**
 * What differs between a snapshot and the board as it stands now.
 *
 * Compared per work item rather than per block: a task split in two is still one task, and
 * reporting it twice would make a tidy split look like a problem.
 */
export function diffSprints(before: Sprint, after: Sprint, anchor: ISODate): Change[] {
  const was = placements(before, anchor)
  const now = placements(after, anchor)
  const changes: Change[] = []

  for (const [workItemId, then] of was) {
    const title = titleOf(after, before, workItemId)
    const current = now.get(workItemId)
    if (!current) {
      changes.push({ workItemId, title, kinds: ['gone'], detail: 'no longer on the board' })
      continue
    }

    const kinds: ChangeKind[] = []
    const detail: string[] = []
    if (current.memberId !== then.memberId) {
      kinds.push('moved')
      detail.push(`${then.memberName} → ${current.memberName}`)
    }
    if (current.date !== then.date) {
      kinds.push(current.date > then.date ? 'slipped' : 'pulled')
      detail.push(`${then.date} → ${current.date}`)
    }
    if (current.hours !== then.hours) {
      kinds.push(current.hours > then.hours ? 'grew' : 'shrank')
      detail.push(`${then.hours}h → ${current.hours}h`)
    }
    if (kinds.length > 0) changes.push({ workItemId, title, kinds, detail: detail.join(' · ') })
  }

  for (const [workItemId, current] of now) {
    if (was.has(workItemId)) continue
    changes.push({
      workItemId,
      title: titleOf(after, before, workItemId),
      kinds: ['added'],
      detail: `now on ${current.memberName}`
    })
  }

  return changes.sort((a, b) => a.workItemId - b.workItemId)
}

function titleOf(after: Sprint, before: Sprint, workItemId: number): string {
  return after.workItems[workItemId]?.title ?? before.workItems[workItemId]?.title ?? ''
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

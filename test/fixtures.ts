import { buildSprintDays } from '../src/shared/dates'
import { layoutSprint } from '../src/shared/scheduling'
import type { Block, Member, Sprint, WorkItem } from '../src/shared/types'

/**
 * Builders for test sprints. Every sprint here starts on **Monday 14 Sep 2026**, runs two
 * weeks of 8-hour weekdays (14–18 and 21–25 Sep), and has two people, Diogo and Sofia.
 */

export const MON = '2026-09-14'
export const TUE = '2026-09-15'
export const WED = '2026-09-16'
export const THU = '2026-09-17'
export const FRI = '2026-09-18'
export const MON2 = '2026-09-21'
export const FRI2 = '2026-09-25'

export const DIOGO: Member = { id: 'diogo', name: 'Diogo', tfsIdentity: 'Diogo Mesquita', order: 0 }
export const SOFIA: Member = { id: 'sofia', name: 'Sofia', tfsIdentity: 'Sofia Marques', order: 1 }

/** A Task work item; anything not given is an active task with nothing left. */
export function item(id: number, fields: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    title: `Task ${id}`,
    type: 'Task',
    state: 'Active',
    url: `https://tfs.example/tfs/Coll/Proj/_workitems/edit/${id}`,
    remainingWork: 0,
    ...fields
  }
}

/** A block of `hours` for work item `workItemId`, optionally pinned. */
export function block(
  id: string,
  workItemId: number,
  hours: number,
  pin?: { date: string; startHour: number }
): Block {
  return pin ? { id, workItemId, hours, pin } : { id, workItemId, hours }
}

export interface SprintOptions extends Partial<Omit<Sprint, 'workItems' | 'queues'>> {
  items?: WorkItem[]
  queues?: Record<string, Block[]>
}

export function sprint(options: SprintOptions = {}): Sprint {
  const { items = [], queues = {}, ...rest } = options
  const members = rest.members ?? [DIOGO, SOFIA]
  return {
    id: 'test',
    name: 'Test sprint',
    days: buildSprintDays(MON, 2, 8),
    hoursPerDay: 8,
    members,
    capacityOverrides: {},
    backlog: [],
    notes: [],
    history: {},
    ...rest,
    queues: { ...Object.fromEntries(members.map((m) => [m.id, []])), ...queues },
    workItems: Object.fromEntries(items.map((i) => [i.id, i]))
  }
}

/**
 * A person's calendar as short strings, sorted: `"09-14@0+8"` is 8 hours from hour 0 on
 * 14 Sep; `" done"` marks reported hours and `" hist"` a replayed snapshot.
 */
export function drawn(s: Sprint, anchor: string, memberId = 'diogo', blockId?: string): string[] {
  return layoutSprint(s, anchor)
    [memberId].segments.filter((x) => blockId === undefined || x.blockId === blockId)
    .map(
      (x) =>
        `${x.date.slice(5)}@${x.startHour}+${x.hours}${x.isDone ? ' done' : ''}${x.fromHistory ? ' hist' : ''}`
    )
    .sort()
}

/** A counter-based id generator, so split results are predictable. */
export function ids(prefix = 'n'): () => string {
  let n = 0
  return () => `${prefix}${++n}`
}

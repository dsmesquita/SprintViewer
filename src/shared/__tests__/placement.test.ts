import { checklist } from '../../../test/checklist'
import { buildSprintDays } from '@shared/dates'
import { alignReportedOnly, applyRefresh } from '@shared/refresh'
import { layoutSprint } from '@shared/scheduling'
import type { Block, Sprint, WorkItem } from '@shared/types'

/** Completed work belongs behind today; remaining work belongs from today on. */

const { check, report } = checklist()
const J = JSON.stringify
const ANCHOR = '2026-09-16' // Wednesday: Mon and Tue have passed

const wi = (id: number, fields: Partial<WorkItem>): WorkItem =>
  ({
    id,
    title: `Task ${id}`,
    type: 'Task',
    state: 'Active',
    url: '',
    remainingWork: 0,
    ...fields
  }) as WorkItem
const b = (id: string, workItemId: number, hours: number, pin?: Block['pin']): Block => ({
  id,
  workItemId,
  hours,
  pin
})

function sprintWith(
  items: WorkItem[],
  queues: Record<string, Block[]>,
  extra: Partial<Sprint> = {}
): Sprint {
  return {
    id: 's',
    name: 'S',
    days: buildSprintDays('2026-09-14', 2, 8),
    hoursPerDay: 8,
    members: [{ id: 'diogo', name: 'Diogo', tfsIdentity: 'Diogo Mesquita', order: 0 }],
    capacityOverrides: {},
    queues: { diogo: [], ...queues },
    backlog: [],
    workItems: Object.fromEntries(items.map((i) => [i.id, i])),
    notes: [],
    history: {},
    ...extra
  }
}
const show = (s: Sprint, anchor = ANCHOR) =>
  layoutSprint(s, anchor)
    .diogo.segments.map(
      (x) => `${x.date.slice(5)}@${x.startHour}+${x.hours}${x.isDone ? ' done' : ''}`
    )
    .sort()

// ---- Part done: the two halves sit either side of today ----
{
  const s = sprintWith([wi(1, { remainingWork: 3, completedWork: 5 })], { diogo: [b('b1', 1, 3)] })
  const segs = layoutSprint(s, ANCHOR).diogo.segments
  const done = segs.filter((x) => x.isDone)
  const ahead = segs.filter((x) => !x.isDone)
  check(
    'completed hours are drawn before today',
    done.reduce((t, x) => t + x.hours, 0) === 5 && done.every((x) => x.date < ANCHOR),
    done
  )
  check(
    'remaining hours are drawn from today on',
    ahead.reduce((t, x) => t + x.hours, 0) === 3 && ahead.every((x) => x.date >= ANCHOR),
    ahead
  )
  check(
    'one task, drawn as two pieces either side of today',
    J(show(s)) === J(['09-14@0+5 done', '09-16@0+3']),
    show(s)
  )
}

// ---- Nothing left: no block ahead of today at all ----
{
  const closed = wi(2, {
    remainingWork: 0,
    completedWork: 9,
    state: 'Closed',
    assignedTo: 'Diogo Mesquita'
  })
  const stale = sprintWith([closed], { diogo: [b('old', 2, 9)] }) // a board built under the old rule
  const before = layoutSprint(stale, ANCHOR).diogo.segments
  check(
    'a board from before the rule would draw those hours twice',
    before.filter((x) => x.date >= ANCHOR && !x.isDone).length > 0 && before.some((x) => x.isDone),
    before
  )

  const { sprint: fixed, removed } = alignReportedOnly(stale, ANCHOR)
  check('opening the sprint takes the block away', removed === 1 && fixed.queues.diogo.length === 0)
  check(
    'and the nine hours are drawn behind today, once',
    J(show(fixed)) === J(['09-14@0+8 done', '09-15@0+1 done']),
    show(fixed)
  )

  // With no block anywhere, TFS's assignee is what says whose hours they were.
  const never = sprintWith([closed], {})
  check(
    'a task finished before anyone scheduled it still shows, on its assignee',
    show(never).join(' ').includes('done') &&
      layoutSprint(never, ANCHOR).diogo.segments.every((x) => x.date < ANCHOR),
    show(never)
  )
}

// ---- A pin in the past is kept: it is the user speaking ----
{
  const pinned = sprintWith([wi(3, { remainingWork: 4, completedWork: 0 })], {
    diogo: [b('p', 3, 4, { date: '2026-09-15', startHour: 2 })]
  })
  check(
    'remaining hours pinned to a past day stay there',
    J(show(pinned)) === J(['09-15@2+4']),
    show(pinned)
  )
}

// ---- More reported than the past can hold: the rest lands on today ----
{
  // Only Monday has passed, and 12 hours are reported against a task with 2 left.
  const anchor = '2026-09-15'
  const s = sprintWith([wi(4, { remainingWork: 2, completedWork: 12 })], { diogo: [b('b4', 4, 2)] })
  const layout = layoutSprint(s, anchor).diogo
  const done = layout.segments.filter((x) => x.isDone)
  const ahead = layout.segments.filter((x) => !x.isDone)
  check(
    'the past is filled first',
    done.filter((x) => x.date < anchor).reduce((t, x) => t + x.hours, 0) === 8,
    done
  )
  check(
    'the rest lands at the start of today',
    J(done.filter((x) => x.date === anchor).map((x) => `${x.startHour}+${x.hours}`)) === J(['0+4']),
    done
  )
  check(
    "and today's work is pushed along behind it",
    J(ahead.map((x) => `${x.date.slice(5)}@${x.startHour}+${x.hours}`)) === J(['09-15@4+2']),
    ahead
  )
  check(
    'those hours are not offered as free time',
    layout.availableHours === 8 * 9 - 4 && layout.spillover === 0,
    [layout.availableHours, layout.spillover]
  )
  check(
    'nothing is reported as unshown',
    layout.reportedOverflow.length === 0,
    layout.reportedOverflow
  )

  // More than the past and today together can hold: the rest is reported as unshown.
  const huge = sprintWith(
    [wi(5, { remainingWork: 0, completedWork: 30, assignedTo: 'Diogo Mesquita' })],
    {}
  )
  const over = layoutSprint(huge, anchor).diogo
  check(
    'more than past and today can hold → the remainder is flagged, not hidden',
    over.reportedOverflow.length === 1 && over.reportedOverflow[0].hours === 30 - 16,
    over.reportedOverflow
  )
}

// ---- Through a refresh: a task that has just been finished ----
{
  const s = sprintWith([wi(6, { remainingWork: 8, completedWork: 0 })], { diogo: [b('b6', 6, 8)] })
  const after = applyRefresh(
    s,
    [wi(6, { remainingWork: 0, completedWork: 8, state: 'Closed' })],
    ANCHOR,
    () => 'n'
  )
  check(
    'finishing a task takes it off the days ahead and draws it behind today',
    after.sprint.queues.diogo.length === 0 &&
      layoutSprint(after.sprint, ANCHOR).diogo.segments.every((x) => x.date < ANCHOR),
    show(after.sprint)
  )

  // One the user had pinned to the day it was worked keeps that day, as a reported pin.
  const byHand = sprintWith([wi(7, { remainingWork: 4, completedWork: 4 })], {
    diogo: [b('p7', 7, 4, { date: '2026-09-15', startHour: 1 })]
  })
  const finished = applyRefresh(
    byHand,
    [wi(7, { remainingWork: 0, completedWork: 6 })],
    ANCHOR,
    () => 'n'
  )
  check(
    'a block pinned to a past day becomes recorded hours, in the same slot',
    finished.sprint.queues.diogo.length === 0 &&
      finished.sprint.pastRecord?.diogo?.['2026-09-15']?.some(
        (p) => p.workItemId === 7 && p.startHour === 1
      ) === true,
    finished.sprint.pastRecord
  )
  check(
    'and the hours are drawn from there',
    show(finished.sprint).some((x) => x.startsWith('09-15@1+') && x.endsWith('done')),
    show(finished.sprint)
  )
}

report()

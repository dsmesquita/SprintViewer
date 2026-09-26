import { checklist } from '../../../test/checklist'
import { buildSprintDays } from '@shared/dates'
import { applyRefresh } from '@shared/refresh'
import { layoutSprint } from '@shared/scheduling'
import { hasNoSize, isOffTrack, plannedHours, reportedHours, sizeOf } from '@shared/sizing'
import type { Block, Sprint, WorkItem } from '@shared/types'

/** A task is worth Remaining + Completed, wherever it sits. The estimate sizes nothing. */

const { check, report } = checklist()
const J = JSON.stringify
const ANCHOR = '2026-09-16'

const wi = (fields: Partial<WorkItem>): WorkItem =>
  ({
    id: 1,
    title: 'T',
    type: 'Task',
    state: 'Active',
    url: '',
    remainingWork: 0,
    ...fields
  }) as WorkItem
const total = (item: WorkItem) => plannedHours(item) + reportedHours(item)

// ---- The rule ----
const cases: Array<[string, Partial<WorkItem>, number, number]> = [
  // description, fields, size on the board, of which drawn as already done
  ['nothing reported yet', { remainingWork: 8, completedWork: 0, originalEstimate: 12 }, 8, 0],
  ['part done', { remainingWork: 3, completedWork: 5, originalEstimate: 6 }, 8, 5],
  [
    'nothing left, hours reported',
    { remainingWork: 0, completedWork: 7, originalEstimate: 4 },
    7,
    7
  ],
  [
    'nothing left, nothing reported',
    { remainingWork: 0, completedWork: 0, originalEstimate: 6 },
    0,
    0
  ],
  ['no hours anywhere', { remainingWork: 0 }, 0, 0],
  [
    'server without Completed Work',
    { remainingWork: 5, completedWork: undefined, originalEstimate: 9 },
    5,
    0
  ],
  ['overrun', { remainingWork: 3, completedWork: 20, originalEstimate: 8 }, 23, 20]
]
for (const [name, fields, size, done] of cases) {
  const item = wi(fields)
  check(
    `size: ${name} → ${size}h (${done}h of it already done)`,
    total(item) === size && reportedHours(item) === done,
    { size: sizeOf(item), total: total(item) }
  )
}
check(
  'the estimate never changes the size',
  cases.every(([, fields]) => total(wi({ ...fields, originalEstimate: 999 })) === total(wi(fields)))
)
check(
  'nothing left and nothing reported has no size at all',
  hasNoSize(wi({ remainingWork: 0, originalEstimate: 6 }))
)

// ---- Off track, the estimate's only job ----
const off: Array<[string, Partial<WorkItem>, boolean]> = [
  ['spent exactly a quarter more', { originalEstimate: 8, completedWork: 10 }, false],
  ['spent a shade over a quarter more', { originalEstimate: 8, completedWork: 10.5 }, true],
  ['spent less than estimated', { originalEstimate: 8, completedWork: 4 }, false],
  ['no estimate to judge against', { originalEstimate: 0, completedWork: 40 }, false],
  ['estimate not tracked', { completedWork: 40 }, false],
  ['nothing reported', { originalEstimate: 8 }, false]
]
for (const [name, fields, expected] of off) {
  check(`off track: ${name} → ${expected}`, isOffTrack(wi(fields)) === expected, fields)
}

// ---- Through a refresh, split across the calendar and the backlog ----
function sprintWith(item: WorkItem, queue: Block[], backlog: Block[]): Sprint {
  return {
    id: 's',
    name: 'S',
    days: buildSprintDays('2026-09-14', 2, 8),
    hoursPerDay: 8,
    members: [{ id: 'diogo', name: 'Diogo', order: 0 }],
    capacityOverrides: {},
    queues: { diogo: queue },
    backlog,
    workItems: { [item.id]: item },
    notes: [],
    history: {}
  }
}
const split = sprintWith(
  wi({ remainingWork: 6, completedWork: 4, originalEstimate: 5 }),
  [{ id: 'cal', workItemId: 1, hours: 3 }],
  [{ id: 'bag', workItemId: 1, hours: 3 }]
)
const grown = applyRefresh(
  split,
  [wi({ remainingWork: 8, completedWork: 6, originalEstimate: 5 })],
  ANCHOR,
  () => 'n'
)
const onCalendar = grown.sprint.queues.diogo.reduce((t, x) => t + x.hours, 0)
const inBacklog = grown.sprint.backlog.reduce((t, x) => t + x.hours, 0)
check(
  'split across calendar and backlog: the two sum to the remaining work',
  onCalendar + inBacklog === 8,
  { onCalendar, inBacklog }
)
// The 6 completed hours are drawn on the days that have passed — partly as the frozen record
// of what was worked, partly as the hatched ribbon for the rest, never as both.
const drawn = layoutSprint(grown.sprint, ANCHOR).diogo.segments
const alreadyDone = drawn.filter((s) => s.date < ANCHOR).reduce((t, s) => t + s.hours, 0)
check(
  'and the board draws remaining + completed in total',
  alreadyDone === 6 && onCalendar + inBacklog + alreadyDone === 14,
  { onCalendar, inBacklog, alreadyDone, drawn }
)

// A task closed with nothing reported: it leaves the board rather than keeping its estimate.
const closed = applyRefresh(
  sprintWith(
    wi({ remainingWork: 6, completedWork: 0, originalEstimate: 6 }),
    [{ id: 'c', workItemId: 1, hours: 6 }],
    []
  ),
  [wi({ remainingWork: 0, completedWork: 0, originalEstimate: 6, state: 'Closed' })],
  ANCHOR,
  () => 'n'
)
check(
  'closed with nothing reported → off the calendar, counted as finished',
  closed.sprint.queues.diogo.length === 0 && closed.summary.completed === 1,
  closed.summary
)

// An estimate alone is no longer a size: such a task arrives with no hours.
const estimateOnly = applyRefresh(
  sprintWith(wi({ id: 2, remainingWork: 0, completedWork: 0, originalEstimate: 9 }), [], []),
  [wi({ id: 3, title: 'New', remainingWork: 0, completedWork: 0, originalEstimate: 9 })],
  ANCHOR,
  () => 'new'
)
check(
  'a new task with only an estimate arrives with no hours',
  J(estimateOnly.sprint.backlog.map((x) => x.hours)) === '[0]',
  estimateOnly.sprint.backlog
)
const reportedOnlyNew = applyRefresh(
  sprintWith(wi({ id: 2, remainingWork: 0, completedWork: 0 }), [], []),
  [wi({ id: 4, title: 'Done elsewhere', remainingWork: 0, completedWork: 5 })],
  ANCHOR,
  () => 'new2'
)
// Already done when it arrives: nothing to plan, so no card. Its five hours are drawn on the
// days they were worked, like every other reported hour.
check(
  'a task that arrives already done gets no backlog card',
  reportedOnlyNew.sprint.backlog.length === 0,
  reportedOnlyNew.sprint.backlog
)

report()

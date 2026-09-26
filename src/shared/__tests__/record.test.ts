import { checklist } from '../../../test/checklist'
import { buildSprintDays } from '@shared/dates'
import { clearCalendar, pinReportedAt, setHoursPerDay } from '@shared/mutations'
import { applyRefresh } from '@shared/refresh'
import { layoutSprint, recordPast } from '@shared/scheduling'
import type { Sprint, WorkItem } from '@shared/types'

/** Days behind today are a record: refreshes add to them, oldest gap first, and never redraw. */

const { check, report } = checklist()
const J = JSON.stringify

const wi = (id: number, f: Partial<WorkItem>): WorkItem =>
  ({
    id,
    title: 'T' + id,
    type: 'Task',
    state: 'Active',
    url: '',
    remainingWork: 8,
    assignedTo: 'Diogo Mesquita',
    ...f
  }) as WorkItem
const base = (): Sprint => ({
  id: 's',
  name: 'S',
  days: buildSprintDays('2026-09-14', 2, 8),
  hoursPerDay: 8,
  members: [
    { id: 'diogo', name: 'Diogo', tfsIdentity: 'Diogo Mesquita', order: 0 },
    { id: 'sofia', name: 'Sofia', tfsIdentity: 'Sofia Marques', order: 1 }
  ],
  capacityOverrides: {},
  queues: {
    diogo: [
      { id: 'a', workItemId: 1, hours: 16 },
      { id: 'b', workItemId: 2, hours: 8 }
    ],
    sofia: []
  },
  backlog: [],
  workItems: { 1: wi(1, { remainingWork: 16 }), 2: wi(2, {}) },
  notes: [],
  history: {}
})
const past = (s: Sprint, anchor: string, member = 'diogo') =>
  layoutSprint(s, anchor)
    [member].segments.filter((x) => x.date < anchor)
    .map((x) => `${x.date.slice(5)}@${x.startHour}+${x.hours}#${x.workItemId}`)
    .sort()
const day = (s: Sprint, anchor: string, date: string) =>
  past(s, anchor).filter((x) => x.startsWith(date.slice(5)))

// ---- The Wednesday → Thursday example ----
const WED = '2026-09-16'
const THU = '2026-09-17'
const wed = applyRefresh(
  base(),
  [wi(1, { remainingWork: 2, completedWork: 14 }), wi(2, {})],
  WED,
  () => 'n1'
).sprint
check(
  'Wednesday: Monday full, Tuesday 6h with a gap',
  J(past(wed, WED)) === J(['09-14@0+8#1', '09-15@0+6#1']),
  past(wed, WED)
)

const tueBefore = J(wed.pastRecord?.diogo?.['2026-09-15'])
const thu = applyRefresh(
  wed,
  [
    wi(1, { remainingWork: 0, completedWork: 16, state: 'Closed' }),
    wi(2, { remainingWork: 2, completedWork: 6 })
  ],
  THU,
  () => 'n2'
).sprint
check(
  'Thursday: what Tuesday already showed is untouched',
  J(thu.pastRecord?.diogo?.['2026-09-15']?.filter((p) => p.startHour < 6)) === tueBefore,
  [tueBefore, thu.pastRecord?.diogo]
)
check(
  "Thursday: #1's new 2h fill Tuesday's gap — the oldest one",
  J(day(thu, THU, '2026-09-15')) === J(['09-15@0+6#1', '09-15@6+2#1']),
  day(thu, THU, '2026-09-15')
)
check(
  "Thursday: #2's 6h go on Wednesday",
  J(day(thu, THU, WED)) === J(['09-16@0+6#2']),
  day(thu, THU, WED)
)
check('Monday never moves', J(day(thu, THU, '2026-09-14')) === J(['09-14@0+8#1']))

// A refresh with nothing new changes nothing behind today.
const again = applyRefresh(thu, Object.values(thu.workItems), THU, () => 'n3').sprint
check(
  'refreshing again with the same figures redraws nothing',
  J(past(again, THU)) === J(past(thu, THU))
)

// Opening the app a day later without refreshing: the record still holds.
check(
  'the day moving on alone keeps the record',
  J(past(thu, '2026-09-18').filter((x) => x < '09-17')) === J(past(thu, THU))
)

// ---- Completed Work goes down ----
{
  const fixed = applyRefresh(
    thu,
    [
      wi(1, { remainingWork: 0, completedWork: 12, state: 'Closed' }),
      wi(2, { remainingWork: 2, completedWork: 6 })
    ],
    THU,
    () => 'n4'
  ).sprint
  check(
    'Completed Work lowered: the most recent recorded hours go, nothing else moves',
    J(past(fixed, THU)) === J(['09-14@0+8#1', '09-15@0+4#1', '09-16@0+6#2']),
    past(fixed, THU)
  )
}

// ---- A reported pin overrules the record for its task ----
{
  const moved = pinReportedAt(thu, 2, 'diogo', WED, 2)
  const drawn = layoutSprint(moved, THU).diogo.segments.filter(
    (x) => x.workItemId === 2 && x.date < THU
  )
  check(
    'dragging a recorded task draws it from the pin instead',
    J(drawn.map((x) => `${x.startHour}+${x.hours}`)) === J(['2+6']),
    drawn
  )
}

// ---- Upgrading: the record starts from exactly what is drawn ----
{
  const old = { ...wed, pastRecord: undefined }
  const record = recordPast(old, THU)
  check(
    'a sprint without a record gets one identical to what it shows',
    J(past({ ...old, pastRecord: record }, THU)) === J(past(old, THU)),
    [past(old, THU)]
  )
}

// ---- Clearing and reshaping the day ----
check('clearing the calendar drops the record', clearCalendar(thu).pastRecord === undefined)
{
  const six = setHoursPerDay(thu, 6)
  const pieces = Object.values(six.pastRecord?.diogo ?? {}).flat()
  check(
    'a shorter day trims the record to fit',
    pieces.every((p) => p.startHour + p.hours <= 6),
    pieces
  )
}

// ---- A task moved to someone else keeps its recorded hours where they are ----
{
  const handed = { ...thu, queues: { diogo: [], sofia: [{ id: 'b', workItemId: 2, hours: 2 }] } }
  const sofiaPast = layoutSprint(handed, THU).sofia.segments.filter((x) => x.date < THU && x.isDone)
  check(
    "recorded hours are not drawn a second time on the new owner's row",
    sofiaPast.length === 0,
    sofiaPast
  )
}

report()

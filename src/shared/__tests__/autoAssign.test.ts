import { checklist } from '../../../test/checklist'
import { meetingPieces, planAutoAssign, valWarnings } from '@shared/autoAssign'
import { buildSprintDays } from '@shared/dates'
import { createMockSprint } from '@shared/mock'
import { anchorFor, layoutSprint } from '@shared/scheduling'
import type { Block, Sprint, WorkItem } from '@shared/types'

const { check, report } = checklist()
const J = JSON.stringify

// Two weeks from Mon 14 Sep 2026, 8h days, three people.
function sprintWith(opts: {
  items: Array<Partial<WorkItem> & { id: number; title: string }>
  queues?: Record<string, Block[]>
  backlog: Block[]
  lockedDays?: string[]
}): Sprint {
  const workItems: Record<number, WorkItem> = {
    900: { id: 900, title: 'Story', type: 'User Story', state: 'Active', url: '', remainingWork: 0 },
    901: { id: 901, title: 'Story two', type: 'User Story', state: 'Active', url: '', remainingWork: 0 }
  }
  for (const item of opts.items) {
    workItems[item.id] = { type: 'Task', state: 'New', url: '', remainingWork: 0, ...item } as WorkItem
  }
  return {
    id: 't', name: 'T',
    days: buildSprintDays('2026-09-14', 2, 8),
    hoursPerDay: 8,
    members: [
      { id: 'diogo', name: 'Diogo', tfsIdentity: 'Diogo Mesquita', order: 0 },
      { id: 'sofia', name: 'Sofia', tfsIdentity: 'Sofia Marques', order: 1 },
      { id: 'gil', name: 'Gilberto', tfsIdentity: 'Gilberto Sousa', order: 2 }
    ],
    capacityOverrides: {},
    queues: { diogo: [], sofia: [], gil: [], ...(opts.queues ?? {}) },
    backlog: opts.backlog,
    workItems,
    notes: [],
    history: {},
    lockedDays: opts.lockedDays
  }
}

const b = (id: string, workItemId: number, hours: number): Block => ({ id, workItemId, hours })
let n = 0
const newId = () => `piece-${++n}`
const segs = (s: Sprint, anchor: string, member: string, blockId: string) =>
  layoutSprint(s, anchor)[member].segments
    .filter((x) => x.blockId === blockId && !x.fromHistory && !x.isDone)
    .map((x) => `${x.date.slice(5)}@${x.startHour}+${x.hours}`)
const workOf = (s: Sprint, anchor: string, member: string, workItemId: number) =>
  layoutSprint(s, anchor)[member].segments
    .filter((x) => x.workItemId === workItemId && !x.fromHistory && !x.isDone)
    .map((x) => `${x.date.slice(5)}@${x.startHour}+${x.hours}`)

// ---- Meeting pieces ----
const table: Array<[number, number, number[]]> = [
  [8, 9, [2, 2, 2, 2]], [12, 9, [3, 3, 3, 3]], [10, 9, [2, 2, 2, 2, 2]], [7, 9, [3, 2, 2]],
  [6, 9, [2, 2, 2]], [4, 9, [2, 2]], [3, 9, [1, 1, 1]], [2, 9, [1, 1]], [1, 9, [1]],
  [5, 9, [3, 2]], [9, 9, [3, 3, 3]], [16, 9, [4, 4, 4, 4]], [20, 9, [4, 4, 4, 4, 4]],
  [7.5, 9, [3.5, 2, 2]], [8, 2, [4, 4]], [8, 1, [8]], [1.5, 9, [1.5]]
]
for (const [hours, days, expected] of table) {
  const got = meetingPieces(hours, days)
  check(`pieces: ${hours}h over ${days} days → ${expected.join('+')}`, J(got) === J(expected), got)
}

// ---- Meetings on the calendar ----
{
  const s = sprintWith({
    items: [{ id: 1, title: 'Meetings', assignedTo: 'Gilberto Sousa', remainingWork: 8, parentId: 900 }],
    backlog: [b('m', 1, 8)]
  })
  const anchor = '2026-09-14' // the sprint's first day is today
  const plan = planAutoAssign(s, anchor, { newId })
  const pieces = plan.sprint.queues.gil
  check('meeting: 4 pieces of 2h, pinned at the start of the day',
    pieces.length === 4 && pieces.every((p) => p.hours === 2 && p.pin?.startHour === 0), pieces)
  check('meeting: never on the first day, all on different days',
    pieces.every((p) => p.pin!.date !== '2026-09-14') && new Set(pieces.map((p) => p.pin!.date)).size === 4,
    pieces.map((p) => p.pin!.date))
  check('meeting: spread evenly across the sprint', J(pieces.map((p) => p.pin!.date)) ===
    J(['2026-09-16', '2026-09-18', '2026-09-22', '2026-09-24']), pieces.map((p) => p.pin!.date))
  check('meeting: counted once, as split', plan.summary.placed === 1 && plan.summary.meetingsSplit === 1, plan.summary)
  check('meeting: gone from the backlog', plan.sprint.backlog.length === 0)

  const locked = { ...s, lockedDays: ['2026-09-16', '2026-09-18'] }
  const lp = planAutoAssign(locked, anchor, { newId })
  check('meeting: never on a locked day', lp.sprint.queues.gil.every((p) => !['2026-09-16', '2026-09-18'].includes(p.pin!.date)),
    lp.sprint.queues.gil.map((p) => p.pin!.date))

  const late = planAutoAssign(s, '2026-09-24', { newId }) // Thu 24 → only Thu and Fri left
  check('meeting: fewer days left → fewer, bigger pieces', J(late.sprint.queues.gil.map((p) => p.hours)) === '[4,4]',
    late.sprint.queues.gil)
  const last = planAutoAssign(s, '2026-09-25', { newId }) // only Fri left
  check('meeting: one day left → one piece there', last.sprint.queues.gil.length === 1 &&
    last.sprint.queues.gil[0].pin?.date === '2026-09-25', last.sprint.queues.gil)
}

// ---- VAL after DEV: the Diogo / Sofia example ----
const example = () =>
  sprintWith({
    items: [
      { id: 10, title: 'DEV:: Export', parentId: 900, assignedTo: 'Diogo Mesquita', remainingWork: 5 },
      { id: 11, title: 'VAL:: Export', parentId: 900, assignedTo: 'Sofia Marques', remainingWork: 3 },
      { id: 20, title: 'Something Diogo is on', parentId: 901, assignedTo: 'Diogo Mesquita', remainingWork: 6 },
      { id: 21, title: 'DEV:: 456', parentId: 901, assignedTo: 'Sofia Marques', remainingWork: 16 }
    ],
    // Tuesday is today. Diogo is busy until Tue hour 6, so the DEV runs Tue 6–8 and Wed 0–3.
    // Sofia has DEV 456 across all of Tuesday and Wednesday.
    queues: { diogo: [b('x', 20, 6)], sofia: [b('y', 21, 16)] },
    backlog: [b('dev', 10, 5), b('val', 11, 3)]
  })
{
  const anchor = '2026-09-15'
  const s = example()
  const plan = planAutoAssign(s, anchor, { newId })
  check('example: DEV ends Wed hour 3', J(segs(plan.sprint, anchor, 'diogo', 'dev')) === J(['09-15@6+2', '09-16@0+3']),
    segs(plan.sprint, anchor, 'diogo', 'dev'))
  check('example: VAL starts Wed hour 3 on Sofia\'s calendar', J(segs(plan.sprint, anchor, 'sofia', 'val')) === J(['09-16@3+3']),
    segs(plan.sprint, anchor, 'sofia', 'val'))
  check('example: DEV 456 is split around it and carries on after',
    J(segs(plan.sprint, anchor, 'sofia', 'y')) === J(['09-15@0+8', '09-16@0+3', '09-16@6+2', '09-17@0+3']),
    segs(plan.sprint, anchor, 'sofia', 'y'))
  check('example: VAL counted as chained', plan.summary.valsChained === 1 && plan.summary.placed === 2, plan.summary)
  check('example: the split is reported, with the VAL as its cause',
    plan.baseChanges.length === 1 && plan.baseChanges[0].blockId === 'y' && plan.baseChanges[0].kind === 'split' &&
    J(plan.baseChanges[0].causes) === J([{ workItemId: 11, rule: 'val' }]), plan.baseChanges)
  check('example: no warning once placed', valWarnings(plan.sprint, layoutSprint(plan.sprint, anchor), anchor).size === 0)

  // Later the DEV grows: the VAL does not follow, and the calendar says so.
  const grown = { ...plan.sprint, queues: { ...plan.sprint.queues,
    diogo: plan.sprint.queues.diogo.map((blk) => (blk.id === 'dev' ? { ...blk, hours: 8 } : blk)) } }
  const w = valWarnings(grown, layoutSprint(grown, anchor), anchor)
  check('example: DEV grows → VAL flagged', w.has('val') && /ends/.test(w.get('val')!), [...w])

  // Keep my calendar fixed: the VAL cannot cut DEV 456, so it goes after Sofia's work.
  const keep = planAutoAssign(s, anchor, { keepBase: true, newId })
  check('keep: nothing already there moves', keep.baseChanges.length === 0 &&
    J(segs(keep.sprint, anchor, 'sofia', 'y')) === J(segs(s, anchor, 'sofia', 'y')), keep.baseChanges)
  check('keep: VAL placed after Sofia\'s work, not chained', J(segs(keep.sprint, anchor, 'sofia', 'val')) === J(['09-17@0+3']) &&
    keep.summary.valsChained === 0 && keep.summary.placed === 2, [segs(keep.sprint, anchor, 'sofia', 'val'), keep.summary])
}

// ---- VAL edge cases ----
{
  const anchor = '2026-09-15'
  const waiting = sprintWith({
    items: [
      { id: 10, title: 'DEV:: X', parentId: 900, remainingWork: 5 }, // nobody assigned → stays
      { id: 11, title: 'VAL:: X', parentId: 900, assignedTo: 'Sofia Marques', remainingWork: 3 }
    ],
    backlog: [b('dev', 10, 5), b('val', 11, 3)]
  })
  let p = planAutoAssign(waiting, anchor, { newId })
  check('val: DEV not planned → VAL waits', p.summary.waitingForDev === 1 && p.summary.placed === 0 &&
    p.sprint.backlog.some((blk) => blk.id === 'val'), p.summary)

  const alone = sprintWith({
    items: [{ id: 11, title: 'VAL:: Alone', parentId: 900, assignedTo: 'Sofia Marques', remainingWork: 3 }],
    queues: { sofia: [b('y', 11, 0)] },
    backlog: [b('val', 11, 3)]
  })
  p = planAutoAssign({ ...alone, queues: { ...alone.queues, sofia: [] } }, anchor, { newId })
  check('val: no DEV sibling → ordinary', p.summary.valsChained === 0 && p.summary.placed === 1 &&
    !p.sprint.queues.sofia[0].pin, p.sprint.queues.sofia)

  const devDone = sprintWith({
    items: [
      { id: 10, title: 'DEV:: X', parentId: 900, assignedTo: 'Diogo Mesquita', remainingWork: 0 }, // nothing left
      { id: 11, title: 'VAL:: X', parentId: 900, assignedTo: 'Sofia Marques', remainingWork: 3 }
    ],
    backlog: [b('val', 11, 3)]
  })
  p = planAutoAssign(devDone, anchor, { newId })
  check('val: DEV finished → VAL starts today', J(segs(p.sprint, anchor, 'sofia', 'val')) === J(['09-15@0+3']),
    segs(p.sprint, anchor, 'sofia', 'val'))

  const tooLate = sprintWith({
    items: [
      { id: 10, title: 'DEV:: X', parentId: 900, assignedTo: 'Diogo Mesquita', remainingWork: 70 },
      { id: 11, title: 'VAL:: X', parentId: 900, assignedTo: 'Sofia Marques', remainingWork: 3 }
    ],
    backlog: [b('dev', 10, 70), b('val', 11, 3)]
  })
  p = planAutoAssign(tooLate, anchor, { newId })
  check('val: DEV ends too late → VAL goes as late as the sprint allows',
    p.summary.tooBig === 0 && p.summary.valsChained === 0 && p.summary.valsLate === 1 &&
    J(segs(p.sprint, anchor, 'sofia', 'val')) === J(['09-25@5+3']) && layoutSprint(p.sprint, anchor).sofia.spillover === 0,
    [p.summary, segs(p.sprint, anchor, 'sofia', 'val')])
  {
    const w = valWarnings(p.sprint, layoutSprint(p.sprint, anchor), anchor)
    check('late: flagged, saying why', /as late as the sprint allows/.test(w.get('val') ?? ''), [...w])
  }

  // Same person, DEV pinned to end on the last day at hour 6: the VAL goes as late as it can
  // without shoving the pinned DEV, which is to end where the DEV starts.
  const same = sprintWith({
    items: [
      { id: 10, title: 'DEV:: X', parentId: 900, assignedTo: 'Diogo Mesquita', remainingWork: 8 },
      { id: 11, title: 'VAL:: X', parentId: 900, assignedTo: 'Diogo Mesquita', remainingWork: 4 }
    ],
    queues: { diogo: [{ id: 'dev', workItemId: 10, hours: 8, pin: { date: '2026-09-24', startHour: 6 } }] },
    backlog: [b('val', 11, 4)]
  })
  p = planAutoAssign(same, anchor, { newId })
  check('late, same person: VAL ends where the pinned DEV starts, DEV untouched',
    p.summary.valsLate === 1 && J(segs(p.sprint, anchor, 'diogo', 'val')) === J(['09-24@2+4']) &&
    J(segs(p.sprint, anchor, 'diogo', 'dev')) === J(['09-24@6+2', '09-25@0+6']) && p.baseChanges.length === 0,
    [p.summary, segs(p.sprint, anchor, 'diogo', 'val'), segs(p.sprint, anchor, 'diogo', 'dev')])

  // A fractional VAL ends exactly at the end of the sprint.
  const frac = sprintWith({
    items: [
      { id: 10, title: 'DEV:: X', parentId: 900, assignedTo: 'Diogo Mesquita', remainingWork: 70 },
      { id: 11, title: 'VAL:: X', parentId: 900, assignedTo: 'Sofia Marques', remainingWork: 2.5 }
    ],
    backlog: [b('dev', 10, 70), b('val', 11, 2.5)]
  })
  p = planAutoAssign(frac, anchor, { newId })
  check('late: 2.5h VAL starts at 5.5 on the last day', J(segs(p.sprint, anchor, 'sofia', 'val')) === J(['09-25@5.5+2.5']),
    segs(p.sprint, anchor, 'sofia', 'val'))

  // A meeting pinned on the last day keeps its hours; the VAL fits in before the end around it.
  const meet = sprintWith({
    items: [
      { id: 10, title: 'DEV:: X', parentId: 900, assignedTo: 'Diogo Mesquita', remainingWork: 70 },
      { id: 11, title: 'VAL:: X', parentId: 900, assignedTo: 'Sofia Marques', remainingWork: 4 },
      { id: 40, title: 'Meeting', assignedTo: 'Sofia Marques', remainingWork: 2 }
    ],
    queues: { sofia: [{ id: 'mt', workItemId: 40, hours: 2, pin: { date: '2026-09-25', startHour: 6 } }] },
    backlog: [b('dev', 10, 70), b('val', 11, 4)]
  })
  p = planAutoAssign(meet, anchor, { newId })
  check('late: a meeting at the end of the sprint keeps its slot',
    J(segs(p.sprint, anchor, 'sofia', 'mt')) === J(['09-25@6+2']) && J(segs(p.sprint, anchor, 'sofia', 'val')) === J(['09-25@2+4']) &&
    layoutSprint(p.sprint, anchor).sofia.spillover === 0,
    [segs(p.sprint, anchor, 'sofia', 'mt'), segs(p.sprint, anchor, 'sofia', 'val')])

  // Keep my calendar fixed: Sofia's existing work fills all but 2h, so the late VAL fits only after it.
  const kept = sprintWith({
    items: [
      { id: 10, title: 'DEV:: X', parentId: 900, assignedTo: 'Diogo Mesquita', remainingWork: 70 },
      { id: 11, title: 'VAL:: X', parentId: 900, assignedTo: 'Sofia Marques', remainingWork: 3 },
      { id: 21, title: 'Sofia work', parentId: 901, assignedTo: 'Sofia Marques', remainingWork: 60 }
    ],
    queues: { sofia: [b('y', 21, 60)] },
    backlog: [b('dev', 10, 70), b('val', 11, 3)]
  })
  const before = segs(kept, anchor, 'sofia', 'y')
  p = planAutoAssign(kept, anchor, { newId, keepBase: true })
  check('late + keep: nothing already there moves', p.baseChanges.length === 0 && J(segs(p.sprint, anchor, 'sofia', 'y')) === J(before),
    [p.baseChanges, segs(p.sprint, anchor, 'sofia', 'val')])
  check('late + keep: VAL still at the very end', J(segs(p.sprint, anchor, 'sofia', 'val')) === J(['09-25@5+3']),
    segs(p.sprint, anchor, 'sofia', 'val'))
  const allowP = planAutoAssign(kept, anchor, { newId })
  check('late + allow: the same, since the end is free', allowP.baseChanges.length === 0 && allowP.summary.valsLate === 1,
    allowP.baseChanges)

  // No room at all for the VAL: it stays in the backlog, as before.
  const noRoom = sprintWith({
    items: [
      { id: 10, title: 'DEV:: X', parentId: 900, assignedTo: 'Diogo Mesquita', remainingWork: 70 },
      { id: 11, title: 'VAL:: X', parentId: 900, assignedTo: 'Diogo Mesquita', remainingWork: 4 }
    ],
    queues: { diogo: [b('dev', 10, 70)] },
    backlog: [b('val', 11, 4)]
  })
  p = planAutoAssign(noRoom, anchor, { newId })
  check('late: no room anywhere → VAL stays in the backlog', p.summary.tooBig === 1 && p.summary.valsLate === 0 &&
    p.sprint.backlog.some((blk) => blk.id === 'val'), p.summary)

  // Two chains crossing between people must settle with every VAL after its DEV.
  const crossing = sprintWith({
    items: [
      { id: 10, title: 'DEV:: A', parentId: 900, assignedTo: 'Diogo Mesquita', remainingWork: 12 },
      { id: 11, title: 'VAL:: A', parentId: 900, assignedTo: 'Sofia Marques', remainingWork: 4 },
      { id: 12, title: 'DEV:: B', parentId: 901, assignedTo: 'Sofia Marques', remainingWork: 6 },
      { id: 13, title: 'VAL:: B', parentId: 901, assignedTo: 'Diogo Mesquita', remainingWork: 4 }
    ],
    backlog: [b('devA', 10, 12), b('valA', 11, 4), b('devB', 12, 6), b('valB', 13, 4)]
  })
  p = planAutoAssign(crossing, anchor, { newId })
  const warn = valWarnings(p.sprint, layoutSprint(p.sprint, anchor), anchor)
  check('val: crossing chains settle, no VAL before its DEV', p.summary.valsChained === 2 && warn.size === 0,
    { summary: p.summary, warn: [...warn], A: workOf(p.sprint, anchor, 'diogo', 10), valA: workOf(p.sprint, anchor, 'sofia', 11),
      B: workOf(p.sprint, anchor, 'sofia', 12), valB: workOf(p.sprint, anchor, 'diogo', 13) })

  // Capacity: VAL is reserved before ordinary work, and nobody spills over.
  const full = sprintWith({
    items: [
      { id: 10, title: 'DEV:: A', parentId: 900, assignedTo: 'Diogo Mesquita', remainingWork: 4 },
      { id: 11, title: 'VAL:: A', parentId: 900, assignedTo: 'Sofia Marques', remainingWork: 4 },
      { id: 30, title: 'Big ordinary', parentId: 901, assignedTo: 'Sofia Marques', remainingWork: 70 },
      { id: 31, title: 'Small ordinary', parentId: 901, assignedTo: 'Sofia Marques', remainingWork: 2 }
    ],
    backlog: [b('dev', 10, 4), b('val', 11, 4), b('big', 30, 70), b('small', 31, 2)]
  })
  p = planAutoAssign(full, anchor, { newId }) // Sofia has 72h from Tue: VAL 4 + big 70 do not both fit
  const L = layoutSprint(p.sprint, anchor)
  check('capacity: VAL kept, big task turned away, small one fits, no spillover',
    p.summary.valsChained === 1 && p.sprint.backlog.some((blk) => blk.id === 'big') &&
    p.sprint.queues.sofia.some((blk) => blk.id === 'small') && L.sofia.spillover === 0,
    [p.summary, p.sprint.queues.sofia, L.sofia.spillover])

  // Room given back: the VAL waits, so the ordinary task it pushed out gets in after all.
  const refill = sprintWith({
    items: [
      { id: 10, title: 'DEV:: A', parentId: 900, remainingWork: 4 }, // unassigned → VAL waits
      { id: 11, title: 'VAL:: A', parentId: 900, assignedTo: 'Sofia Marques', remainingWork: 4 },
      { id: 30, title: 'Ordinary', parentId: 901, assignedTo: 'Sofia Marques', remainingWork: 70 }
    ],
    backlog: [b('dev', 10, 4), b('val', 11, 4), b('big', 30, 70)]
  })
  p = planAutoAssign(refill, anchor, { newId })
  check('refill: room a waiting VAL gave back is used', p.summary.waitingForDev === 1 && p.summary.tooBig === 0 &&
    p.sprint.queues.sofia.some((blk) => blk.id === 'big'), p.summary)
}

// ---- Meetings against an existing calendar ----
{
  const anchor = '2026-09-15'
  const s = sprintWith({
    items: [
      { id: 1, title: 'DEV:: Meetings', assignedTo: 'Gilberto Sousa', remainingWork: 4, parentId: 900 },
      { id: 2, title: 'Existing work', assignedTo: 'Gilberto Sousa', remainingWork: 24, parentId: 901 }
    ],
    queues: { gil: [b('existing', 2, 24)] }, // Tue, Wed, Thu
    backlog: [b('m', 1, 4)]
  })
  const allow = planAutoAssign(s, anchor, { newId })
  check('meeting (tagged title) recognised and split', allow.summary.meetingsSplit === 1)
  check('meeting: cutting into existing work is reported',
    allow.baseChanges.some((c) => c.blockId === 'existing' && c.causes.some((x) => x.rule === 'meeting')), allow.baseChanges)
  const keep = planAutoAssign(s, anchor, { keepBase: true, newId })
  const dates = keep.sprint.queues.gil.filter((blk) => blk.workItemId === 1).map((blk) => blk.pin?.date)
  check('keep: meeting pieces only after existing work ends (Thu 17)',
    keep.baseChanges.length === 0 && dates.length === 2 && dates.every((d) => d! > '2026-09-17'), dates)
}

// ---- Nothing before the anchor; unattributed and unsized untouched ----
{
  const mock = createMockSprint()
  const anchor = anchorFor(mock, '2026-09-17')
  const plan = planAutoAssign(mock, anchor, { newId })
  const L = layoutSprint(plan.sprint, anchor)
  const baseIds = new Set(Object.values(mock.queues).flat().map((blk) => blk.id))
  const newSegs = Object.values(L).flatMap((l) => l.segments.filter((x) => !baseIds.has(x.blockId) && !x.fromHistory && !x.isDone))
  check('mock: nothing new before the anchor', newSegs.every((x) => x.date >= anchor), newSegs.filter((x) => x.date < anchor))
  check('mock: Gilberto\'s meetings spread', plan.summary.meetingsSplit === 1 &&
    plan.sprint.queues.gilberto.filter((blk) => blk.workItemId === 4740).length > 1, plan.sprint.queues.gilberto)
  check('mock: VAL 4732 follows DEV 4731', plan.summary.valsChained === 1 &&
    valWarnings(plan.sprint, L, anchor).size === 0, [plan.summary, workOf(plan.sprint, anchor, 'diogo', 4731), workOf(plan.sprint, anchor, 'sofia', 4732)])
  check('mock: unassigned tasks left alone', plan.sprint.backlog.some((blk) => blk.workItemId === 4934), plan.summary)
  check('mock: no one pushed over capacity by the plan',
    Object.entries(L).every(([id, l]) => l.spillover <= layoutSprint(mock, anchor)[id].spillover),
    Object.fromEntries(Object.entries(L).map(([id, l]) => [id, l.spillover])))
  console.log('mock summary', J(plan.summary), 'changes', plan.baseChanges.length)
}

report()

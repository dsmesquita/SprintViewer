import { checklist } from '../../../test/checklist'
import { baselineAction, baselineName } from '@shared/baseline'
import { buildSprintDays } from '@shared/dates'
import { addNote, updateNote } from '@shared/notes'
import { buildSprintSummary, sprintMetrics } from '@shared/sprintSummary'
import type { Snapshot } from '@shared/snapshots'
import type { Block, Sprint, WorkItem } from '@shared/types'
import { registerIpc } from '../../main/ipc'
import { handlers } from '../../../test/electron'

const { check, report } = checklist()
const J = JSON.stringify

const item = (id: number, title: string, fields: Partial<WorkItem> = {}): WorkItem => ({
  id, title, type: 'Task', state: 'Active', url: `https://tfs/x/${id}`, remainingWork: 0, parentId: 900, ...fields
})
const b = (id: string, workItemId: number, hours: number): Block => ({ id, workItemId, hours })

function base(): Sprint {
  return {
    id: 's1', name: 'Sprint "24.09" | test',
    days: buildSprintDays('2026-09-14', 2, 8),
    hoursPerDay: 8,
    members: [
      { id: 'diogo', name: 'Diogo', tfsIdentity: 'Diogo Mesquita <CORP\\dm>', order: 0 },
      { id: 'sofia', name: 'Sofia', tfsIdentity: 'Sofia Marques', order: 1 },
      { id: 'gil', name: 'Gilberto', order: 2 }
    ],
    capacityOverrides: { sofia: { '2026-09-17': 0 } },
    queues: { diogo: [], sofia: [], gil: [] },
    backlog: [],
    workItems: { 900: { id: 900, title: 'Story', type: 'User Story', state: 'Active', url: '', remainingWork: 0 } },
    notes: [],
    history: {}
  }
}

// ---- The plan, as it stood at the end of planning day ----
const planSprint = base()
planSprint.workItems = {
  ...planSprint.workItems,
  1: item(1, 'Grew', { remainingWork: 8, originalEstimate: 6, completedWork: 0 }),
  2: item(2, 'On time', { remainingWork: 6, originalEstimate: 6, completedWork: 0 }),
  3: item(3, 'Carried over', { remainingWork: 5, originalEstimate: 12, completedWork: 7 }),
  5: item(5, 'Reassigned', { remainingWork: 4, originalEstimate: 4, completedWork: 0 }),
  6: item(6, 'Slips | with a pipe', { remainingWork: 8, originalEstimate: 8, completedWork: 0 }),
  7: item(7, 'Removed', { remainingWork: 2, originalEstimate: 2, completedWork: 0 }),
  8: item(8, 'Untouched', { remainingWork: 3, originalEstimate: 3, completedWork: 0 })
}
planSprint.queues = {
  diogo: [b('p1', 1, 8), b('p2', 2, 6), b('p5', 5, 4)],
  sofia: [b('p3', 3, 5), b('p7', 7, 2)],
  gil: [b('p6', 6, 8)]
}
const plan: Snapshot = { id: 'snap', sprintId: 's1', name: 'Sprint start', takenAt: '2026-09-14T17:00:00', kind: 'baseline', sprint: planSprint }

// ---- The board at the end ----
const end = base()
end.workItems = {
  ...end.workItems,
  1: item(1, 'Grew', { remainingWork: 2, originalEstimate: 6, completedWork: 10 }),
  2: item(2, 'On time', { remainingWork: 0, originalEstimate: 6, completedWork: 6, state: 'Closed' }),
  3: item(3, 'Carried over', { remainingWork: 2, originalEstimate: 12, completedWork: 10 }),
  4: item(4, 'Added', { remainingWork: 1, originalEstimate: 5, completedWork: 4, assignedTo: 'Sofia Marques' }),
  5: item(5, 'Reassigned', { remainingWork: 0, originalEstimate: 4, completedWork: 4, state: 'Closed' }),
  6: item(6, 'Slips | with a pipe', { remainingWork: 8, originalEstimate: 8, completedWork: 0 }),
  7: item(7, 'Removed', { remainingWork: 2, originalEstimate: 2, completedWork: 0, missingFromQuery: true }),
  8: item(8, 'Untouched', { remainingWork: 3, originalEstimate: 3, completedWork: 0 })
}
end.queues = {
  diogo: [b('e1', 1, 2)],
  sofia: [b('e3', 3, 2), b('e4', 4, 1), b('e7', 7, 2)],
  gil: [b('e5', 5, 4), b('e6', 6, 8)]
}
let notes = end
let n = 0
const id = () => `note-${++n}`
notes = addNote(notes, { memberId: 'diogo', text: 'Owned the release.\nStayed late twice.', taskIds: [1], category: 'Commitment' }, id)
notes = addNote(notes, { memberId: 'diogo', text: 'Kept the team informed.', taskIds: [], category: 'Communication' }, id)
notes = addNote(notes, { memberId: 'diogo', text: 'Plain note.', taskIds: [], category: undefined }, id)
notes = addNote(notes, { memberId: 'diogo', text: 'Bogus category.', taskIds: [], category: 'Nonsense' as never }, id)
const endSprint = notes

// ---- Notes ----
check('note: category kept', endSprint.notes[0].category === 'Commitment')
check('note: none → no field', !('category' in endSprint.notes[2]))
check('note: unknown category dropped', !('category' in endSprint.notes[3]))
const edited = updateNote(endSprint, endSprint.notes[0].id, { memberId: 'diogo', text: 'x', taskIds: [], category: undefined })
check('note: editing to None clears it', !('category' in edited.notes[0]), edited.notes[0])

// ---- Figures ----
const today = '2026-09-26' // the day after the sprint
const m = sprintMetrics(endSprint, plan, today)
const it = (id: number) => m.items.find((x) => x.id === id)!
const person = (id: string) => m.people.find((p) => p.memberId === id)!

check('sprint finished', m.finished && m.hasPlan && m.tracksCompleted)
check('grew: planned 8, done 10, remaining 2, growth +4, not finished',
  J([it(1).planned, it(1).done, it(1).remaining, it(1).growth]) === '[8,10,2,4]' && it(1).flags.includes('not finished'), it(1))
check('on time: done 6, growth 0, finished, no flags',
  it(2).done === 6 && it(2).growth === 0 && it(2).finished && it(2).flags.length === 0, it(2))
check('carried over: only this sprint\'s 3h count as done', it(3).done === 3 && it(3).growth === 0, it(3))
check('added mid-sprint: flagged, not planned', it(4).flags.includes('added mid-sprint') && it(4).planned === 0 && it(4).ownerEnd === 'sofia', it(4))
check('reassigned: planned on Diogo, done on Gilberto',
  it(5).ownerStart === 'diogo' && it(5).ownerEnd === 'gil' && it(5).flags.includes('reassigned'), it(5))
check('slipped: still open and ends later than planned', it(6).flags.includes('slipped') && it(6).flags.includes('not finished'), it(6))
check('removed: flagged removed, not counted as not finished',
  it(7).flags.includes('removed') && !it(7).flags.includes('not finished'), it(7))
check('untouched item left out', !m.items.some((x) => x.id === 8))
check('off track: 10h spent against a 6h estimate', it(1).flags.includes('off track') && it(1).estimate === 6, it(1))
check('not off track: within a quarter of the estimate',
  !it(2).flags.includes('off track') && !it(3).flags.includes('off track'), [it(2).estimate, it(3).estimate])

const d = person('diogo'), s = person('sofia'), g = person('gil')
check('Diogo: planned 18 (8+6+4), done 16 (10+6), extra = growth 4',
  d.planned === 18 && d.done === 16 && d.extraGrowth === 4 && d.extraUnplanned === 0, d)
check('Diogo: delay 1 task, 2h', d.delayCount === 1 && d.delayHours === 2, d)
check('Diogo: 1 task off track', d.offTrack === 1 && g.offTrack === 0, [d.offTrack, g.offTrack])
check('Sofia: planned 7, done 7 (3 + 4 unplanned), extra unplanned 4',
  s.planned === 7 && s.done === 7 && s.extraUnplanned === 4, s)
check('Sofia: available excludes her day off', s.available === 72 && s.reducedDays.some((x) => x.startsWith('2026-09-17')), s)
check('Gilberto: done 4 on the reassigned task, delay 1 (slipped task, 8h), 1 slipped',
  g.done === 4 && g.delayCount === 1 && g.delayHours === 8 && g.slipped === 1, g)
check('notes counted by category', J(d.notes) === J({ Commitment: 1, Communication: 1, Uncategorised: 2 }), d.notes)

// No Completed Work on the server: estimated from planned − remaining.
const noCompleted: Sprint = { ...endSprint, workItems: Object.fromEntries(Object.entries(endSprint.workItems).map(([k, v]) => [k, { ...v, completedWork: undefined }])) }
const plannedNoCompleted: Snapshot = { ...plan, sprint: { ...planSprint, workItems: Object.fromEntries(Object.entries(planSprint.workItems).map(([k, v]) => [k, { ...v, completedWork: undefined }])) } }
const est = sprintMetrics(noCompleted, plannedNoCompleted, today)
check('no Completed Work: done estimated as planned − remaining',
  !est.tracksCompleted && est.items.find((x) => x.id === 1)!.done === 6 && est.items.find((x) => x.id === 1)!.doneEstimated, est.items.find((x) => x.id === 1))
check('no Completed Work: unplanned work has no done figure', est.items.find((x) => x.id === 4)?.done === undefined)

// ---- The file ----
const md = buildSprintSummary({ sprint: endSprint, plan, today, generatedAt: '2026-09-26T09:00:00.000Z' })
const headings = md.split('\n').filter((l) => /^#{1,2} /.test(l))
check('front matter first, with the facts an agent needs',
  md.startsWith('---\ntype: sprint-summary\n') && md.includes('sprint: "Sprint \\"24.09\\" | test"') &&
  md.includes('sprint_finished: true') && md.includes('plan_snapshot: "Sprint start"') && md.includes('completed_work_tracked: true'))
check('sections in a fixed order', J(headings) === J([
  '# Sprint summary — Sprint "24.09" | test', '## How to read this file', '## Sprint and team',
  '## Board at the start (Sprint start)', '## Board at the end (as of 2026-09-26)',
  '## Planned vs actual, per person', '## Work items', '## Notes'
]), headings)
check('per-person row has the figures (task 1 was due Monday and is still open: 1 slipped)',
  md.split(String.fromCharCode(10)).includes('| Diogo | 80 | 18 | 16 | 2 | 4 | 1 | 2 | 1 | 1 | 0 |'),
  md.split('\n').filter((l) => l.startsWith('| Diogo |')))
check('pipes in titles are escaped in tables', md.includes('Slips \\| with a pipe') && !md.includes('Slips | with a pipe'))
check('multi-line note quoted line by line', md.includes('  > Owned the release.\n  > Stayed late twice.'))
check('notes table by category', md.includes('| Diogo | 0 | 1 | 1 | 0 | 0 | 0 | 2 | 4 |'),
  md.split('\n').filter((l) => l.startsWith('| Diogo | 0')))
check('start board shows the plan day by day', md.includes('#1 Grew (8h)') && md.includes('← plan taken'))
check('growth is signed', md.includes('| +4 |'))
check('the file explains what the estimate is for, and flags the task',
  md.includes('**Estimate** is Original Estimate in TFS. It is not used to size anything') &&
  md.includes('more than 25% above its estimate') &&
  md.split(String.fromCharCode(10)).some((l) => l.includes('| Grew |') && l.includes('off track')),
  md.split(String.fromCharCode(10)).filter((l) => l.includes('| Grew |')))

const noPlan = buildSprintSummary({ sprint: endSprint, plan: null, today, generatedAt: 'x' })
check('no plan: said so, no start board, no planned columns',
  noPlan.includes('plan_snapshot: none') && !noPlan.includes('## Board at the start') &&
  !noPlan.includes('| Planned |') && noPlan.includes('no plan snapshot was available'))

const midSprint = buildSprintSummary({ sprint: endSprint, plan, today: '2026-09-18', generatedAt: 'x' })
check('mid-sprint: says figures are as of the day', midSprint.includes('sprint_finished: false') && midSprint.includes('before the sprint ended'))

// ---- Baseline: when ----
const empty = base()
const planned = planSprint
check('baseline: none before the planning day', baselineAction(planned, '2026-09-13', undefined) === 'none')
check('baseline: none while the board is empty', baselineAction(empty, '2026-09-14', undefined) === 'none')
check('baseline: take on the planning day', baselineAction(planned, '2026-09-14', undefined) === 'take')
const existing = { id: 'b', sprintId: 's1', name: 'Sprint start', takenAt: '2026-09-14T10:00:00', kind: 'baseline' as const }
check('baseline: replace later that day', baselineAction(planned, '2026-09-14', existing) === 'replace')
check('baseline: frozen from the next working day', baselineAction(planned, '2026-09-15', existing) === 'none')
check('baseline: first taken mid-sprint → says so', baselineAction(planned, '2026-09-17', undefined) === 'take' &&
  baselineName(planned, '2026-09-17') === 'Sprint start (taken mid-sprint, 2026-09-17)')

// ---- Baseline: through the real storage code ----
async function storageChecks(): Promise<void> {
  registerIpc()
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args)
  const sprint = { ...planSprint, id: 'store-test' }
  let r = await call('snapshot:baseline', sprint, '2026-09-14')
  check('store: taken on planning day', r.ok && r.value.action === 'take' && r.value.meta.kind === 'baseline', r)
  const firstId = r.value.meta.id
  const later = { ...sprint, queues: { ...sprint.queues, gil: [] } }
  r = await call('snapshot:baseline', later, '2026-09-14')
  check('store: replaced, same id', r.value.action === 'replace' && r.value.meta.id === firstId, r)
  let list = await call('snapshot:list', 'store-test')
  check('store: still just one snapshot', list.length === 1 && list[0].kind === 'baseline', list)
  const loaded = await call('snapshot:load', 'store-test', firstId)
  check('store: holds the latest board of that day', (loaded.sprint.queues.gil ?? []).length === 0)
  r = await call('snapshot:baseline', { ...later, queues: { ...later.queues, sofia: [] } }, '2026-09-15')
  list = await call('snapshot:list', 'store-test')
  check('store: frozen the next day', r.value.action === 'none' &&
    ((await call('snapshot:load', 'store-test', firstId)).sprint.queues.sofia ?? []).length === 2, r)
  await call('snapshot:take', later, 'By hand')
  list = await call('snapshot:list', 'store-test')
  check('store: manual snapshot unaffected, baseline still the only baseline',
    list.length === 2 && list.filter((x: any) => x.kind === 'baseline').length === 1, list)
}

await storageChecks()
report()

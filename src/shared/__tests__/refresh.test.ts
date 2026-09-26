import { checklist } from '../../../test/checklist'
import { buildSprintDays } from '@shared/dates'
import { applyRefresh } from '@shared/refresh'
import { layoutSprint } from '@shared/scheduling'
import { plannedHours, reportedHours } from '@shared/sizing'
import type { Block, Sprint, WorkItem } from '@shared/types'
import { registerIpc } from '../../main/ipc'
import { handlers, json, setServer } from '../../../test/electron'

/** Does a refresh bring Completed and Remaining Work through correctly, end to end? */

const { check, report } = checklist()
const J = JSON.stringify
const QUERY = 'https://tfs.example/tfs/Coll/Proj/_queries/query/11111111-2222-3333-4444-555555555555'
const ANCHOR = '2026-09-16' // Wednesday of week one

const b = (id: string, workItemId: number, hours: number, pin?: Block['pin']): Block => ({ id, workItemId, hours, pin })

function sprintWith(workItems: WorkItem[], queues: Record<string, Block[]>, extra: Partial<Sprint> = {}): Sprint {
  return {
    id: 's', name: 'S', days: buildSprintDays('2026-09-14', 2, 8), hoursPerDay: 8,
    members: [{ id: 'diogo', name: 'Diogo', order: 0 }],
    capacityOverrides: {}, queues: { diogo: [], ...queues }, backlog: [],
    workItems: Object.fromEntries(workItems.map((i) => [i.id, i])),
    notes: [], history: {}, ...extra
  }
}
const wi = (id: number, fields: Partial<WorkItem>): WorkItem =>
  ({ id, title: `Task ${id}`, type: 'Task', state: 'Active', url: '', remainingWork: 0, ...fields }) as WorkItem

async function run(): Promise<void> {
  // ---- 1. The client asks for the hours, and parses what comes back ----
  registerIpc()
  const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args)
  await call('settings:update', { authMode: 'windows' })

  const asked: string[] = []
  setServer((c: any) => {
    asked.push(decodeURIComponent(c.url))
    if (c.url.includes('/_apis/connectionData')) return json(200, { authenticatedUser: { providerDisplayName: 'T' } })
    if (c.url.includes('/wiql/')) return json(200, { workItems: [{ id: 1 }] })
    if (c.url.includes('workitems?ids=')) {
      return json(200, { value: [{ id: 1, fields: {
        'System.Title': 'Task 1', 'System.WorkItemType': 'Task', 'System.State': 'Active',
        'System.IterationPath': 'Proj\\S',
        'Microsoft.VSTS.Scheduling.RemainingWork': 3,
        'Microsoft.VSTS.Scheduling.CompletedWork': 5,
        'Microsoft.VSTS.Scheduling.OriginalEstimate': 6
      } }] })
    }
    return json(404, {})
  })
  const fetched = await call('sprint:refresh', QUERY)
  const fields = asked.find((u) => u.includes('workitems?ids='))!
  check('client asks for Completed and Remaining Work',
    fields.includes('Microsoft.VSTS.Scheduling.RemainingWork') && fields.includes('Microsoft.VSTS.Scheduling.CompletedWork'), fields)
  check('client parses both into the work item',
    fetched.ok && fetched.value[0].remainingWork === 3 && fetched.value[0].completedWork === 5 && fetched.value[0].originalEstimate === 6,
    fetched.value?.[0])

  // A server that rejects the optional fields: the hours are then simply absent, not wrong.
  let firstTry = true
  setServer((c: any) => {
    if (c.url.includes('/_apis/connectionData')) return json(200, { authenticatedUser: { providerDisplayName: 'T' } })
    if (c.url.includes('/wiql/')) return json(200, { workItems: [{ id: 1 }] })
    if (c.url.includes('workitems?ids=')) {
      if (firstTry && decodeURIComponent(c.url).includes('CompletedWork')) {
        firstTry = false
        return json(400, { message: 'TF51535: Cannot find field Microsoft.VSTS.Scheduling.CompletedWork.' })
      }
      return json(200, { value: [{ id: 1, fields: { 'System.Title': 'Task 1', 'System.WorkItemType': 'Task', 'System.State': 'Active', 'Microsoft.VSTS.Scheduling.RemainingWork': 3 } }] })
    }
    return json(404, {})
  })
  const без = await call('sprint:refresh', QUERY)
  check('server without Completed Work: remaining still read, completed left undefined',
    без.value[0].remainingWork === 3 && без.value[0].completedWork === undefined, без.value?.[0])

  // ---- 2. applyRefresh writes the new hours onto the sprint ----
  const before = sprintWith(
    [wi(1, { remainingWork: 8, originalEstimate: 8, completedWork: 0 })],
    { diogo: [b('b1', 1, 8)] }
  )
  const after = applyRefresh(
    before,
    [wi(1, { remainingWork: 3, originalEstimate: 8, completedWork: 5 })],
    ANCHOR,
    () => 'new'
  )
  const item = after.sprint.workItems[1]
  check('work item carries the new Completed and Remaining',
    item.remainingWork === 3 && item.completedWork === 5, item)
  check('the block shrinks to the remaining hours', J(after.sprint.queues.diogo.map((x) => x.hours)) === '[3]', after.sprint.queues.diogo)
  check('reported hours follow Completed Work', reportedHours(item) === 5 && plannedHours(item) === 3)
  // The 5 reported hours are drawn on the days that have passed — as the frozen record of
  // those days where it accounts for them, and as the hatched ribbon for any difference, never
  // as both. What matters is that the past shows 5 and the future 3.
  const drawn = layoutSprint(after.sprint, ANCHOR).diogo.segments
  const pastDrawn = drawn.filter((s) => s.date < ANCHOR).reduce((t, s) => t + s.hours, 0)
  const aheadDrawn = drawn.filter((s) => s.date >= ANCHOR && !s.isDone).reduce((t, s) => t + s.hours, 0)
  check('the calendar draws 5h worked before today and 3h still to do', pastDrawn === 5 && aheadDrawn === 3,
    { pastDrawn, aheadDrawn, drawn })
  check('summary counts it as updated', after.summary.updated === 1, after.summary)

  // ---- 3. Growth, completion, and work that leaves the query ----
  const grown = applyRefresh(before, [wi(1, { remainingWork: 12, originalEstimate: 8, completedWork: 2 })], ANCHOR, () => 'g')
  check('remaining grew → the block grows with it', grown.sprint.queues.diogo.reduce((t, x) => t + x.hours, 0) === 12 &&
    grown.sprint.workItems[1].completedWork === 2, grown.sprint.queues.diogo)

  // Finished: nothing is left to plan, so the task leaves the days ahead. Its eight reported
  // hours are drawn on the days that have passed instead.
  const done = applyRefresh(before, [wi(1, { remainingWork: 0, originalEstimate: 8, completedWork: 8, state: 'Closed' })], ANCHOR, () => 'd')
  const doneDrawn = layoutSprint(done.sprint, ANCHOR).diogo.segments
  check('finished with 8h reported → off the days ahead, drawn behind today',
    done.sprint.queues.diogo.length === 0 && done.summary.completed === 1 &&
    doneDrawn.every((x) => x.date < ANCHOR) && doneDrawn.reduce((t, x) => t + x.hours, 0) === 8,
    [done.sprint.queues.diogo, done.summary, doneDrawn])
  // A task closed with nothing reported against it. A task is worth remaining + completed, so
  // this one is worth nothing and leaves the calendar; its Original Estimate does not hold it
  // there.
  const closedNoHours = (completedWork: number | undefined) => applyRefresh(
    sprintWith([wi(9, { remainingWork: 6, originalEstimate: 6, completedWork })], { diogo: [b('v1', 9, 6)] }),
    [wi(9, { remainingWork: 0, originalEstimate: 6, completedWork, state: 'Closed' })],
    ANCHOR, () => 'v'
  )
  check('closed with nothing reported → leaves the calendar, counted as finished',
    closedNoHours(0).sprint.queues.diogo.length === 0 && closedNoHours(0).summary.completed === 1,
    closedNoHours(0).summary)
  check('the same where the server does not track Completed Work at all',
    closedNoHours(undefined).sprint.queues.diogo.length === 0, closedNoHours(undefined).summary)
  // With no estimate either, there is nothing to keep it there.
  const noEstimate = applyRefresh(
    sprintWith([wi(10, { remainingWork: 6, originalEstimate: 0, completedWork: 0 })], { diogo: [b('v2', 10, 6)] }),
    [wi(10, { remainingWork: 0, originalEstimate: 0, completedWork: 0, state: 'Closed' })],
    ANCHOR, () => 'v2'
  )
  check('no estimate and nothing reported → leaves the calendar, counted as finished',
    noEstimate.sprint.queues.diogo.length === 0 && noEstimate.summary.completed === 1, noEstimate.summary)

  const gone = applyRefresh(before, [], ANCHOR, () => 'x')
  check('no longer in the query → last known hours kept, flagged',
    gone.sprint.workItems[1].remainingWork === 8 && gone.sprint.workItems[1].missingFromQuery === true &&
    gone.sprint.queues.diogo.length === 1, gone.sprint.workItems[1])

  // ---- 4. Hours set by hand ----
  const manual = { ...before, customHours: { 1: 6 } }
  const afterManual = applyRefresh(manual, [wi(1, { remainingWork: 3, originalEstimate: 8, completedWork: 5 })], ANCHOR, () => 'm')
  check('manual hours keep the block, but the item still gets TFS\'s figures',
    afterManual.sprint.queues.diogo[0].hours === 6 &&
    afterManual.sprint.workItems[1].remainingWork === 3 && afterManual.sprint.workItems[1].completedWork === 5,
    [afterManual.sprint.queues.diogo, afterManual.sprint.workItems[1]])

  // ---- 5. A task whose size *is* its reported hours, pinned to a day already past ----
  const reportedOnly = sprintWith(
    [wi(2, { remainingWork: 0, originalEstimate: 0, completedWork: 4 })],
    { diogo: [b('r1', 2, 4, { date: '2026-09-15', startHour: 0 })] }
  )
  const moreReported = applyRefresh(reportedOnly, [wi(2, { remainingWork: 0, originalEstimate: 0, completedWork: 7 })], ANCHOR, () => 'r2')
  const record = layoutSprint(moreReported.sprint, ANCHOR).diogo.segments
  check('a past task with nothing left keeps its slot on the record; the new hours fill the oldest gap',
    moreReported.sprint.queues.diogo.length === 0 &&
    record.some((x) => x.date === '2026-09-15' && x.startHour === 0 && x.hours === 4) &&
    record.reduce((t, x) => t + x.hours, 0) === 7 && record.every((x) => x.isDone && x.date < ANCHOR),
    record)

  // ---- 6. A part-done task pinned in the past, with more still to do ----
  const halfDone = sprintWith(
    [wi(3, { remainingWork: 5, originalEstimate: 10, completedWork: 5 })],
    { diogo: [b('p1', 3, 3, { date: '2026-09-15', startHour: 0 }), b('f1', 3, 5)] }
  )
  const nowMore = applyRefresh(halfDone, [wi(3, { remainingWork: 8, originalEstimate: 10, completedWork: 6 })], ANCHOR, () => 'n1')
  const past = nowMore.sprint.queues.diogo.filter((x) => x.pin)
  const future = nowMore.sprint.queues.diogo.filter((x) => !x.pin)
  const drawnPast = layoutSprint(nowMore.sprint, ANCHOR).diogo.segments.filter((x) => x.date < ANCHOR)
  check('a past pin becomes recorded hours in its slot; what is left flows from today',
    past.length === 0 && future.reduce((t, x) => t + x.hours, 0) === 8 &&
    drawnPast.some((x) => x.date === '2026-09-15' && x.startHour === 0 && x.hours === 3 && x.isDone) &&
    drawnPast.reduce((t, x) => t + x.hours, 0) === 6 && nowMore.sprint.workItems[3].completedWork === 6,
    [nowMore.sprint.queues.diogo, drawnPast])

}

await run()
report()

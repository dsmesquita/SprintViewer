import { describe, expect, it } from 'vitest'
import { planAutoAssign } from '@shared/autoAssign'
import {
  doneToDecide,
  doneWaiting,
  keepDoneInBacklog,
  placeDone,
  returnDoneToBacklog
} from '@shared/doneHours'
import { pinReportedAt, unpinReported } from '@shared/mutations'
import { applyRefresh } from '@shared/refresh'
import { layoutSprint } from '@shared/scheduling'
import type { Sprint } from '@shared/types'
import { block, item, MON, sprint, TUE, WED } from '../../../test/fixtures'

/**
 * A task's done hours apart from its remaining hours: for a task still in the backlog, the user
 * chooses whether its done hours are drawn on the calendar or wait in the backlog as a card.
 */

// Today is Wednesday. Task 1 is on Diogo's calendar; tasks 2 and 3 are in the backlog, both
// with hours done — 2 by Diogo, 3 by someone off the team; task 4 has nothing done; 9 is a
// story. Task 5, finished, has no card anywhere.
const board = (): Sprint =>
  sprint({
    items: [
      item(1, { remainingWork: 4, completedWork: 2, assignedTo: 'Diogo Mesquita' }),
      item(2, { remainingWork: 3, completedWork: 5, assignedTo: 'Diogo Mesquita' }),
      item(3, { remainingWork: 2, completedWork: 1, assignedTo: 'Someone Else' }),
      item(4, { remainingWork: 2, assignedTo: 'Sofia Marques' }),
      item(5, { remainingWork: 0, completedWork: 3, assignedTo: 'Sofia Marques' }),
      item(9, { type: 'User Story', completedWork: 8, assignedTo: 'Diogo Mesquita' })
    ],
    queues: { diogo: [block('a', 1, 4)] },
    backlog: [block('b', 2, 3), block('c', 3, 2), block('d', 4, 2)]
  })
const doneOn = (s: Sprint, workItemId: number) =>
  Object.entries(layoutSprint(s, WED)).flatMap(([memberId, layout]) =>
    layout.segments
      .filter((x) => x.isDone && x.workItemId === workItemId)
      .map((x) => `${memberId} ${x.date}@${x.startHour}+${x.hours}`)
  )

describe('which tasks to ask about', () => {
  it('those not on the calendar, with hours done by someone on the team', () => {
    // 1 is on the calendar, 3 is done by someone off the team, 4 has nothing done, 9 is a story.
    expect(doneToDecide(board())).toEqual([2, 5])
  })

  it('each only once, and never one whose done hours were placed by hand', () => {
    expect(doneToDecide(placeDone(board(), [2]))).toEqual([5])
    expect(doneToDecide(keepDoneInBacklog(board(), [2]))).toEqual([5])
    expect(doneToDecide(pinReportedAt(board(), 5, 'sofia', MON, 0))).toEqual([2])
  })
})

describe('keeping them in the backlog', () => {
  it('they are drawn nowhere, and wait as a card', () => {
    // Drawn after task 1's own two done hours, which sit at the start of Monday.
    expect(doneOn(board(), 2)).toEqual(['diogo 2026-09-14@2+5'])
    const kept = keepDoneInBacklog(board(), [2])
    expect(doneOn(kept, 2)).toEqual([])
    expect(doneWaiting(kept).map((x) => x.id)).toEqual([2])
    // The remaining hours are a card of their own, untouched.
    expect(kept.backlog).toEqual(board().backlog)
  })

  it('dragged onto a day, they are drawn there and stop waiting', () => {
    const placed = pinReportedAt(keepDoneInBacklog(board(), [2]), 2, 'diogo', TUE, 3)
    expect(doneWaiting(placed)).toEqual([])
    expect(doneOn(placed, 2)).toEqual(['diogo 2026-09-15@3+5'])
  })

  it('reset to automatic, they are drawn where their owner worked them', () => {
    const reset = unpinReported(keepDoneInBacklog(board(), [2]), 2)
    expect(doneWaiting(reset)).toEqual([])
    expect(doneOn(reset, 2)).toEqual(['diogo 2026-09-14@2+5'])
  })
})

describe('placing them on the calendar', () => {
  it('they are drawn on their owner’s row, and are not asked about again', () => {
    const placed = placeDone(keepDoneInBacklog(board(), [2, 5]), [2, 5])
    expect(doneWaiting(placed)).toEqual([])
    expect(doneOn(placed, 2)).toEqual(['diogo 2026-09-14@2+5'])
    expect(doneOn(placed, 5)).toEqual(['sofia 2026-09-14@0+3'])
    expect(doneToDecide(placed)).toEqual([])
  })
})

describe('done hours dropped on the backlog', () => {
  it('leave the day they were pinned to and wait as a card', () => {
    const pinned = pinReportedAt(board(), 1, 'diogo', TUE, 0)
    const back = returnDoneToBacklog(pinned, 1)
    expect(back.reportedPins?.[1]).toBeUndefined()
    expect(doneWaiting(back).map((x) => x.id)).toEqual([1])
    expect(doneOn(back, 1)).toEqual([])
    expect(returnDoneToBacklog(back, 1)).toBe(back)
  })
})

describe('a refresh bringing a new task with hours already done', () => {
  const refreshed = () =>
    applyRefresh(
      board(),
      [
        ...Object.values(board().workItems),
        item(6, { remainingWork: 2, completedWork: 3, assignedTo: 'Sofia Marques' })
      ],
      WED,
      () => 'new'
    ).sprint

  it('puts it in the backlog — not on its owner’s calendar — and asks about it', () => {
    const next = refreshed()
    expect(next.backlog.map((b) => b.workItemId)).toContain(6)
    expect(
      Object.values(next.queues)
        .flat()
        .map((b) => b.workItemId)
    ).not.toContain(6)
    expect(doneToDecide(next)).toContain(6)
  })

  it('kept in the backlog, its hours leave the calendar even though the refresh recorded them', () => {
    const next = refreshed()
    expect(doneOn(next, 6).length).toBeGreaterThan(0)
    expect(doneOn(keepDoneInBacklog(next, [6]), 6)).toEqual([])
    expect(doneOn(placeDone(keepDoneInBacklog(next, [6]), [6]), 6)).toEqual(doneOn(next, 6))
  })
})

describe('auto-assign', () => {
  it('places waiting done hours of people on the team, and counts them', () => {
    const kept = keepDoneInBacklog(board(), [2, 3])
    const plan = planAutoAssign(kept, WED)
    expect(plan.summary.donePlaced).toBe(1)
    // 2 belongs to Diogo: drawn on his row. 3 belongs to nobody on the team: it waits on.
    expect(doneWaiting(plan.sprint).map((x) => x.id)).toEqual([3])
    const drawn = doneOn(plan.sprint, 2)
    expect(drawn.every((x) => x.startsWith('diogo '))).toBe(true)
    expect(drawn.reduce((sum, x) => sum + Number(x.split('+')[1]), 0)).toBe(5)
  })
})

import { describe, expect, it } from 'vitest'
import { planAutoAssign } from '@shared/autoAssign'
import { keepDoneInBacklog } from '@shared/doneHours'
import {
  forgetPlacedHidden,
  hideInBacklog,
  shownBacklog,
  unhideInBacklog
} from '@shared/hiddenBacklog'
import { moveBlock, pinBlockAt, pinReportedAt, splitAndReturn } from '@shared/mutations'
import type { Sprint } from '@shared/types'
import { block, ids, item, MON, sprint, WED } from '../../../test/fixtures'

/**
 * Hiding tasks from the backlog: a view of the backlog for deprecated work, which placing the
 * task — by hand or by auto-assign — undoes for good.
 */

// Task 1 is on Diogo's calendar; 2, 3 and 4 wait in the backlog. 2 is Diogo's, 3 Sofia's.
const board = (): Sprint =>
  sprint({
    items: [
      item(1, { remainingWork: 4, assignedTo: 'Diogo Mesquita' }),
      item(2, { remainingWork: 3, completedWork: 2, assignedTo: 'Diogo Mesquita' }),
      item(3, { remainingWork: 2, assignedTo: 'Sofia Marques' }),
      item(4, { remainingWork: 1, assignedTo: 'Someone Else' })
    ],
    queues: { diogo: [block('a', 1, 4)] },
    backlog: [block('b', 2, 3), block('c', 3, 2), block('d', 4, 1)]
  })

// What every board change in the store does: the transform, then this.
const change = (before: Sprint, transform: (s: Sprint) => Sprint): Sprint =>
  forgetPlacedHidden(before, transform(before))

describe('hiding and unhiding', () => {
  it('hides a task in the backlog, and leaves it out of the cards that count', () => {
    const hidden = hideInBacklog(board(), 3)
    expect(hidden.hiddenBacklog).toEqual([3])
    expect(shownBacklog(hidden).map((b) => b.id)).toEqual(['b', 'd'])
    // Nothing else about it changes: it is still in the backlog, in the same place.
    expect(hidden.backlog).toEqual(board().backlog)
  })

  it('only a task waiting in the backlog can be hidden, and only once', () => {
    const s = board()
    expect(hideInBacklog(s, 1)).toBe(s) // on the calendar
    expect(hideInBacklog(s, 99)).toBe(s) // not in the sprint
    const once = hideInBacklog(s, 3)
    expect(hideInBacklog(once, 3)).toBe(once)
  })

  it('done hours waiting in the backlog can be hidden too', () => {
    const s = keepDoneInBacklog(
      { ...board(), queues: { diogo: [block('a', 1, 4), block('b', 2, 3)] }, backlog: [] },
      [2]
    )
    expect(hideInBacklog(s, 2).hiddenBacklog).toEqual([2])
  })

  it('unhiding shows it again; unhiding a task that is not hidden changes nothing', () => {
    const s = hideInBacklog(board(), 3)
    expect(unhideInBacklog(s, 3).hiddenBacklog).toEqual([])
    expect(unhideInBacklog(s, 2)).toBe(s)
  })
})

describe('placing a hidden task shows it again', () => {
  it('dragged onto a calendar: the mark is gone, and returning it does not hide it', () => {
    const hidden = hideInBacklog(board(), 3)
    const placed = change(hidden, (s) => pinBlockAt(s, 'c', 'sofia', WED, 0))
    expect(placed.hiddenBacklog).toEqual([])

    const back = change(placed, (s) => moveBlock(s, 'c', { kind: 'backlog' }, 0))
    expect(shownBacklog(back).map((b) => b.workItemId)).toContain(3)
  })

  it('moved into a queue without a pin counts too', () => {
    const hidden = hideInBacklog(board(), 3)
    const placed = change(hidden, (s) =>
      moveBlock(s, 'c', { kind: 'member', memberId: 'sofia' }, 0)
    )
    expect(placed.hiddenBacklog).toEqual([])
  })

  it('auto-assign places hidden tasks like any other, and they lose the mark', () => {
    const hidden = hideInBacklog(hideInBacklog(board(), 3), 4)
    const plan = planAutoAssign(hidden, WED)
    // 3 belongs to Sofia and is placed on her row; 4 has no owner on the team and stays put.
    expect(plan.sprint.queues.sofia?.map((b) => b.workItemId)).toContain(3)
    const after = forgetPlacedHidden(hidden, plan.sprint)
    expect(after.hiddenBacklog).toEqual([4])
  })

  it('waiting done hours put on a day lose the mark', () => {
    const s = hideInBacklog(
      keepDoneInBacklog(
        { ...board(), queues: { diogo: [block('a', 1, 4), block('b', 2, 3)] }, backlog: [] },
        [2]
      ),
      2
    )
    const placed = change(s, (x) => pinReportedAt(x, 2, 'diogo', MON, 0))
    expect(placed.hiddenBacklog).toEqual([])
  })

  it('a change that places nothing hidden keeps every mark, and the same sprint', () => {
    const hidden = hideInBacklog(board(), 3)
    const moved = change(hidden, (s) => pinBlockAt(s, 'b', 'diogo', WED, 4))
    expect(moved.hiddenBacklog).toEqual([3])

    // A split whose remainder lands in the backlog places nothing from it.
    const split = change(hidden, (s) => splitAndReturn(s, 'a', 2, ids()))
    expect(split.hiddenBacklog).toEqual([3])

    const same = forgetPlacedHidden(hidden, hidden)
    expect(same).toBe(hidden)
  })

  it('a mark with nothing left in the backlog to hide is forgotten', () => {
    const hidden = hideInBacklog(board(), 3)
    const gone = change(hidden, (s) => ({ ...s, backlog: s.backlog.filter((b) => b.id !== 'c') }))
    expect(gone.hiddenBacklog).toEqual([])
  })
})

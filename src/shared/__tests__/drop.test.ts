import { describe, expect, it } from 'vitest'
import { applyDrop, questionFor, slotAt, type DropContext } from '@shared/drop'
import { findBlock } from '@shared/mutations'
import { layoutSprint } from '@shared/scheduling'
import type { Sprint } from '@shared/types'
import { block, drawn, FRI, ids, item, MON, sprint, THU, TUE, WED } from '../../../test/fixtures'

/** What a drop on the calendar does — the same function draws the preview and makes the drop. */

// Today is Wednesday. Diogo has a 16h task A flowing from today (all of Wednesday and
// Thursday), then a 2h task B on Friday morning; C waits in the backlog. A drop on today or
// earlier pins, so the questions about the queue are asked from Thursday on.
const board = (): Sprint =>
  sprint({
    items: [
      item(1, { remainingWork: 16, assignedTo: 'Diogo Mesquita' }),
      item(2, { remainingWork: 2 }),
      item(3, { remainingWork: 3, completedWork: 2, assignedTo: 'Diogo Mesquita' })
    ],
    queues: { diogo: [block('a', 1, 16), block('b', 2, 2)] },
    backlog: [block('c', 3, 3)]
  })
const ctx = (s: Sprint): DropContext => ({
  layouts: layoutSprint(s, WED),
  anchor: WED,
  today: WED,
  newId: ids()
})
const c = { kind: 'block' as const, blockId: 'c', workItemId: 3 }

describe('applyDrop', () => {
  it('ahead of today: joins the queue where it was dropped, and flows', () => {
    const s = board()
    // Friday hour 0 is where B starts, so C goes in front of it.
    const next = applyDrop(s, c, { memberId: 'diogo', date: FRI, hour: 0 }, ctx(s))
    expect(next.queues.diogo.map((x) => x.id)).toEqual(['a', 'c', 'b'])
    expect(findBlock(next, 'c')?.block.pin).toBeUndefined()
  })

  it('on empty space at the end: appended', () => {
    const s = board()
    const next = applyDrop(s, c, { memberId: 'diogo', date: FRI, hour: 5 }, ctx(s))
    expect(next.queues.diogo.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('on today or a day that has passed: pinned to that exact hour', () => {
    const s = board()
    const next = applyDrop(s, c, { memberId: 'sofia', date: TUE, hour: 3 }, ctx(s))
    expect(findBlock(next, 'c')?.block.pin).toEqual({ date: TUE, startHour: 3 })
    expect(drawn(next, WED, 'sofia', 'c')).toEqual(['09-15@3+3'])
  })

  it('inside another task, asked to split: the task parts around the dropped one', () => {
    const s = board()
    // Thursday hour 3 is 11 hours into A.
    const next = applyDrop(s, c, { memberId: 'diogo', date: THU, hour: 3 }, ctx(s), 'split')
    expect(next.queues.diogo.map((x) => [x.id, x.hours])).toEqual([
      ['a', 11],
      ['c', 3],
      ['n1', 5],
      ['b', 2]
    ])
  })

  it('inside another task, keeping it whole: before or after it', () => {
    const s = board()
    const target = { memberId: 'diogo', date: THU, hour: 3 }
    expect(applyDrop(s, c, target, ctx(s), 'after').queues.diogo.map((x) => x.id)).toEqual([
      'a',
      'c',
      'b'
    ])
    expect(applyDrop(s, c, target, ctx(s), 'before').queues.diogo.map((x) => x.id)).toEqual([
      'c',
      'a',
      'b'
    ])
  })

  it('a locked day refuses the drop', () => {
    const s = { ...board(), lockedDays: [THU] }
    expect(applyDrop(s, c, { memberId: 'diogo', date: THU, hour: 0 }, ctx(s))).toBe(s)
  })

  it('reported hours: pinned where dropped before today; ignored on or after it', () => {
    const s = board()
    const done = { kind: 'reported' as const, workItemId: 3 }
    expect(
      applyDrop(s, done, { memberId: 'diogo', date: MON, hour: 2 }, ctx(s)).reportedPins?.[3]
    ).toEqual({
      memberId: 'diogo',
      date: MON,
      startHour: 2
    })
    expect(applyDrop(s, done, { memberId: 'diogo', date: WED, hour: 2 }, ctx(s))).toBe(s)
  })

  it('a row that is not on the board means nothing', () => {
    const s = board()
    expect(applyDrop(s, c, { memberId: 'ghost', date: THU, hour: 0 }, ctx(s))).toBe(s)
  })
})

describe('questionFor', () => {
  it('asks only when the drop lands strictly inside another task, ahead of today', () => {
    const s = board()
    const at = (date: string, hour: number) =>
      questionFor(s, c, { memberId: 'diogo', date, hour }, ctx(s))
    expect(at(THU, 3)).toMatchObject({ blockId: 'a', offset: 11 })
    expect(at(FRI, 0)).toBeNull() // B's first hour: plainly "before B"
    expect(at(FRI, 1)).toBeNull() // B's last hour: plainly "after B"
    expect(at(FRI, 5)).toBeNull() // empty
    expect(at(WED, 3)).toBeNull() // today: a drop here pins, nothing to ask
  })

  it('never about a block landing on itself, or about reported hours', () => {
    const s = board()
    const a = { kind: 'block' as const, blockId: 'a', workItemId: 1 }
    expect(questionFor(s, a, { memberId: 'diogo', date: THU, hour: 3 }, ctx(s))).toBeNull()
    expect(
      questionFor(
        s,
        { kind: 'reported', workItemId: 3 },
        { memberId: 'diogo', date: THU, hour: 3 },
        ctx(s)
      )
    ).toBeNull()
  })
})

describe('slotAt', () => {
  const s = sprint() // 8-hour days
  it('turns a position along the row into a day and an hour', () => {
    expect(slotAt(s, 'diogo', 0, 34)).toEqual({ memberId: 'diogo', date: MON, hour: 0 })
    expect(slotAt(s, 'diogo', 34 * 8 + 34 * 2 + 5, 34)).toEqual({
      memberId: 'diogo',
      date: TUE,
      hour: 2
    })
  })

  it('works at any zoom', () => {
    expect(slotAt(s, 'diogo', 14 * 8 * 2 + 14 * 7 + 13, 14)).toEqual({
      memberId: 'diogo',
      date: WED,
      hour: 7
    })
  })

  it('off either end lands on the first or last hour', () => {
    expect(slotAt(s, 'diogo', -50, 34)).toEqual({ memberId: 'diogo', date: MON, hour: 0 })
    expect(slotAt(s, 'diogo', 1e6, 34)).toEqual({ memberId: 'diogo', date: '2026-09-25', hour: 7 })
  })
})

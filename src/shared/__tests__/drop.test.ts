import { describe, expect, it } from 'vitest'
import { planAutoAssign } from '@shared/autoAssign'
import {
  applyDrop,
  canDrop,
  canLift,
  questionFor,
  shiftBack,
  slotAt,
  type DropContext
} from '@shared/drop'
import { findBlock, lockDay } from '@shared/mutations'
import { layoutSprint } from '@shared/scheduling'
import type { Sprint } from '@shared/types'
import {
  block,
  drawn,
  FRI,
  ids,
  item,
  MON,
  MON2,
  sprint,
  THU,
  TUE,
  WED
} from '../../../test/fixtures'

/**
 * What a drop on the calendar does — the same function draws the preview and makes the drop.
 *
 * A task lands on the hour it is dropped on and stays there (it is pinned), from today on;
 * reported hours go on the past days or today. Locked days, days off and hours past the end of
 * someone's day refuse every drop.
 */

// Today is Wednesday. Diogo has a 16h task A flowing from today (all of Wednesday and
// Thursday), then a 2h task B on Friday morning; C waits in the backlog.
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
const ctx = (s: Sprint): DropContext => ({ layouts: layoutSprint(s, WED), anchor: WED, today: WED })
const c = { kind: 'block' as const, blockId: 'c', workItemId: 3 }
const done = { kind: 'reported' as const, workItemId: 3 }
const drop = (
  s: Sprint,
  memberId: string,
  date: string,
  hour: number,
  choice?: 'split' | 'after' | 'before'
) => applyDrop(s, c, { memberId, date, hour }, ctx(s), choice)
const pinOf = (s: Sprint, id: string) => findBlock(s, id)?.block.pin

describe('a task lands on the hour it is dropped on', () => {
  it('on an empty hour ahead of today: pinned there, exactly', () => {
    const next = drop(board(), 'diogo', FRI, 5)
    expect(pinOf(next, 'c')).toEqual({ date: FRI, startHour: 5 })
    expect(drawn(next, WED, 'diogo', 'c')).toEqual(['09-18@5+3'])
    // Nothing else moved.
    expect(drawn(next, WED, 'diogo', 'a')).toEqual(drawn(board(), WED, 'diogo', 'a'))
    expect(drawn(next, WED, 'diogo', 'b')).toEqual(['09-18@0+2'])
  })

  it('on today, at any hour', () => {
    const next = drop(board(), 'sofia', WED, 3)
    expect(pinOf(next, 'c')).toEqual({ date: WED, startHour: 3 })
    expect(drawn(next, WED, 'sofia', 'c')).toEqual(['09-16@3+3'])
  })

  it('in the second week too, running on into the next day', () => {
    const next = drop(board(), 'sofia', MON2, 6)
    expect(drawn(next, WED, 'sofia', 'c')).toEqual(['09-21@6+2', '09-22@0+1'])
  })

  it('a task already on the calendar slides to where it is dropped', () => {
    const s = board()
    const b = { kind: 'block' as const, blockId: 'b', workItemId: 2 }
    const next = applyDrop(s, b, { memberId: 'diogo', date: MON2, hour: 2 }, ctx(s))
    expect(pinOf(next, 'b')).toEqual({ date: MON2, startHour: 2 })
    expect(drawn(next, WED, 'diogo', 'b')).toEqual(['09-21@2+2'])
  })

  it('is never in its own way: dropped on the hours it is leaving, it lands on them', () => {
    // A covers Wednesday and Thursday; dragged a day on, it starts on Thursday hour 0 even
    // though A itself is drawn there — and nothing asks whether to split it.
    const s = board()
    const a = { kind: 'block' as const, blockId: 'a', workItemId: 1 }
    const target = { memberId: 'diogo', date: THU, hour: 0 }
    expect(questionFor(s, a, target, ctx(s))).toBeNull()
    const next = applyDrop(s, a, target, ctx(s))
    expect(pinOf(next, 'a')).toEqual({ date: THU, startHour: 0 })
    // B, no longer behind A, flows up to today.
    expect(drawn(next, WED, 'diogo', 'b')).toEqual(['09-16@0+2'])
  })
})

describe('dropping on another task', () => {
  it("an unpinned task's first hour: the dropped one goes before it", () => {
    const next = drop(board(), 'diogo', FRI, 0)
    expect(drawn(next, WED, 'diogo', 'c')).toEqual(['09-18@0+3'])
    expect(drawn(next, WED, 'diogo', 'b')).toEqual(['09-18@3+2'])
  })

  it('its last hour: the dropped one goes after it', () => {
    const next = drop(board(), 'diogo', FRI, 1)
    expect(pinOf(next, 'c')).toEqual({ date: FRI, startHour: 2 })
    expect(drawn(next, WED, 'diogo', 'b')).toEqual(['09-18@0+2'])
  })

  it('inside it, split: the dropped one takes the hour and the task parts around it', () => {
    // Thursday hour 3 is 11 hours into A.
    const next = drop(board(), 'diogo', THU, 3, 'split')
    expect(pinOf(next, 'c')).toEqual({ date: THU, startHour: 3 })
    expect(drawn(next, WED, 'diogo', 'c')).toEqual(['09-17@3+3'])
    expect(drawn(next, WED, 'diogo', 'a')).toEqual([
      '09-16@0+8',
      '09-17@0+3',
      '09-17@6+2',
      '09-18@0+3'
    ])
  })

  it('inside it, kept whole: the dropped one goes at its start or its end', () => {
    const before = drop(board(), 'diogo', THU, 3, 'before')
    expect(pinOf(before, 'c')).toEqual({ date: WED, startHour: 0 })
    expect(drawn(before, WED, 'diogo', 'a')).toEqual(['09-16@3+5', '09-17@0+8', '09-18@0+3'])

    // A ends with Thursday, so "after it" is Friday's first hour, not Thursday's ninth.
    const after = drop(board(), 'diogo', THU, 3, 'after')
    expect(pinOf(after, 'c')).toEqual({ date: FRI, startHour: 0 })
    expect(drawn(after, WED, 'diogo', 'a')).toEqual(['09-16@0+8', '09-17@0+8'])
  })

  it('a pinned task holds its place: the dropped one goes straight after it', () => {
    const s: Sprint = {
      ...board(),
      queues: { ...board().queues, sofia: [block('m', 2, 2, { date: THU, startHour: 2 })] }
    }
    for (const hour of [2, 3]) {
      const next = applyDrop(s, c, { memberId: 'sofia', date: THU, hour }, ctx(s))
      expect(pinOf(next, 'm')).toEqual({ date: THU, startHour: 2 })
      expect(pinOf(next, 'c')).toEqual({ date: THU, startHour: 4 })
    }
  })
})

describe('where a task cannot go', () => {
  const refused = (s: Sprint, memberId: string, date: string, hour: number) =>
    expect(applyDrop(s, c, { memberId, date, hour }, ctx(s))).toBe(s)

  it('a day that has passed: work still to do cannot be planned into the past', () => {
    refused(board(), 'sofia', TUE, 3)
    refused(board(), 'diogo', MON, 0)
  })

  it('a locked day', () => {
    refused({ ...board(), lockedDays: [THU] }, 'diogo', THU, 0)
  })

  it('a day the person is not working, or past the end of a short day', () => {
    const s = { ...board(), capacityOverrides: { sofia: { [FRI]: 0, [THU]: 4 } } }
    refused(s, 'sofia', FRI, 2)
    refused(s, 'sofia', THU, 4)
    const next = applyDrop(s, c, { memberId: 'sofia', date: THU, hour: 3 }, ctx(s))
    expect(pinOf(next, 'c')).toEqual({ date: THU, startHour: 3 })
  })

  it('a day off for everyone', () => {
    const s = board()
    const off = {
      ...s,
      days: s.days.map((day) => (day.date === THU ? { ...day, capacity: 0 } : day))
    }
    refused(off, 'diogo', THU, 0)
  })

  it('a row that is not on the board', () => {
    refused(board(), 'ghost', THU, 0)
  })
})

describe('locked days: nothing goes in or out', () => {
  it('a dropped task that would run onto a locked day jumps it', () => {
    // C (3h) dropped on Friday hour 6, with next Monday locked: Friday 6–8, then Tuesday.
    const s = { ...board(), lockedDays: [MON2] }
    const next = drop(s, 'sofia', FRI, 6)
    expect(pinOf(next, 'c')).toEqual({ date: FRI, startHour: 6 })
    expect(drawn(next, WED, 'sofia', 'c')).toEqual(['09-18@6+2', '09-22@0+1'])
  })

  it('a task with any part on a locked day cannot be lifted, anywhere', () => {
    // A runs Wednesday and Thursday; Thursday is locked (locking pins A's Thursday part there).
    const s = lockDay(board(), THU, WED, ids())
    const thursdayPart = s.queues.diogo.find((b) => b.pin?.date === THU)!
    const subject = { kind: 'block' as const, blockId: thursdayPart.id, workItemId: 1 }
    expect(canLift(s, subject, ctx(s).layouts)).toBe(false)
    expect(applyDrop(s, subject, { memberId: 'diogo', date: FRI, hour: 5 }, ctx(s))).toBe(s)
    // Its Wednesday part is not on the locked day: that one moves.
    const wednesday = { kind: 'block' as const, blockId: 'a', workItemId: 1 }
    expect(canLift(s, wednesday, ctx(s).layouts)).toBe(true)
  })

  it('reported hours on a locked day stay where they are', () => {
    const s = {
      ...board(),
      reportedPins: { 3: { memberId: 'diogo', date: MON, startHour: 0 } },
      lockedDays: [MON]
    }
    expect(canLift(s, done, ctx(s).layouts)).toBe(false)
    expect(applyDrop(s, done, { memberId: 'diogo', date: TUE, hour: 2 }, ctx(s))).toBe(s)
  })
})

describe('reported hours', () => {
  it('go on any day that has passed, at the hour dropped', () => {
    const s = board()
    const next = applyDrop(s, done, { memberId: 'diogo', date: MON, hour: 2 }, ctx(s))
    expect(next.reportedPins?.[3]).toEqual({ memberId: 'diogo', date: MON, startHour: 2 })
  })

  it('go on today too, drawn from its start with the plan after them', () => {
    const s = board()
    const next = applyDrop(s, done, { memberId: 'sofia', date: WED, hour: 5 }, ctx(s))
    expect(next.reportedPins?.[3]).toEqual({ memberId: 'sofia', date: WED, startHour: 5 })
    const sofia = layoutSprint(next, WED).sofia.segments.filter((x) => x.isDone)
    expect(sofia.map((x) => [x.date, x.startHour, x.hours])).toEqual([[WED, 0, 2]])
  })

  it('never after today, nor on a locked day or a day off', () => {
    const s = { ...board(), lockedDays: [TUE], capacityOverrides: { diogo: { [MON]: 0 } } }
    for (const [date, hour] of [
      [THU, 0],
      [TUE, 1],
      [MON, 1]
    ] as const) {
      expect(applyDrop(s, done, { memberId: 'diogo', date, hour }, ctx(s))).toBe(s)
    }
  })
})

describe('canDrop and questionFor', () => {
  it('canDrop answers what applyDrop refuses', () => {
    const s = board()
    expect(canDrop(s, c, { memberId: 'diogo', date: TUE, hour: 0 }, ctx(s))).toBe(false)
    expect(canDrop(s, c, { memberId: 'diogo', date: WED, hour: 0 }, ctx(s))).toBe(true)
    expect(canDrop(s, done, { memberId: 'diogo', date: WED, hour: 0 }, ctx(s))).toBe(true)
    expect(canDrop(s, done, { memberId: 'diogo', date: THU, hour: 0 }, ctx(s))).toBe(false)
  })

  it('asks only when the drop lands strictly inside an unpinned task', () => {
    const s = board()
    const at = (date: string, hour: number) =>
      questionFor(s, c, { memberId: 'diogo', date, hour }, ctx(s))
    expect(at(THU, 3)).toMatchObject({ blockId: 'a', offset: 11 })
    expect(at(WED, 3)).toMatchObject({ blockId: 'a', offset: 3 }) // today, like any other day
    expect(at(FRI, 0)).toBeNull() // B's first hour: plainly "before B"
    expect(at(FRI, 1)).toBeNull() // B's last hour: plainly "after B"
    expect(at(FRI, 5)).toBeNull() // empty
    expect(at(TUE, 3)).toBeNull() // refused: nothing to ask
  })

  it('never about a pinned task, reported hours, or a block landing on itself', () => {
    const s: Sprint = {
      ...board(),
      queues: { ...board().queues, sofia: [block('m', 2, 6, { date: THU, startHour: 0 })] }
    }
    expect(questionFor(s, c, { memberId: 'sofia', date: THU, hour: 3 }, ctx(s))).toBeNull()
    expect(questionFor(s, done, { memberId: 'diogo', date: MON, hour: 3 }, ctx(s))).toBeNull()
    const a = { kind: 'block' as const, blockId: 'a', workItemId: 1 }
    expect(questionFor(s, a, { memberId: 'diogo', date: THU, hour: 3 }, ctx(s))).toBeNull()
  })
})

describe('after auto-assign', () => {
  // Auto-assign pins meetings and chained VALs. Dragging one on used to unpin it and let it
  // flow back to today; it must land where it is dropped.
  const assigned = (): Sprint => {
    const s = sprint({
      items: [
        item(10, { title: 'Meetings', assignedTo: 'Sofia Marques', remainingWork: 6 }),
        item(11, {
          title: 'DEV:: Export',
          parentId: 99,
          assignedTo: 'Diogo Mesquita',
          remainingWork: 12
        }),
        item(12, {
          title: 'VAL:: Export',
          parentId: 99,
          assignedTo: 'Sofia Marques',
          remainingWork: 3
        })
      ],
      backlog: [block('meet', 10, 6), block('dev', 11, 12), block('val', 12, 3)]
    })
    let n = 0
    return planAutoAssign(s, WED, { newId: () => `p${++n}` }).sprint
  }

  it('a meeting piece moves to the hour it is dropped on', () => {
    const s = assigned()
    expect(pinOf(s, 'meet')).toBeDefined()
    const meet = { kind: 'block' as const, blockId: 'meet', workItemId: 10 }
    const next = applyDrop(s, meet, { memberId: 'sofia', date: FRI, hour: 5 }, ctx(s))
    expect(pinOf(next, 'meet')).toEqual({ date: FRI, startHour: 5 })
    expect(drawn(next, WED, 'sofia', 'meet')).toEqual(['09-18@5+2'])
  })

  it('a chained VAL moves to the day it is dropped on', () => {
    const s = assigned()
    expect(pinOf(s, 'val')).toBeDefined()
    const val = { kind: 'block' as const, blockId: 'val', workItemId: 12 }
    const next = applyDrop(s, val, { memberId: 'sofia', date: MON2, hour: 3 }, ctx(s))
    expect(drawn(next, WED, 'sofia', 'val')).toEqual(['09-21@3+3'])
  })
})

describe('shiftBack', () => {
  const at = (date: string, hour: number) => ({ memberId: 'sofia', date, hour })

  it('counts back within the day', () => {
    expect(shiftBack(board(), at(THU, 5), 3)).toEqual(at(THU, 2))
    expect(shiftBack(board(), at(THU, 5), 0)).toEqual(at(THU, 5))
  })

  it('carries on into the day before, from the end of its working hours', () => {
    expect(shiftBack(board(), at(THU, 2), 3)).toEqual(at(WED, 7))
    expect(shiftBack(board(), at(FRI, 2), 10)).toEqual(at(THU, 0))
  })

  it('skips days the person is not working, and counts a short day as short', () => {
    const s = { ...board(), capacityOverrides: { sofia: { [WED]: 0, [TUE]: 4 } } }
    expect(shiftBack(s, at(THU, 1), 2)).toEqual(at(TUE, 3))
  })

  it('stops at the start of the sprint', () => {
    expect(shiftBack(board(), at(TUE, 1), 20)).toEqual(at(MON, 0))
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

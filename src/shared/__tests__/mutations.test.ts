import { describe, expect, it } from 'vitest'
import {
  clearCalendar,
  clearCalendarCost,
  findBlock,
  lockDay,
  moveBlock,
  pinBlockAt,
  pinReportedAt,
  setDayCapacity,
  setHoursPerDay,
  setMemberCapacity,
  splitAndReturn,
  splitInPlace,
  splitIntoN,
  unlockDay,
  unpinBlock,
  unpinReported
} from '@shared/mutations'
import { block, drawn, FRI, ids, item, MON, sprint, THU, TUE, WED } from '../../../test/fixtures'

const three = () =>
  sprint({
    items: [
      item(1, { remainingWork: 4 }),
      item(2, { remainingWork: 4 }),
      item(3, { remainingWork: 2 })
    ],
    queues: { diogo: [block('a', 1, 4), block('b', 2, 4)] },
    backlog: [block('c', 3, 2)]
  })

const order = (s: ReturnType<typeof sprint>, memberId = 'diogo') =>
  s.queues[memberId].map((b) => b.id)

describe('findBlock', () => {
  it('finds a block in a queue, with its index', () => {
    expect(findBlock(three(), 'b')).toMatchObject({
      location: { kind: 'member', memberId: 'diogo' },
      index: 1
    })
  })
  it('finds a block in the backlog', () => {
    expect(findBlock(three(), 'c')?.location).toEqual({ kind: 'backlog' })
  })
  it('returns null for an unknown block', () => {
    expect(findBlock(three(), 'nope')).toBeNull()
  })
})

describe('moveBlock', () => {
  it('moves a backlog card onto a queue at the given index', () => {
    const s = moveBlock(three(), 'c', { kind: 'member', memberId: 'diogo' }, 1)
    expect(order(s)).toEqual(['a', 'c', 'b'])
    expect(s.backlog).toEqual([])
  })

  it('moving right within the same queue lands where pointed, not one short', () => {
    // Dropping `a` "before index 2" means after `b`.
    expect(order(moveBlock(three(), 'a', { kind: 'member', memberId: 'diogo' }, 2))).toEqual([
      'b',
      'a'
    ])
  })

  it('moves to another person', () => {
    const s = moveBlock(three(), 'a', { kind: 'member', memberId: 'sofia' }, 0)
    expect(order(s)).toEqual(['b'])
    expect(order(s, 'sofia')).toEqual(['a'])
  })

  it('an ordinary move unpins the block', () => {
    const pinned = pinBlockAt(three(), 'a', 'diogo', WED, 2)
    const s = moveBlock(pinned, 'a', { kind: 'member', memberId: 'diogo' }, 0)
    expect(findBlock(s, 'a')?.block.pin).toBeUndefined()
  })

  it('returning to the backlog merges with a card of the same work item', () => {
    const s = sprint({
      items: [item(1, { remainingWork: 6 })],
      queues: { diogo: [block('a', 1, 4)] },
      backlog: [block('rest', 1, 2)]
    })
    const back = moveBlock(s, 'a', { kind: 'backlog' }, 0)
    expect(back.backlog).toEqual([block('rest', 1, 6)])
  })

  it('does nothing for an unknown block', () => {
    const s = three()
    expect(moveBlock(s, 'nope', { kind: 'backlog' }, 0)).toBe(s)
  })
})

describe('pinBlockAt / unpinBlock', () => {
  it('pins a block where it stands in its own queue', () => {
    const s = pinBlockAt(three(), 'b', 'diogo', WED, 3)
    expect(order(s)).toEqual(['a', 'b'])
    expect(findBlock(s, 'b')?.block.pin).toEqual({ date: WED, startHour: 3 })
    expect(drawn(s, MON, 'diogo', 'b')).toEqual(['09-16@3+4'])
  })

  it('pins a backlog card onto someone, appended to their queue', () => {
    const s = pinBlockAt(three(), 'c', 'sofia', THU, 0)
    expect(order(s, 'sofia')).toEqual(['c'])
    expect(s.backlog).toEqual([])
  })

  it('a negative hour becomes the start of the day', () => {
    expect(findBlock(pinBlockAt(three(), 'a', 'diogo', TUE, -2), 'a')?.block.pin?.startHour).toBe(0)
  })

  it('unpinning lets the block flow again; unpinning an unpinned block is a no-op', () => {
    const pinned = pinBlockAt(three(), 'a', 'diogo', FRI, 0)
    expect(findBlock(unpinBlock(pinned, 'a'), 'a')?.block.pin).toBeUndefined()
    const s = three()
    expect(unpinBlock(s, 'a')).toBe(s)
  })
})

describe('reported pins', () => {
  it('records where reported hours were worked, clamped to the start of the day', () => {
    const s = pinReportedAt(three(), 1, 'diogo', TUE, -1)
    expect(s.reportedPins?.[1]).toEqual({ memberId: 'diogo', date: TUE, startHour: 0 })
  })
  it('unpinning removes it; unpinning nothing is a no-op', () => {
    const s = pinReportedAt(three(), 1, 'diogo', TUE, 2)
    expect(unpinReported(s, 1).reportedPins?.[1]).toBeUndefined()
    const plain = three()
    expect(unpinReported(plain, 1)).toBe(plain)
  })
})

describe('splitting', () => {
  it('splitAndReturn keeps some hours in place and sends the rest to the backlog', () => {
    const s = splitAndReturn(three(), 'a', 1, ids())
    expect(findBlock(s, 'a')?.block.hours).toBe(1)
    expect(s.backlog.map((b) => [b.workItemId, b.hours])).toEqual([
      [3, 2],
      [1, 3]
    ])
  })

  it('splitAndReturn refuses a split that keeps nothing or everything', () => {
    const s = three()
    expect(splitAndReturn(s, 'a', 0, ids())).toBe(s)
    expect(splitAndReturn(s, 'a', 4, ids())).toBe(s)
  })

  it('splitIntoN keeps the first part in place and queues the rest in the backlog', () => {
    const s = sprint({
      items: [item(1, { remainingWork: 6 })],
      queues: { diogo: [block('a', 1, 6)] }
    })
    const split = splitIntoN(s, 'a', [2, 2, 2], ids())
    expect(findBlock(split, 'a')?.block.hours).toBe(2)
    // The two backlog parts belong to the same work item, so they rejoin as one card.
    expect(split.backlog).toEqual([block('n1', 1, 4)])
  })

  it('splitIntoN needs at least two parts', () => {
    const s = three()
    expect(splitIntoN(s, 'a', [4], ids())).toBe(s)
  })

  it('splitInPlace cuts a block in two, both halves staying in order in the queue', () => {
    const s = splitInPlace(three(), 'a', 1, ids())
    expect(s.queues.diogo.map((b) => [b.id, b.hours])).toEqual([
      ['a', 1],
      ['n1', 3],
      ['b', 4]
    ])
  })

  it('splitInPlace ignores backlog cards and out-of-range cuts', () => {
    const s = three()
    expect(splitInPlace(s, 'c', 1, ids())).toBe(s)
    expect(splitInPlace(s, 'a', 4, ids())).toBe(s)
  })
})

describe('locking days', () => {
  it('lockDay adds the day once', () => {
    const once = lockDay(three(), WED, MON, ids())
    expect(lockDay(once, WED, MON, ids()).lockedDays).toEqual([WED])
  })

  it('a block running into the locked day is cut at the boundary, the rest to the backlog', () => {
    // 12h from Monday: Monday 8h, Tuesday 4h. Locking Tuesday leaves Monday's 8 in place.
    const s = sprint({
      items: [item(1, { remainingWork: 12 })],
      queues: { diogo: [block('a', 1, 12)] }
    })
    const locked = lockDay(s, TUE, MON, ids())
    expect(findBlock(locked, 'a')?.block.hours).toBe(8)
    expect(locked.backlog).toEqual([block('n1', 1, 4)])
  })

  it('a block that does not reach the locked day is left whole', () => {
    // 12h from Monday: Monday 8h, Tuesday 4h. Locking Thursday touches neither.
    const s = sprint({
      items: [item(1, { remainingWork: 12 })],
      queues: { diogo: [block('a', 1, 12)] }
    })
    expect(lockDay(s, THU, MON, ids())).toEqual({ ...s, lockedDays: [THU] })
  })

  it('a block over several days keeps every day before the locked one', () => {
    // 20h from Monday: Monday 8h, Tuesday 8h, Wednesday 4h. Locking Wednesday keeps 16.
    const s = sprint({
      items: [item(1, { remainingWork: 20 })],
      queues: { diogo: [block('a', 1, 20)] }
    })
    const locked = lockDay(s, WED, MON, ids())
    expect(findBlock(locked, 'a')?.block.hours).toBe(16)
    expect(locked.backlog).toEqual([block('n1', 1, 4)])
  })

  it('a block that starts on the locked day stays where it is', () => {
    // A (8h) fills Monday, so B starts on Tuesday: locking Tuesday leaves both whole.
    const s = sprint({
      items: [item(1, { remainingWork: 8 }), item(2, { remainingWork: 4 })],
      queues: { diogo: [block('a', 1, 8), block('b', 2, 4)] }
    })
    expect(lockDay(s, TUE, MON, ids())).toEqual({ ...s, lockedDays: [TUE] })
  })

  it('only the blocks running into the locked day are cut, on every row', () => {
    const s = sprint({
      items: [item(1, { remainingWork: 12 }), item(2, { remainingWork: 10 })],
      queues: { diogo: [block('a', 1, 12)], sofia: [block('b', 2, 10)] }
    })
    const locked = lockDay(s, TUE, MON, ids())
    expect(findBlock(locked, 'a')?.block.hours).toBe(8)
    expect(findBlock(locked, 'b')?.block.hours).toBe(8)
    expect(locked.backlog.map((x) => [x.workItemId, x.hours])).toEqual([
      [1, 4],
      [2, 2]
    ])
  })

  it('unlockDay removes it', () => {
    expect(unlockDay(lockDay(three(), WED, MON, ids()), WED).lockedDays).toEqual([])
  })
})

describe('clearCalendar', () => {
  it('sends every block back to the backlog, unpinned, and drops the records', () => {
    const s = pinBlockAt(three(), 'a', 'diogo', TUE, 0)
    const cleared = clearCalendar({
      ...s,
      pastRecord: { diogo: {} },
      reportedPins: { 1: { memberId: 'diogo', date: MON, startHour: 0 } }
    })
    expect(cleared.queues.diogo).toEqual([])
    expect(cleared.backlog.map((b) => b.id).sort()).toEqual(['a', 'b', 'c'])
    expect(cleared.backlog.every((b) => b.pin === undefined)).toBe(true)
    expect(cleared.pastRecord).toBeUndefined()
    expect(cleared.reportedPins).toEqual({})
    expect(cleared.history).toEqual({})
  })

  it('keeps blocks pinned to a locked day', () => {
    const s = { ...pinBlockAt(three(), 'a', 'diogo', TUE, 0), lockedDays: [TUE] }
    expect(order(clearCalendar(s))).toEqual(['a'])
  })

  it('parts of one task rejoin as a single card', () => {
    const s = sprint({
      items: [item(1, { remainingWork: 6 })],
      queues: { diogo: [block('a', 1, 4)], sofia: [block('b', 1, 2)] }
    })
    expect(clearCalendar(s).backlog).toEqual([block('a', 1, 6)])
  })

  it('clearCalendarCost counts blocks and recorded days', () => {
    const s = {
      ...three(),
      history: {
        diogo: {
          [MON]: [
            {
              blockId: 'x',
              workItemId: 1,
              date: MON,
              startHour: 0,
              hours: 2,
              continued: false,
              continues: false
            }
          ]
        }
      },
      pastRecord: {
        sofia: {
          [TUE]: [
            {
              blockId: 'y',
              workItemId: 2,
              date: TUE,
              startHour: 0,
              hours: 1,
              continued: false,
              continues: false
            }
          ],
          [WED]: []
        }
      }
    }
    expect(clearCalendarCost(s)).toEqual({ blocks: 2, recordedDays: 2 })
  })
})

describe('setHoursPerDay', () => {
  const shaped = () =>
    ({
      ...pinBlockAt(three(), 'a', 'diogo', WED, 7),
      days: sprint().days.map((d) =>
        d.date === TUE
          ? { ...d, capacity: 0, label: 'Day off' }
          : d.date === WED
            ? { ...d, capacity: 4, label: 'Half day' }
            : d
      ),
      capacityOverrides: { sofia: { [THU]: 2 } },
      reportedPins: { 2: { memberId: 'diogo', date: MON, startHour: 7 } }
    }) as ReturnType<typeof sprint>

  it('full days follow the new length; off stays off; half stays half, labels kept', () => {
    const s = setHoursPerDay(shaped(), 6)
    expect(s.hoursPerDay).toBe(6)
    expect(s.days.find((d) => d.date === MON)?.capacity).toBe(6)
    expect(s.days.find((d) => d.date === TUE)).toMatchObject({ capacity: 0, label: 'Day off' })
    expect(s.days.find((d) => d.date === WED)).toMatchObject({ capacity: 3, label: 'Half day' })
  })

  it('personal overrides scale too', () => {
    expect(setHoursPerDay(shaped(), 6).capacityOverrides.sofia[THU]).toBe(1.5)
  })

  it('pins past the end of a shorter day are pulled back inside it', () => {
    const s = setHoursPerDay(shaped(), 6)
    expect(findBlock(s, 'a')?.block.pin).toEqual({ date: WED, startHour: 5 })
    expect(s.reportedPins?.[2].startHour).toBe(5)
  })

  it('recorded pieces are trimmed to the shorter day', () => {
    const piece = {
      blockId: 'done:1',
      workItemId: 1,
      date: MON,
      startHour: 4,
      hours: 4,
      continued: false,
      continues: false,
      isDone: true
    }
    const s = setHoursPerDay({ ...shaped(), pastRecord: { diogo: { [MON]: [piece] } } }, 6)
    expect(s.pastRecord?.diogo[MON]).toEqual([{ ...piece, hours: 2, continues: true }])
  })

  it('the same length, or nonsense, changes nothing; values are rounded and clamped', () => {
    const s = shaped()
    expect(setHoursPerDay(s, 8)).toBe(s)
    expect(setHoursPerDay(s, 30).hoursPerDay).toBe(24)
    expect(setHoursPerDay(s, 0.2).hoursPerDay).toBe(1)
    expect(setHoursPerDay(s, 6.4).hoursPerDay).toBe(6)
  })
})

describe('capacity', () => {
  it('setDayCapacity sets a team-wide capacity and label, clamped to the day', () => {
    const s = setDayCapacity(three(), TUE, 12, 'Long day')
    expect(s.days.find((d) => d.date === TUE)).toEqual({
      date: TUE,
      capacity: 8,
      label: 'Long day'
    })
    expect(setDayCapacity(three(), TUE, -3).days.find((d) => d.date === TUE)?.capacity).toBe(0)
  })

  it('setMemberCapacity sets and clears one person’s day', () => {
    const set = setMemberCapacity(three(), 'sofia', WED, 4)
    expect(set.capacityOverrides.sofia).toEqual({ [WED]: 4 })
    expect(setMemberCapacity(set, 'sofia', WED, null).capacityOverrides.sofia).toEqual({})
  })

  it('a personal day off moves that person’s work, and only theirs', () => {
    const s = setMemberCapacity(three(), 'diogo', MON, 0)
    expect(drawn(s, MON, 'diogo', 'a')).toEqual(['09-15@0+4'])
  })
})

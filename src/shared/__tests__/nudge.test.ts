import { describe, expect, it } from 'vitest'
import { setDayCapacity } from '@shared/mutations'
import { nudgeBlock, nudgeReported } from '@shared/nudge'
import { block, drawn, FRI, item, MON, MON2, sprint, TUE, WED } from '../../../test/fixtures'

/** Shift + ← / → moves the selected task one working hour. */

const pinOf = (s: ReturnType<typeof sprint>, id: string) =>
  Object.values(s.queues)
    .flat()
    .find((b) => b.id === id)?.pin

describe('nudgeBlock', () => {
  it('into free time: moves one hour and pins there', () => {
    const s = sprint({
      items: [item(1, { remainingWork: 4 })],
      queues: { diogo: [block('a', 1, 4)] }
    })
    const next = nudgeBlock(s, 'a', 1, MON)
    expect(pinOf(next, 'a')).toEqual({ date: MON, startHour: 1 })
    expect(drawn(next, MON)).toEqual(['09-14@1+4'])
  })

  it('into a neighbour: two flowing blocks swap places in the queue', () => {
    const s = sprint({
      items: [item(1, { remainingWork: 4 }), item(2, { remainingWork: 4 })],
      queues: { diogo: [block('a', 1, 4), block('b', 2, 4)] }
    })
    const next = nudgeBlock(s, 'a', 1, MON)
    expect(next.queues.diogo.map((b) => b.id)).toEqual(['b', 'a'])
    expect(pinOf(next, 'a')).toBeUndefined()
  })

  it('with a pinned block involved, both are pinned in their new order', () => {
    const s = sprint({
      items: [item(1, { remainingWork: 2 }), item(2, { remainingWork: 3 })],
      queues: { diogo: [block('a', 1, 2, { date: MON, startHour: 0 }), block('b', 2, 3)] }
    })
    const next = nudgeBlock(s, 'a', 1, MON)
    expect(drawn(next, MON, 'diogo', 'b')).toEqual(['09-14@0+3'])
    expect(drawn(next, MON, 'diogo', 'a')).toEqual(['09-14@3+2'])
  })

  it('skips the weekend: the last hour of Friday steps onto Monday', () => {
    const s = sprint({
      items: [item(1, { remainingWork: 1 })],
      queues: { diogo: [block('a', 1, 1, { date: FRI, startHour: 7 })] }
    })
    expect(pinOf(nudgeBlock(s, 'a', 1, MON), 'a')).toEqual({ date: MON2, startHour: 0 })
  })

  it('skips a day off', () => {
    const s = setDayCapacity(
      sprint({
        items: [item(1, { remainingWork: 1 })],
        queues: { diogo: [block('a', 1, 1, { date: MON, startHour: 7 })] }
      }),
      TUE,
      0
    )
    expect(pinOf(nudgeBlock(s, 'a', 1, MON), 'a')).toEqual({ date: WED, startHour: 0 })
  })

  it('does nothing at the start of the sprint', () => {
    const s = sprint({
      items: [item(1, { remainingWork: 4 })],
      queues: { diogo: [block('a', 1, 4)] }
    })
    expect(nudgeBlock(s, 'a', -1, MON)).toBe(s)
  })

  it('jumps a locked day, as it would a day off', () => {
    // At the end of Monday; Tuesday is locked, so one step on is Wednesday morning.
    const s = sprint({
      items: [item(1, { remainingWork: 1 })],
      queues: { diogo: [block('a', 1, 1, { date: MON, startHour: 7 })] }
    })
    const next = nudgeBlock({ ...s, lockedDays: [TUE] }, 'a', 1, MON)
    expect(pinOf(next, 'a')).toEqual({ date: WED, startHour: 0 })
    expect(drawn(next, MON)).toEqual(['09-16@0+1'])
  })

  it('a task running up to a locked day carries on past it', () => {
    // 2h from Monday hour 6: one step on is Monday 7, and its second hour jumps locked Tuesday.
    const s = sprint({
      items: [item(1, { remainingWork: 2 })],
      queues: { diogo: [block('a', 1, 2, { date: MON, startHour: 6 })] },
      lockedDays: [TUE]
    })
    expect(drawn(nudgeBlock(s, 'a', 1, MON), MON)).toEqual(['09-14@7+1', '09-16@0+1'])
  })

  it('nothing on a locked day moves', () => {
    const s = sprint({
      items: [item(1, { remainingWork: 1 })],
      queues: { diogo: [block('a', 1, 1, { date: MON, startHour: 3 })] },
      lockedDays: [MON]
    })
    expect(nudgeBlock(s, 'a', -1, MON)).toBe(s)
    expect(nudgeBlock(s, 'a', 1, MON)).toBe(s)
  })

  it('never into the past: work still to do stops at the start of today', () => {
    const s = sprint({
      items: [item(1, { remainingWork: 2 })],
      queues: { diogo: [block('a', 1, 2)] }
    })
    // Flowing from today's first hour: one step back would be yesterday.
    expect(nudgeBlock(s, 'a', -1, WED)).toBe(s)
    const later = nudgeBlock(s, 'a', 1, WED)
    expect(pinOf(later, 'a')).toEqual({ date: WED, startHour: 1 })
    expect(pinOf(nudgeBlock(later, 'a', -1, WED), 'a')).toEqual({ date: WED, startHour: 0 })
  })

  it('never swaps a task into the past either', () => {
    // An old pin from before today sits right before A: swapping would put A behind it, before
    // today.
    const s = sprint({
      items: [item(1, { remainingWork: 2 }), item(2, { remainingWork: 2 })],
      queues: {
        diogo: [block('old', 2, 2, { date: TUE, startHour: 6 }), block('a', 1, 2)]
      }
    })
    expect(nudgeBlock(s, 'a', -1, WED)).toBe(s)
  })

  it('does not trade places with reported hours', () => {
    // Monday holds eight reported hours; the block starts Tuesday, today.
    const s = sprint({
      items: [
        item(1, { remainingWork: 2 }),
        item(5, { completedWork: 8, assignedTo: 'Diogo Mesquita' })
      ],
      queues: { diogo: [block('a', 1, 2, { date: TUE, startHour: 0 })] }
    })
    expect(nudgeBlock(s, 'a', -1, TUE)).toBe(s)
  })

  it('does nothing for a backlog card or an unknown block', () => {
    const s = sprint({ items: [item(1, { remainingWork: 2 })], backlog: [block('c', 1, 2)] })
    expect(nudgeBlock(s, 'c', 1, MON)).toBe(s)
    expect(nudgeBlock(s, 'zz', 1, MON)).toBe(s)
  })
})

describe('nudgeReported', () => {
  const reported = (completedWork: number) =>
    sprint({ items: [item(5, { completedWork, assignedTo: 'Diogo Mesquita' })] })

  it('slides the done hours through free time before today, and pins them', () => {
    // Two reported hours sit at the start of Monday (the oldest free time).
    const next = nudgeReported(reported(2), 5, 1, WED)
    expect(next.reportedPins?.[5]).toEqual({ memberId: 'diogo', date: MON, startHour: 1 })
  })

  it('cannot move before the sprint starts', () => {
    const s = reported(2)
    expect(nudgeReported(s, 5, -1, WED)).toBe(s)
  })

  it('can step onto today, where it is drawn from the start of the day, and no further', () => {
    // Two done hours pinned to the end of Tuesday; today is Wednesday.
    const s = {
      ...reported(2),
      reportedPins: { 5: { memberId: 'diogo', date: TUE, startHour: 6 } }
    }
    const step = nudgeReported(s, 5, 1, WED, WED)
    expect(step.reportedPins?.[5]).toEqual({ memberId: 'diogo', date: TUE, startHour: 7 })
    const onto = nudgeReported(step, 5, 1, WED, WED)
    expect(onto.reportedPins?.[5]).toEqual({ memberId: 'diogo', date: WED, startHour: 0 })
    expect(nudgeReported(onto, 5, 1, WED, WED)).toBe(onto)
  })

  it('not onto the first day of the plan when that is not today', () => {
    // A weekend: today is Saturday 19, so the plan resumes on Monday 21 — not a day to report on.
    const s = reported(16)
    expect(nudgeReported(s, 5, 1, WED, '2026-09-12')).toBe(s)
  })

  it('nothing on a locked day moves', () => {
    // Pinned to Monday 0–2, then Monday is locked.
    const s = {
      ...reported(2),
      reportedPins: { 5: { memberId: 'diogo', date: MON, startHour: 0 } },
      lockedDays: [MON]
    }
    expect(nudgeReported(s, 5, 1, WED, WED)).toBe(s)
  })

  it('jumps a locked day on its way', () => {
    // Pinned at the end of Monday; Tuesday is locked, so one step on is today, Wednesday.
    const s = {
      ...reported(1),
      reportedPins: { 5: { memberId: 'diogo', date: MON, startHour: 7 } },
      lockedDays: [TUE]
    }
    expect(nudgeReported(s, 5, 1, WED, WED).reportedPins?.[5]?.date).toEqual(WED)
  })

  it('does nothing for a work item with no reported hours drawn', () => {
    const s = reported(0)
    expect(nudgeReported(s, 5, 1, WED)).toBe(s)
  })
})

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

  it('does nothing onto, or off, a locked day', () => {
    const s = sprint({
      items: [item(1, { remainingWork: 1 })],
      queues: { diogo: [block('a', 1, 1, { date: MON, startHour: 7 })] }
    })
    const lockedNext = { ...s, lockedDays: [TUE] }
    expect(nudgeBlock(lockedNext, 'a', 1, MON)).toBe(lockedNext)
    const lockedHere = { ...s, lockedDays: [MON] }
    expect(nudgeBlock(lockedHere, 'a', -1, MON)).toBe(lockedHere)
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

  it('cannot move onto today', () => {
    const s = reported(16) // Monday and Tuesday full, ending where today begins
    expect(nudgeReported(s, 5, 1, WED)).toBe(s)
  })

  it('does nothing for a work item with no reported hours drawn', () => {
    const s = reported(0)
    expect(nudgeReported(s, 5, 1, WED)).toBe(s)
  })
})

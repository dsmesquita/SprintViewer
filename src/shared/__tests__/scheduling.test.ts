import { describe, expect, it } from 'vitest'
import { setDayCapacity, setMemberCapacity } from '@shared/mutations'
import {
  anchorFor,
  effectiveCapacity,
  freezeHistoryBefore,
  insertionIndex,
  isDayDisabledForAll,
  landsInside,
  layoutSprint,
  liveRecord,
  occupantAt,
  placedHours,
  splitBlock
} from '@shared/scheduling'
import type { Segment } from '@shared/types'
import {
  block,
  drawn,
  FRI,
  FRI2,
  ids,
  item,
  MON,
  MON2,
  sprint,
  THU,
  TUE,
  WED
} from '../../../test/fixtures'

const seg = (workItemId: number, date: string, startHour: number, hours: number): Segment => ({
  blockId: `h${workItemId}`,
  workItemId,
  date,
  startHour,
  hours,
  continued: false,
  continues: false
})

describe('capacity', () => {
  it('a personal override lowers the day, never raises it past the team day', () => {
    let s = setMemberCapacity(sprint(), 'diogo', MON, 3)
    expect(effectiveCapacity(s, 'diogo', MON)).toBe(3)
    expect(effectiveCapacity(s, 'sofia', MON)).toBe(8)
    s = setDayCapacity(s, TUE, 4)
    s = { ...s, capacityOverrides: { diogo: { [TUE]: 6 } } }
    expect(effectiveCapacity(s, 'diogo', TUE)).toBe(4)
  })

  it('a date outside the sprint has no capacity', () => {
    expect(effectiveCapacity(sprint(), 'diogo', '2026-09-19')).toBe(0)
  })

  it('isDayDisabledForAll is about the team day only', () => {
    const s = setMemberCapacity(setDayCapacity(sprint(), TUE, 0), 'diogo', WED, 0)
    expect(isDayDisabledForAll(s, TUE)).toBe(true)
    expect(isDayDisabledForAll(s, WED)).toBe(false)
  })
})

describe('flowing a queue', () => {
  const s = () =>
    sprint({
      items: [item(1, { remainingWork: 10 }), item(2, { remainingWork: 4 })],
      queues: { diogo: [block('a', 1, 10), block('b', 2, 4)] }
    })

  it('blocks follow each other with no gaps, across days', () => {
    expect(drawn(s(), MON)).toEqual(['09-14@0+8', '09-15@0+2', '09-15@2+4'])
  })

  it('a day off for the team is skipped', () => {
    expect(drawn(setDayCapacity(s(), TUE, 0), MON)).toEqual(['09-14@0+8', '09-16@0+2', '09-16@2+4'])
  })

  it('a half day holds only half', () => {
    expect(drawn(setDayCapacity(s(), MON, 4), MON)).toEqual([
      '09-14@0+4',
      '09-15@0+6',
      '09-15@6+2',
      '09-16@0+2'
    ])
  })

  it('a personal override moves only that person', () => {
    const t = setMemberCapacity(s(), 'diogo', MON, 2)
    expect(drawn(t, MON)[0]).toBe('09-14@0+2')
  })

  it('weekends are not columns: Friday flows into Monday', () => {
    const t = sprint({
      items: [item(1, { remainingWork: 12 })],
      queues: { diogo: [block('a', 1, 12)] }
    })
    expect(drawn(t, FRI)).toEqual(['09-18@0+8', '09-21@0+4'])
  })

  it('work that does not fit before the sprint ends is spillover, not drawn', () => {
    const t = sprint({
      items: [item(1, { remainingWork: 90 })],
      queues: { diogo: [block('a', 1, 90)] }
    })
    const layout = layoutSprint(t, MON).diogo
    expect(layout.spillover).toBe(10)
    expect(layout.availableHours).toBe(80)
    expect(layout.queuedHours).toBe(90)
  })

  it('available hours count only from the anchor on', () => {
    expect(layoutSprint(s(), WED).diogo.availableHours).toBe(8 * 8)
  })

  it('pinned blocks are placed first and unpinned ones flow around them', () => {
    const t = sprint({
      items: [item(1, { remainingWork: 10 }), item(2, { remainingWork: 2 })],
      queues: { diogo: [block('a', 1, 10), block('p', 2, 2, { date: MON, startHour: 3 })] }
    })
    expect(drawn(t, MON, 'diogo', 'p')).toEqual(['09-14@3+2'])
    expect(drawn(t, MON, 'diogo', 'a')).toEqual(['09-14@0+3', '09-14@5+3', '09-15@0+4'])
  })

  it('a pin on a date that is not a sprint day keeps its hour on the next sprint day', () => {
    const t = sprint({
      items: [item(1, { remainingWork: 2 })],
      queues: { diogo: [block('p', 1, 2, { date: '2026-09-19', startHour: 5 })] }
    })
    expect(drawn(t, MON)).toEqual(['09-21@5+2'])
  })

  it('the first and continued pieces of a split block are marked', () => {
    const segs = layoutSprint(s(), MON).diogo.segments.filter((x) => x.blockId === 'a')
    expect(segs.map((x) => [x.continued, x.continues])).toEqual([
      [false, true],
      [true, false]
    ])
  })
})

describe('anchorFor', () => {
  const s = sprint()
  it('a sprint day is its own anchor', () => expect(anchorFor(s, WED)).toBe(WED))
  it('a weekend snaps to the next Monday', () => expect(anchorFor(s, '2026-09-19')).toBe(MON2))
  it('before the sprint is the first day', () => expect(anchorFor(s, '2026-09-01')).toBe(MON))
  it('after the sprint is the last day', () => expect(anchorFor(s, '2026-10-30')).toBe(FRI2))
  it('an empty sprint returns today', () => expect(anchorFor({ ...s, days: [] }, WED)).toBe(WED))
})

describe('drop points', () => {
  const s = () =>
    sprint({
      items: [
        item(1, { remainingWork: 12 }),
        item(2, { remainingWork: 4 }),
        item(3, { remainingWork: 2 })
      ],
      queues: {
        diogo: [block('a', 1, 12), block('b', 2, 4), block('p', 3, 2, { date: THU, startHour: 0 })]
      }
    })
  const layout = () => layoutSprint(s(), MON).diogo

  it('insertionIndex: before the first block, between blocks, after everything', () => {
    expect(insertionIndex(s(), layout(), 'diogo', MON, 0)).toBe(0)
    expect(insertionIndex(s(), layout(), 'diogo', TUE, 4)).toBe(1)
    expect(insertionIndex(s(), layout(), 'diogo', FRI, 0)).toBe(3)
  })

  it('insertionIndex ignores pinned blocks, which do not move', () => {
    // Thursday holds only the pinned block, so a drop there goes after the flowing ones.
    expect(insertionIndex(s(), layout(), 'diogo', THU, 0)).toBe(3)
  })

  it('occupantAt measures the offset across the whole block, over day boundaries', () => {
    // `a` runs Mon 0–8 and Tue 0–4; Tue hour 2 is its eleventh hour.
    expect(occupantAt(s(), layout(), 'diogo', TUE, 2)).toMatchObject({
      blockId: 'a',
      offset: 10,
      hours: 12,
      index: 0
    })
  })

  it('occupantAt finds nothing in free space, and nothing in records', () => {
    expect(occupantAt(s(), layout(), 'diogo', FRI, 3)).toBeNull()
  })

  it('landsInside only for a drop strictly inside, not the first or last hour', () => {
    const base = { blockId: 'a', workItemId: 1, hours: 8, index: 0 }
    expect(landsInside({ ...base, offset: 0 })).toBe(false)
    expect(landsInside({ ...base, offset: 3 })).toBe(true)
    expect(landsInside({ ...base, offset: 7 })).toBe(false)
  })
})

describe('splitBlock / placedHours', () => {
  it('splitBlock keeps the id on the first part and clamps the cut', () => {
    expect(splitBlock(block('a', 1, 5), 2, ids())).toEqual([block('a', 1, 2), block('n1', 1, 3)])
    expect(splitBlock(block('a', 1, 5), 9, ids())).toEqual([block('a', 1, 5), block('n1', 1, 0)])
  })

  it('placedHours sums a work item across people, ignoring the backlog', () => {
    const s = sprint({
      queues: { diogo: [block('a', 1, 2.25)], sofia: [block('b', 1, 1.5)] },
      backlog: [block('c', 1, 9)]
    })
    expect(placedHours(s, 1)).toBe(3.75)
  })
})

describe('the past before a record exists (legacy snapshots)', () => {
  it('a snapshot is replayed, capped at what TFS reports as completed', () => {
    const s = sprint({
      items: [item(1, { completedWork: 3 })],
      history: { diogo: { [MON]: [seg(1, MON, 0, 8)] } }
    })
    expect(drawn(s, WED)).toEqual(['09-14@0+3 hist'])
  })

  it('a server without Completed Work replays the snapshot whole', () => {
    const s = sprint({ items: [item(1)], history: { diogo: { [MON]: [seg(1, MON, 0, 8)] } } })
    expect(drawn(s, WED)).toEqual(['09-14@0+8 hist'])
  })

  it('with a record, the old snapshots are not drawn at all', () => {
    const s = sprint({
      items: [item(1, { completedWork: 3 })],
      history: { diogo: { [MON]: [seg(1, MON, 0, 8)] } },
      pastRecord: { diogo: {} }
    })
    expect(drawn(s, WED).some((x) => x.endsWith('hist'))).toBe(false)
  })

  it('freezeHistoryBefore keeps a day it already froze, and freezes newly passed ones', () => {
    const s = sprint({
      items: [item(1, { remainingWork: 20 })],
      queues: { diogo: [block('a', 1, 20)] },
      history: { diogo: { [MON]: [seg(9, MON, 0, 1)] } }
    })
    const frozen = freezeHistoryBefore(s, WED)
    expect(frozen.diogo[MON]).toEqual([seg(9, MON, 0, 1)])
    expect(frozen.diogo[TUE].map((x) => [x.blockId, x.hours])).toEqual([['a', 8]])
    expect(frozen.diogo[WED]).toBeUndefined()
  })
})

describe('liveRecord', () => {
  const piece = (workItemId: number, date: string, start: number, hours: number): Segment => ({
    ...seg(workItemId, date, start, hours),
    blockId: `done:${workItemId}`,
    isDone: true
  })
  const recorded = () =>
    sprint({
      items: [item(1, { completedWork: 10 }), item(2, { completedWork: 4 })],
      pastRecord: {
        diogo: { [MON]: [piece(1, MON, 0, 8)], [TUE]: [piece(1, TUE, 0, 2), piece(2, TUE, 2, 4)] }
      }
    })

  it('replays the record as it stands', () => {
    expect(drawn(recorded(), WED)).toEqual(['09-14@0+8 done', '09-15@0+2 done', '09-15@2+4 done'])
  })

  it('a reported pin and a lowered Completed apply together', () => {
    const s = recorded()
    const t = {
      ...s,
      workItems: { ...s.workItems, 1: item(1, { completedWork: 9 }) },
      reportedPins: { 2: { memberId: 'diogo', date: MON, startHour: 0 } }
    }
    const live = liveRecord(t, WED)
    // Work item 2 is dropped from the record (its pin rules); item 1 loses its latest hour.
    expect(live.diogo[MON].map((x) => x.hours)).toEqual([8])
    expect(live.diogo[TUE].map((x) => [x.workItemId, x.hours])).toEqual([[1, 1]])
  })

  it('pieces on or after the anchor are ignored', () => {
    expect(liveRecord(recorded(), TUE).diogo[TUE]).toBeUndefined()
  })

  it('no record, nothing to replay', () => {
    expect(liveRecord(sprint(), WED)).toEqual({})
  })
})

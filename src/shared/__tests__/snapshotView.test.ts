import { describe, expect, it } from 'vitest'
import { anchorFor, layoutSprint } from '@shared/scheduling'
import { snapshotView, viewOf, type Snapshot } from '@shared/snapshots'
import { block, FRI, item, MON2, sprint, WED } from '../../../test/fixtures'

/** A snapshot is drawn as it was on screen, never laid out again from a later day. */

const board = () =>
  sprint({
    items: [item(1, { remainingWork: 6, completedWork: 2 }), item(2, { remainingWork: 4 })],
    queues: { diogo: [block('a', 1, 6), block('b', 2, 4)] }
  })
const taken = (view?: Snapshot['view'], takenAt = '2026-09-16T10:00:00'): Snapshot => ({
  id: 's',
  sprintId: 'test',
  name: 'Wednesday',
  takenAt: new Date(takenAt).toISOString(),
  sprint: board(),
  view
})

describe('drawing a snapshot', () => {
  it('the view is the calendar as the board draws it that day', () => {
    expect(viewOf(board(), WED)).toEqual({
      today: WED,
      anchor: WED,
      layouts: layoutSprint(board(), anchorFor(board(), WED))
    })
  })

  it('is exactly what was kept — whatever the board would draw today', () => {
    const kept = viewOf(board(), WED)
    expect(snapshotView(taken(kept))).toBe(kept)
    // Laid out again on a later day, the same sprint draws differently: that is the bug.
    expect(layoutSprint(board(), MON2)).not.toEqual(kept.layouts)
  })

  it('one from before the drawing was kept is drawn as of the day it was taken', () => {
    const old = snapshotView(taken(undefined, '2026-09-18T17:30:00'))
    expect(old.today).toBe(FRI)
    expect(old.layouts).toEqual(layoutSprint(board(), FRI))
  })
})

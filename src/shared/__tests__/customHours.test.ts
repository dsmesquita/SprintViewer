import { describe, expect, it } from 'vitest'
import {
  applyCustomChoices,
  clearCustomHours,
  customConflicts,
  setCustomHours,
  type CustomChoice
} from '@shared/customHours'
import { block, ids, item, MON, sprint } from '../../../test/fixtures'

/** A manual time overrules TFS about a task's size until the user says otherwise. */

const base = () =>
  sprint({
    items: [item(1, { remainingWork: 6 }), item(2, { remainingWork: 4 })],
    queues: { diogo: [block('a', 1, 6)] },
    backlog: [block('b', 2, 4)]
  })
const hoursOf = (s: ReturnType<typeof sprint>, workItemId: number) =>
  [...Object.values(s.queues).flat(), ...s.backlog]
    .filter((b) => b.workItemId === workItemId)
    .reduce((t, b) => t + b.hours, 0)

describe('setCustomHours / clearCustomHours', () => {
  it('sets the time and resizes the blocks to total it', () => {
    const s = setCustomHours(base(), 1, 9.333, MON, ids())
    expect(s.customHours?.[1]).toBe(9.33)
    expect(hoursOf(s, 1)).toBe(9.33)
  })

  it('ignores zero, negative and non-numbers', () => {
    const s = base()
    expect(setCustomHours(s, 1, 0, MON, ids())).toBe(s)
    expect(setCustomHours(s, 1, -2, MON, ids())).toBe(s)
    expect(setCustomHours(s, 1, Number.NaN, MON, ids())).toBe(s)
  })

  it('clearing goes back to what TFS says', () => {
    const s = clearCustomHours(setCustomHours(base(), 1, 10, MON, ids()), 1, MON, ids())
    expect(s.customHours?.[1]).toBeUndefined()
    expect(hoursOf(s, 1)).toBe(6)
  })

  it('clearing a task without a manual time changes nothing', () => {
    const s = base()
    expect(clearCustomHours(s, 1, MON, ids())).toBe(s)
  })
})

describe('customConflicts', () => {
  const withCustom = () =>
    setCustomHours(setCustomHours(base(), 1, 10, MON, ids()), 2, 4, MON, ids())

  it('lists only manual times TFS now disagrees with, in id order', () => {
    const fresh = [
      item(2, { title: 'Two', remainingWork: 5 }),
      item(1, { title: 'One', remainingWork: 10 })
    ]
    expect(customConflicts(withCustom(), fresh)).toEqual([
      { workItemId: 2, title: 'Two', yours: 4, theirs: 5 }
    ])
  })

  it('is compared against Remaining Work — what the blocks stand for — not completed hours', () => {
    const fresh = [item(1, { title: 'One', remainingWork: 10, completedWork: 4 })]
    expect(customConflicts(withCustom(), fresh)).toEqual([])
  })

  it('no manual times, no conflicts', () => {
    expect(customConflicts(base(), [item(1, { remainingWork: 99 })])).toEqual([])
  })
})

describe('applyCustomChoices', () => {
  const s = () => setCustomHours(setCustomHours(base(), 1, 10, MON, ids()), 2, 2, MON, ids())

  it('keep, theirs and a typed value, in one pass', () => {
    const choices = new Map<number, CustomChoice>([
      [1, { kind: 'keep' }],
      [2, { kind: 'set', hours: 7 }]
    ])
    const next = applyCustomChoices(s(), choices, MON, ids())
    expect(next.customHours).toEqual({ 1: 10, 2: 7 })
    expect(hoursOf(next, 2)).toBe(7)

    const back = applyCustomChoices(
      s(),
      new Map([[1, { kind: 'theirs' } as CustomChoice]]),
      MON,
      ids()
    )
    expect(back.customHours?.[1]).toBeUndefined()
    expect(hoursOf(back, 1)).toBe(6)
  })
})

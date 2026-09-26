import { describe, expect, it } from 'vitest'
import { findBlock } from '@shared/mutations'
import { freePastSpace, pastConflicts } from '@shared/pastFit'
import { block, ids, item, MON, sprint, TUE, WED } from '../../../test/fixtures'

/**
 * A block pinned by hand to a day that has passed holds that space. When TFS reports hours the
 * past then cannot fit, the pins that hold more than was reported are named — and can be moved.
 */

// Monday and Tuesday have passed. Diogo pinned task 1 across all of Monday, but only 3 of those
// hours were reported. Task 2 reports 20: Tuesday and today take 16, and 4 have nowhere to go.
const crowded = () =>
  sprint({
    items: [
      item(1, { remainingWork: 0, completedWork: 3 }),
      item(2, { completedWork: 20, assignedTo: 'Diogo Mesquita' })
    ],
    queues: { diogo: [block('p', 1, 8, { date: MON, startHour: 0 })] }
  })

describe('pastConflicts', () => {
  it('names the pin holding unreported time, and how much it could free', () => {
    const [conflict] = pastConflicts(crowded(), WED)
    expect(conflict).toMatchObject({
      memberId: 'diogo',
      missing: 4,
      freeable: 5,
      impossible: false
    })
    expect(conflict.offenders).toEqual([{ blockId: 'p', workItemId: 1, excess: 5, justified: 3 }])
  })

  it('marks it impossible when even freeing everything would not be enough', () => {
    const s = crowded()
    s.workItems[2] = item(2, { completedWork: 40, assignedTo: 'Diogo Mesquita' })
    expect(pastConflicts(s, WED)[0].impossible).toBe(true)
  })

  it('no overflow, no conflict', () => {
    expect(
      pastConflicts(
        sprint({ items: [item(2, { completedWork: 4, assignedTo: 'Diogo Mesquita' })] }),
        WED
      )
    ).toEqual([])
  })

  it('a server without Completed Work judges nobody', () => {
    const s = crowded()
    s.workItems[1] = item(1, { remainingWork: 8 })
    expect(pastConflicts(s, WED)[0].offenders).toEqual([])
  })
})

describe('freePastSpace', () => {
  it('keeps the reported part pinned and sends the rest into the plan', () => {
    const next = freePastSpace(crowded(), WED, ids())
    expect(findBlock(next, 'p')?.block).toMatchObject({
      hours: 3,
      pin: { date: MON, startHour: 0 }
    })
    expect(findBlock(next, 'n1')?.block).toMatchObject({ workItemId: 1, hours: 5 })
    expect(pastConflicts(next, WED)).toEqual([])
  })

  it('a pin with nothing reported rejoins the queue whole', () => {
    const s = crowded()
    s.workItems[1] = item(1, { remainingWork: 8, completedWork: 0 })
    s.queues.diogo = [block('p', 1, 8, { date: TUE, startHour: 0 })]
    const next = freePastSpace(s, WED, ids())
    expect(findBlock(next, 'p')?.block.pin).toBeUndefined()
  })
})

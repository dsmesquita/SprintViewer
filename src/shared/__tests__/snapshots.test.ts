import { describe, expect, it } from 'vitest'
import { diffSprints } from '@shared/snapshots'
import { block, item, MON, sprint, TUE, WED } from '../../../test/fixtures'

/** Comparing a snapshot with the board as it stands, per work item. */

const before = () =>
  sprint({
    items: [
      item(1, { title: 'One', remainingWork: 8 }),
      item(2, { title: 'Two', remainingWork: 4 }),
      item(3, { title: 'Three', remainingWork: 4 })
    ],
    queues: { diogo: [block('a', 1, 8), block('b', 2, 4)], sofia: [block('c', 3, 4)] }
  })

describe('diffSprints', () => {
  it('an unchanged board has no changes', () => {
    expect(diffSprints(before(), before(), MON)).toEqual([])
  })

  it('moved to someone else', () => {
    const after = before()
    after.queues = { diogo: [block('a', 1, 8)], sofia: [block('c', 3, 4), block('b', 2, 4)] }
    const [change] = diffSprints(before(), after, MON)
    expect(change).toMatchObject({ workItemId: 2, kinds: ['moved', 'pulled'] })
    expect(change.detail).toContain('Diogo → Sofia')
  })

  it('slipped to a later day, and grew', () => {
    // Task 1 doubles, which pushes task 2 from Tuesday to Wednesday.
    const after = before()
    after.queues.diogo = [block('a', 1, 16), block('b', 2, 4)]
    const changes = diffSprints(before(), after, MON)
    expect(changes.map((c) => [c.workItemId, c.kinds, c.detail])).toEqual([
      [1, ['grew'], '8h → 16h'],
      [2, ['slipped'], `${TUE} → ${WED}`]
    ])
  })

  it('pulled earlier, and shrank', () => {
    const after = before()
    after.queues.diogo = [block('a', 1, 2), block('b', 2, 4)]
    // Task 1 shrinks, so task 2 now starts on Monday instead of Tuesday.
    expect(diffSprints(before(), after, MON).map((c) => [c.workItemId, c.kinds])).toEqual([
      [1, ['shrank']],
      [2, ['pulled']]
    ])
  })

  it('gone from the board, and added to it', () => {
    const after = before()
    after.queues.sofia = []
    after.backlog = [block('c', 3, 4)]
    after.workItems[4] = item(4, { title: 'Four', remainingWork: 2 })
    after.queues.diogo = [...after.queues.diogo, block('d', 4, 2)]
    const changes = diffSprints(before(), after, MON)
    expect(changes.map((c) => [c.workItemId, c.kinds, c.detail])).toEqual([
      [3, ['gone'], 'no longer on the board'],
      [4, ['added'], 'now on Diogo']
    ])
  })

  it('a task split in two is still one task — no change', () => {
    const after = before()
    after.queues.diogo = [block('a', 1, 5), block('a2', 1, 3), block('b', 2, 4)]
    expect(diffSprints(before(), after, MON)).toEqual([])
  })

  it('reported and replayed hours are not compared', () => {
    const after = before()
    after.workItems[1] = item(1, { title: 'One', remainingWork: 8, completedWork: 5 })
    expect(diffSprints(before(), after, TUE)).toEqual([])
  })
})

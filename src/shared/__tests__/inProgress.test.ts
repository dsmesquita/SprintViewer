import { describe, expect, it } from 'vitest'
import { applyRefresh, inProgressFirst, isInProgressDev } from '@shared/refresh'
import type { Sprint, WorkItem } from '@shared/types'
import { block, drawn, FRI, ids, item, sprint, THU, WED } from '../../../test/fixtures'

/**
 * After a refresh, a DEV task someone has started — hours done, hours left — goes first today on
 * its row: it is what they are working on.
 */

// Today is Wednesday 16. Diogo's queue: a DEV task not started, a TEST task in progress, the
// DEV task he is on (pinned to Friday when it was planned), and a meeting pinned to 9:00 today.
const items = (): WorkItem[] => [
  item(1, { title: 'DEV:: Not started', remainingWork: 4, assignedTo: 'Diogo Mesquita' }),
  item(2, { title: 'TEST:: Half run', remainingWork: 2, completedWork: 1 }),
  item(3, { title: 'DEV:: Export', remainingWork: 3, completedWork: 2 }),
  item(4, { title: 'Meetings', remainingWork: 2 })
]
const board = (extra: Partial<Sprint> = {}): Sprint =>
  sprint({
    items: items(),
    queues: {
      diogo: [
        block('a', 1, 4),
        block('b', 2, 2),
        block('c', 3, 3, { date: FRI, startHour: 0 }),
        block('m', 4, 2, { date: WED, startHour: 0 })
      ]
    },
    ...extra
  })
const refreshed = (s: Sprint) => applyRefresh(s, Object.values(s.workItems), WED, ids())

describe('what counts as in progress', () => {
  it('a DEV task with hours done and hours left — nothing else', () => {
    expect(isInProgressDev(item(1, { title: 'DEV:: x', remainingWork: 3, completedWork: 2 }))).toBe(
      true
    )
    expect(isInProgressDev(item(1, { title: 'DEV:: x', remainingWork: 3 }))).toBe(false)
    expect(isInProgressDev(item(1, { title: 'DEV:: x', remainingWork: 0, completedWork: 2 }))).toBe(
      false
    )
    expect(
      isInProgressDev(item(1, { title: 'TEST:: x', remainingWork: 3, completedWork: 2 }))
    ).toBe(false)
    expect(
      isInProgressDev(
        item(1, { title: 'DEV:: x', type: 'User Story', remainingWork: 3, completedWork: 2 })
      )
    ).toBe(false)
  })
})

describe('a refresh puts it first today', () => {
  it('at the first free hour, after the meeting pinned to the start of the day; its pin goes', () => {
    const { sprint: next, summary } = refreshed(board())
    expect(next.queues.diogo.map((b) => b.id)).toEqual(['c', 'a', 'b', 'm'])
    expect(next.queues.diogo[0].pin).toBeUndefined()
    // The meeting keeps 9:00–11:00; the task he is on follows it, then the rest.
    expect(drawn(next, WED, 'diogo', 'm')).toEqual(['09-16@0+2'])
    expect(drawn(next, WED, 'diogo', 'c')).toEqual(['09-16@2+3'])
    expect(drawn(next, WED, 'diogo', 'a')).toEqual(['09-16@5+3', '09-17@0+1'])
    expect(summary.startedFirst).toBe(1)
  })

  it('several keep the order they had; a split one moves with all its parts', () => {
    const s = sprint({
      items: [...items(), item(5, { title: 'DEV:: Import', remainingWork: 5, completedWork: 1 })],
      queues: {
        diogo: [
          block('a', 1, 4),
          block('i1', 5, 2),
          block('c', 3, 3),
          block('i2', 5, 3, { date: THU, startHour: 4 })
        ]
      }
    })
    const { sprint: next, summary } = refreshed(s)
    expect(next.queues.diogo.map((b) => b.id)).toEqual(['i1', 'c', 'i2', 'a'])
    expect(next.queues.diogo.every((b) => b.pin === undefined)).toBe(true)
    expect(summary.startedFirst).toBe(2)
  })

  it('anything on a locked day stays there: nothing leaves a locked day', () => {
    const s = board({
      lockedDays: [FRI],
      queues: { diogo: [block('a', 1, 4), block('c', 3, 3, { date: FRI, startHour: 0 })] }
    })
    const { sprint: next, summary } = refreshed(s)
    expect(next.queues.diogo).toEqual(s.queues.diogo)
    expect(summary.startedFirst).toBeUndefined()
  })

  it('already first and unpinned: nothing changes, and nothing is said', () => {
    const s = board({ queues: { diogo: [block('c', 3, 3), block('a', 1, 4)] } })
    expect(inProgressFirst(s).sprint).toBe(s)
    expect(refreshed(s).summary.startedFirst).toBeUndefined()
  })

  it('the figures that count are the new ones: a task started since the last refresh moves', () => {
    const s = board({ queues: { diogo: [block('b', 2, 2), block('a', 1, 4), block('c', 3, 3)] } })
    const fresh = items().map((x) =>
      x.id === 1 ? { ...x, remainingWork: 3, completedWork: 1 } : x
    )
    const { sprint: next } = applyRefresh(s, fresh, WED, ids())
    // Both DEV tasks are in progress now; they keep their order, ahead of everything else.
    expect(next.queues.diogo.map((b) => b.id)).toEqual(['a', 'c', 'b'])
    expect(next.queues.diogo[0].hours).toBe(3)
  })
})

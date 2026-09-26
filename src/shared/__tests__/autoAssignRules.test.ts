import { describe, expect, it } from 'vitest'
import {
  compareForAssignment,
  isChainedVal,
  isMeeting,
  ownerOf,
  planAutoAssign,
  spreadDays
} from '@shared/autoAssign'
import { block, FRI2, item, MON, MON2, sprint, TUE } from '../../../test/fixtures'

/** The individual rules behind auto-assign, one at a time. */

const story = (id: number, fields = {}) => item(id, { type: 'User Story', state: 'New', ...fields })
const sorted = (s: ReturnType<typeof sprint>, blocks: ReturnType<typeof block>[]) =>
  [...blocks].sort((a, b) => compareForAssignment(s, a, b)).map((b) => b.id)

describe('ordering, key by key', () => {
  it('1. tasks under an Active parent come first', () => {
    const s = sprint({
      items: [
        story(1),
        story(2, { state: 'Active' }),
        item(10, { parentId: 1 }),
        item(20, { parentId: 2 })
      ]
    })
    expect(sorted(s, [block('a', 10, 1), block('b', 20, 5)])).toEqual(['b', 'a'])
  })

  it('2. then tasks under a User Story before other parents', () => {
    const s = sprint({
      items: [
        story(1),
        item(2, { type: 'Bug', state: 'New' }),
        item(10, { parentId: 2 }),
        item(20, { parentId: 1 })
      ]
    })
    expect(sorted(s, [block('bug', 10, 1), block('us', 20, 5)])).toEqual(['us', 'bug'])
  })

  it('3. then Business Order 50 or lower', () => {
    const s = sprint({
      items: [
        story(1, { businessOrder: 80 }),
        story(2, { businessOrder: 50 }),
        item(10, { parentId: 1 }),
        item(20, { parentId: 2 })
      ]
    })
    expect(sorted(s, [block('late', 10, 1), block('prio', 20, 5)])).toEqual(['prio', 'late'])
  })

  it('4. then the shortest first, and finally by id', () => {
    const s = sprint({
      items: [
        item(10, { remainingWork: 5 }),
        item(11, { remainingWork: 2 }),
        item(12, { remainingWork: 2 })
      ]
    })
    expect(sorted(s, [block('a', 10, 5), block('c', 12, 2), block('b', 11, 2)])).toEqual([
      'b',
      'c',
      'a'
    ])
  })
})

describe('recognising tasks', () => {
  it('a meeting is a task titled just Meeting(s), tag or not', () => {
    expect(isMeeting(item(1, { title: 'Meetings' }))).toBe(true)
    expect(isMeeting(item(1, { title: 'MTG:: meeting' }))).toBe(true)
    expect(isMeeting(item(1, { title: 'Meeting notes' }))).toBe(false)
    expect(isMeeting(undefined)).toBe(false)
  })

  it('a meeting is also a task whose title starts with Meeting(s) and a colon', () => {
    expect(isMeeting(item(1, { title: 'Meetings:: Tech talk + Others' }))).toBe(true)
    expect(isMeeting(item(1, { title: 'Meetings: Tech talk + Others' }))).toBe(true)
    expect(isMeeting(item(1, { title: 'meeting : Tech talk' }))).toBe(true)
    expect(isMeeting(item(1, { title: 'MTG:: Meetings: Tech talk' }))).toBe(true)
    // A title that merely begins with the word is not one.
    expect(isMeeting(item(1, { title: 'Meeting notes: sprint review' }))).toBe(false)
    expect(isMeeting(item(1, { title: 'Meetings room booking' }))).toBe(false)
  })

  it('a VAL is chained only when a DEV sibling exists under the same parent', () => {
    const s = sprint({
      items: [
        story(1),
        item(10, { parentId: 1, title: 'DEV:: x' }),
        item(11, { parentId: 1, title: 'VAL:: x' }),
        item(12, { title: 'VAL:: alone' })
      ]
    })
    expect(isChainedVal(s, s.workItems[11])).toBe(true)
    expect(isChainedVal(s, s.workItems[12])).toBe(false)
  })

  it('ownerOf matches the TFS assignee to someone on the team, or nobody', () => {
    const s = sprint({
      items: [
        item(1, { assignedTo: 'Sofia Marques <CMF\\smarques>' }),
        item(2, { assignedTo: 'Outsider Person' }),
        item(3)
      ]
    })
    expect(ownerOf(s, s.workItems[1])).toBe('sofia')
    expect(ownerOf(s, s.workItems[2])).toBeNull()
    expect(ownerOf(s, s.workItems[3])).toBeNull()
  })

  it('ownerOf: with two Diogos, a task goes to the right one, or to nobody', () => {
    const s = sprint({
      members: [
        { id: 'm', name: 'Diogo', tfsIdentity: 'Diogo Mesquita', order: 0 },
        { id: 's', name: 'Diogo S.', tfsIdentity: 'Diogo Silva', order: 1 }
      ],
      items: [
        item(1, { assignedTo: 'Diogo Silva <CMF\\dsilva>' }),
        item(2, { assignedTo: 'Diogo Santos' })
      ]
    })
    expect(ownerOf(s, s.workItems[1])).toBe('s')
    expect(ownerOf(s, s.workItems[2])).toBeNull()
  })
})

describe('meetings over the sprint', () => {
  it('spreadDays picks the middle of equal shares', () => {
    const days = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
    expect(spreadDays(days, 3)).toEqual(['2', '5', '8'])
    expect(spreadDays(days, 1)).toEqual(['5'])
  })

  it('never on the planning day or a locked day', () => {
    const s = sprint({
      items: [item(1, { title: 'Meetings', assignedTo: 'Diogo Mesquita', remainingWork: 10 })],
      backlog: [block('m', 1, 10)],
      lockedDays: [MON2]
    })
    let n = 0
    const plan = planAutoAssign(s, MON, { newId: () => `p${++n}` })
    const dates = plan.sprint.queues.diogo.map((b) => b.pin?.date)
    expect(dates).not.toContain(MON)
    expect(dates).not.toContain(MON2)
    expect(dates.every((d) => d !== undefined && d >= TUE && d <= FRI2)).toBe(true)
  })

  it('a "Meetings:: Tech talk + Others" task is split like any meeting', () => {
    const s = sprint({
      items: [
        item(1, {
          title: 'Meetings:: Tech talk + Others',
          assignedTo: 'Diogo Mesquita',
          remainingWork: 8
        })
      ],
      backlog: [block('m', 1, 8)]
    })
    let n = 0
    const plan = planAutoAssign(s, MON, { newId: () => `p${++n}` })
    expect(plan.summary.meetingsSplit).toBe(1)
    expect(plan.sprint.queues.diogo.map((b) => [b.hours, b.pin?.startHour])).toEqual([
      [2, 0],
      [2, 0],
      [2, 0],
      [2, 0]
    ])
  })
})

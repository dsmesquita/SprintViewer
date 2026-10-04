import { describe, expect, it } from 'vitest'
import {
  compareForAssignment,
  isChainedVal,
  isMeeting,
  isSpike,
  ownerOf,
  planAutoAssign,
  spreadDays
} from '@shared/autoAssign'
import { layoutSprint } from '@shared/scheduling'
import { block, FRI2, item, MON, MON2, sprint, TUE } from '../../../test/fixtures'

/** The individual rules behind auto-assign, one at a time. */

const story = (id: number, fields = {}) => item(id, { type: 'User Story', state: 'New', ...fields })
const sorted = (s: ReturnType<typeof sprint>, blocks: ReturnType<typeof block>[]) =>
  [...blocks].sort((a, b) => compareForAssignment(s, a, b)).map((b) => b.id)

describe('ordering, key by key', () => {
  it('first of all, spikes come after everything else — whatever the other keys say', () => {
    const s = sprint({
      items: [
        story(1, { state: 'Active', businessOrder: 1 }),
        item(2, { type: 'Bug', state: 'New' }),
        // The spike would win every other key: Active story, top priority, shortest.
        item(10, { parentId: 1, title: 'SPIKE:: Try the new API', remainingWork: 1 }),
        item(20, { parentId: 2, title: 'DEV:: Build it', remainingWork: 8 }),
        item(30, { title: 'Tidy the docs', remainingWork: 5 }),
        item(40, { parentId: 1, title: '[Spike] Measure it', remainingWork: 2 })
      ]
    })
    expect(
      sorted(s, [
        block('spike', 10, 1),
        block('dev', 20, 8),
        block('other', 30, 5),
        block('spike2', 40, 2)
      ])
    ).toEqual(['other', 'dev', 'spike', 'spike2'])
  })

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
  it('a spike is tagged Spike, in any case, with colons or brackets', () => {
    for (const title of ['Spike:: Look', 'SPIKE:: Look', '[Spike] Look', '[SPIKE] Look']) {
      expect(isSpike(item(1, { title }))).toBe(true)
    }
    for (const title of ['Spikes to remove', 'DEV:: Spike handling', 'Spike the punch']) {
      expect(isSpike(item(1, { title }))).toBe(false)
    }
    // A story is a heading, not a task to place.
    expect(isSpike(item(1, { title: 'Spike:: Look', type: 'User Story' }))).toBe(false)
  })

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
  // A meeting allowance for Diogo, planned from `anchor`, as [date, start, hours] per piece.
  const meetingPlan = (
    hours: number,
    anchor: string,
    extra: Partial<ReturnType<typeof sprint>> = {}
  ) => {
    const s = sprint({
      items: [
        item(1, { title: 'Meetings', assignedTo: 'Diogo Mesquita', remainingWork: hours }),
        item(2, { title: 'DEV:: Wrap up', remainingWork: 3 })
      ],
      backlog: [block('m', 1, hours)],
      ...extra
    })
    let n = 0
    const plan = planAutoAssign(s, anchor, { newId: () => `p${++n}` })
    const pieces = plan.sprint.queues.diogo.filter((b) => b.workItemId === 1)
    const drawn = layoutSprint(plan.sprint, anchor).diogo.segments.filter((x) => x.workItemId === 1)
    return { plan, pieces, drawn }
  }
  const THU2 = '2026-09-24'
  const WED2 = '2026-09-23'

  it('still splits and spreads, and may use the morning of the last working day', () => {
    // 10h from Monday 21: five days left, five 2h pieces, one each, the last on Friday 25.
    const { plan, pieces, drawn } = meetingPlan(10, MON2)
    expect(plan.summary.meetingsSplit).toBe(1)
    expect(pieces.map((b) => [b.pin?.date, b.pin?.startHour, b.hours])).toEqual([
      [MON2, 0, 2],
      ['2026-09-22', 0, 2],
      [WED2, 0, 2],
      [THU2, 0, 2],
      [FRI2, 0, 2]
    ])
    // Friday's piece ends by the middle of the day.
    expect(drawn.filter((x) => x.date === FRI2).map((x) => x.startHour + x.hours)).toEqual([2])
  })

  it('never into the afternoon of the last day: too long for its morning, it spreads elsewhere', () => {
    // 15h from Wednesday 23 would be 5h on each of Wed, Thu and Fri — 5h runs past Friday's 4h.
    const { plan, pieces } = meetingPlan(15, WED2)
    expect(pieces.map((b) => b.pin?.date)).not.toContain(FRI2)
    expect(pieces.reduce((sum, b) => sum + b.hours, 0)).toBe(15)
    expect(plan.summary.placed).toBe(1)
    expect(plan.summary.meetingsTooLate).toBe(0)
  })

  it('a task already at the start of the last day counts: the morning left is shorter', () => {
    // 3h pinned to Friday 9:00 leaves 1h of Friday's morning: a 2h piece there would end at 5.
    const { pieces, drawn } = meetingPlan(10, MON2, {
      queues: { diogo: [block('wrap', 2, 3, { date: FRI2, startHour: 0 })] }
    })
    expect(pieces.map((b) => b.pin?.date)).not.toContain(FRI2)
    expect(drawn.every((x) => x.date !== FRI2 || x.startHour + x.hours <= 4)).toBe(true)
  })

  it('the last day is the sprint’s last working day: a day off at the end moves it', () => {
    // Friday 25 is off for everyone, so Thursday 24 is the last day and keeps its afternoon.
    const days = sprint().days.map((d) => (d.date === FRI2 ? { ...d, capacity: 0 } : d))
    const { pieces, drawn } = meetingPlan(15, MON2, { days })
    expect(pieces.map((b) => b.pin?.date)).not.toContain(FRI2)
    expect(drawn.every((x) => x.date !== THU2 || x.startHour + x.hours <= 4)).toBe(true)
  })

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

describe('spikes in a plan', () => {
  it('a spike gets only the room DEV work leaves', () => {
    // Diogo has 10 free hours from Friday 25 Sep (the last two days of the sprint, 8h each,
    // less 6h already planned): the DEV task fits, then the spike would not.
    const s = sprint({
      items: [
        item(1, { title: 'SPIKE:: Try it', remainingWork: 4, assignedTo: 'Diogo Mesquita' }),
        item(2, { title: 'DEV:: Build it', remainingWork: 8, assignedTo: 'Diogo Mesquita' })
      ],
      backlog: [block('spike', 1, 4), block('dev', 2, 8)]
    })
    const plan = planAutoAssign(s, FRI2)
    expect(plan.sprint.queues.diogo.map((b) => b.id)).toEqual(['dev'])
    expect(plan.sprint.backlog.map((b) => b.id)).toEqual(['spike'])

    // With room for both, both go — the spike after the DEV task.
    const roomy = planAutoAssign(s, MON2)
    expect(roomy.sprint.queues.diogo.map((b) => b.id)).toEqual(['dev', 'spike'])
  })
})

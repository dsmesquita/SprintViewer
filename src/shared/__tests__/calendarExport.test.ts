import { describe, expect, it } from 'vitest'
import {
  calendarExport,
  calendarMarkdown,
  exportFileName,
  exportLabel
} from '@shared/calendarExport'
import { layoutSprint } from '@shared/scheduling'
import type { Sprint } from '@shared/types'
import { block, FRI, item, MON2, sprint, WED } from '../../../test/fixtures'

/** One person's calendar as a board: a row per sprint day, the tasks drawn on it. */

// Today is Wednesday. Diogo's calendar:
//   Mon      DEV's 2 done hours
//   Wed 0–2  the meeting (pinned), then DEV 2–8
//   Thu      DEV 0–4, VAL 4–6, the untagged task 6–8
//   Fri      a day off;  next Mon locked
const board = (): Sprint =>
  sprint({
    name: 'Sprint 24.09',
    items: [
      item(1, { title: 'DEV:: Export', remainingWork: 10, completedWork: 2 }),
      item(2, { title: 'VAL:: Export', remainingWork: 2 }),
      item(3, { title: 'Tidy the build', remainingWork: 2 }),
      item(4, { title: 'Meetings:: Tech talk + Others', remainingWork: 2 })
    ],
    queues: {
      diogo: [
        block('m', 4, 2, { date: WED, startHour: 0 }),
        block('a', 1, 10),
        block('b', 2, 2),
        block('c', 3, 2)
      ]
    },
    capacityOverrides: { diogo: { [FRI]: 0 } },
    lockedDays: [MON2]
  })
const exported = (showMeetings = false) =>
  calendarExport(board(), layoutSprint(board(), WED), 'diogo', { showMeetings })

describe('the board', () => {
  it('a row per sprint day, each listing its tasks in the order they come', () => {
    const rows = exported().rows
    expect(rows).toHaveLength(10)
    expect(rows.slice(0, 7).map((row) => [row.day, row.tasks])).toEqual([
      ['Mon 14/09', '#1 (DEV)'],
      ['Tue 15/09', ''],
      ['Wed 16/09', '#1 (DEV)'],
      ['Thu 17/09', '#1 (DEV) / #2 (VAL) / #3 (Other)'],
      ['Fri 18/09', 'Day off'],
      ['Mon 21/09', 'Locked'],
      ['Tue 22/09', '']
    ])
  })

  it('meetings only when asked for, as (Meeting)', () => {
    expect(exported(false).rows[2].tasks).toBe('#1 (DEV)')
    expect(exported(true).rows[2].tasks).toBe('#4 (Meeting) / #1 (DEV)')
  })

  it('is titled with the person, the sprint and its dates', () => {
    expect(exported()).toMatchObject({
      memberId: 'diogo',
      memberName: 'Diogo',
      subtitle: 'Sprint 24.09 · 14 Sep – 25 Sep'
    })
    expect(exportFileName(board(), exported())).toBe('Sprint 24.09 - Diogo')
  })
})

describe('labels', () => {
  it('the tag, (Meeting) for a meeting, (Other) with no tag', () => {
    expect(exportLabel(item(1, { title: 'DEV:: Export' }))).toBe('(DEV)')
    expect(exportLabel(item(1, { title: '[TEST] Smoke run' }))).toBe('(TEST)')
    expect(exportLabel(item(1, { title: 'MTG:: Meeting' }))).toBe('(Meeting)')
    expect(exportLabel(item(1, { title: 'Just a task' }))).toBe('(Other)')
    expect(exportLabel(undefined)).toBe('(Other)')
  })
})

describe('as Markdown', () => {
  it('a heading, the sprint, and a two-column table', () => {
    const lines = calendarMarkdown(exported()).split('\n')
    expect(lines.slice(0, 8)).toEqual([
      '# Diogo',
      '',
      'Sprint 24.09 · 14 Sep – 25 Sep',
      '',
      '| Day | Tasks |',
      '| --- | --- |',
      '| Mon 14/09 | #1 (DEV) |',
      '| Tue 15/09 |  |'
    ])
    expect(lines).toContain('| Thu 17/09 | #1 (DEV) / #2 (VAL) / #3 (Other) |')
  })
})

import { describe, expect, it } from 'vitest'
import { layoutSprint } from '@shared/scheduling'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/settings'
import {
  appPlan,
  applySprintSettings,
  removedWithWork,
  setSprintMembers,
  sprintPlan,
  withAppDefaults
} from '@shared/sprintSettings'
import { DEFAULT_TASK_TEMPLATES } from '@shared/taskCreation'
import type { Sprint } from '@shared/types'
import { block, DIOGO, item, MON, SOFIA, sprint, TUE } from '../../../test/fixtures'

/**
 * A sprint's own copy of the settings the app keeps defaults for, and applying the Sprint tab
 * of Settings — including taking people off it.
 */

const app: AppSettings = {
  ...DEFAULT_SETTINGS,
  lastQueryUrl: 'https://tfs.example/default',
  hoursPerDay: 8,
  members: [DIOGO, SOFIA],
  childQueryMode: 'always',
  docOwner: 'diogo',
  qaOwner: 'CMF\\qa',
  taskTemplates: [{ name: 'Solo', prefixes: ['DEV'] }]
}

// Sofia has two tasks — one pinned — a day off, done hours pinned to her row and a record.
const board = (): Sprint =>
  sprint({
    queryUrl: 'https://tfs.example/sprint',
    items: [
      item(1, { remainingWork: 4 }),
      item(2, { remainingWork: 2, completedWork: 3 }),
      item(3, { remainingWork: 1 })
    ],
    queues: {
      diogo: [block('c', 3, 1)],
      sofia: [block('a', 1, 4, { date: TUE, startHour: 0 }), block('b', 2, 2)]
    },
    capacityOverrides: { sofia: { [MON]: 0 }, diogo: { [TUE]: 4 } },
    reportedPins: { 2: { memberId: 'sofia', date: MON, startHour: 0 } },
    pastRecord: { sofia: {}, diogo: {} }
  })

describe('the settings a sprint has', () => {
  it('the app’s defaults, with the built-in templates when none are saved', () => {
    expect(appPlan(app)).toMatchObject({
      queryUrl: 'https://tfs.example/default',
      docOwner: 'diogo'
    })
    expect(appPlan(DEFAULT_SETTINGS).taskTemplates).toEqual(DEFAULT_TASK_TEMPLATES)
  })

  it('a sprint’s own, borrowing the app’s for anything it has no copy of', () => {
    const plan = sprintPlan({ ...board(), docOwner: '' }, app)
    expect(plan).toMatchObject({
      queryUrl: 'https://tfs.example/sprint',
      docOwner: '', // its own: nobody
      qaOwner: 'CMF\\qa', // borrowed
      childQueryMode: 'always',
      taskTemplates: [{ name: 'Solo', prefixes: ['DEV'] }]
    })
  })

  it('an old sprint takes a copy when opened, and stops following the app’s', () => {
    const copied = withAppDefaults(board(), app)
    expect(copied).toMatchObject({
      childQueryMode: 'always',
      docOwner: 'diogo',
      qaOwner: 'CMF\\qa'
    })
    expect(withAppDefaults(copied, { ...app, childQueryMode: 'never' })).toBe(copied)
  })
})

describe('taking people off a sprint', () => {
  it('says who has work, and how much, before anything happens', () => {
    expect(removedWithWork(board(), [DIOGO])).toEqual([{ member: SOFIA, tasks: 2 }])
    expect(removedWithWork(board(), [DIOGO, SOFIA])).toEqual([])
  })

  it('their tasks go back to the backlog unpinned; their days off, pins and record go', () => {
    const s = setSprintMembers(board(), [DIOGO])
    expect(s.members).toEqual([DIOGO])
    expect(Object.keys(s.queues)).toEqual(['diogo'])
    expect(s.backlog).toEqual([block('a', 1, 4), block('b', 2, 2)])
    expect(s.capacityOverrides).toEqual({ diogo: { [TUE]: 4 } })
    expect(s.reportedPins).toEqual({})
    expect(Object.keys(s.pastRecord!)).toEqual(['diogo'])
    // The calendar draws without them.
    expect(Object.keys(layoutSprint(s, MON))).toEqual(['diogo'])
  })

  it('new people get an empty row; the order is the list’s; unchanged is the same sprint', () => {
    const ana = { id: 'ana', name: 'Ana', order: 5 }
    const s = setSprintMembers(board(), [ana, SOFIA, DIOGO])
    expect(s.members.map((m) => `${m.id}:${m.order}`)).toEqual(['ana:0', 'sofia:1', 'diogo:2'])
    expect(s.queues.ana).toEqual([])
    expect(s.queues.sofia).toHaveLength(2)
    const same = board()
    expect(setSprintMembers(same, [DIOGO, SOFIA])).toBe(same)
  })
})

describe('applying the Sprint tab', () => {
  it('everything at once: name, URL, day length, people, owners, templates, child mode', () => {
    const s = applySprintSettings(board(), {
      ...appPlan(app),
      name: '  Sprint 42 ',
      queryUrl: 'https://tfs.example/new',
      hoursPerDay: 6,
      members: [DIOGO]
    })
    expect(s).toMatchObject({
      name: 'Sprint 42',
      queryUrl: 'https://tfs.example/new',
      hoursPerDay: 6,
      childQueryMode: 'always',
      docOwner: 'diogo',
      qaOwner: 'CMF\\qa',
      taskTemplates: [{ name: 'Solo', prefixes: ['DEV'] }]
    })
    expect(s.members).toEqual([DIOGO])
  })

  it('what the tab already shows changes nothing: the same sprint', () => {
    const s = withAppDefaults(board(), app)
    expect(applySprintSettings(s, { ...sprintPlan(s, app), name: s.name })).toBe(s)
    // An empty name or URL keeps what the sprint has.
    expect(applySprintSettings(s, { ...sprintPlan(s, app), name: ' ', queryUrl: '' })).toBe(s)
  })
})

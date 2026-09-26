import { buildSprintDays, startOfWeek, todayISO } from '../src/shared/dates'
import type { Block, Member, Sprint, WorkItem } from '../src/shared/types'
import type { SeedSettings } from './app'
import type { FakeTfs } from './fakeTfs'
import { ITERATION } from './fakeTfs'

/**
 * The data the end-to-end tests share: one story with two tasks in TFS, two people on the
 * team, and a sprint built from them the way the app would have built it.
 *
 * Dates are relative to the real today — the app reads the clock — so nothing here asserts
 * where in the week a block lands; the unit tests pin that down against fixed dates.
 */

export const DIOGO: Member = {
  id: 'diogo',
  name: 'Diogo',
  tfsIdentity: 'Diogo Mesquita',
  order: 0
}
export const SOFIA: Member = { id: 'sofia', name: 'Sofia', tfsIdentity: 'Sofia Marques', order: 1 }

export const STORY = 100
export const DEV = 101
export const VAL = 102

/** Settings that talk to the fake TFS without a token. */
export const settingsFor = (tfs: FakeTfs): SeedSettings => ({
  authMode: 'windows',
  members: [DIOGO, SOFIA],
  hoursPerDay: 8,
  lastQueryUrl: tfs.queryUrl
})

/** A story with a DEV and a VAL task under it; the query returns the two tasks. */
export function storyWithTasks(tfs: FakeTfs): void {
  tfs.add(STORY, {
    'System.WorkItemType': 'User Story',
    'System.Title': 'Export service',
    'System.AssignedTo': 'Diogo Mesquita <CMF\\dmesquita>',
    'System.Tags': 'Squad A; Release 24.10',
    'System.AreaPath': 'Proj\\Area'
  })
  tfs.add(DEV, {
    'System.Title': 'DEV:: Export service',
    'System.Parent': STORY,
    'System.AssignedTo': 'Diogo Mesquita <CMF\\dmesquita>',
    'Microsoft.VSTS.Scheduling.RemainingWork': 6,
    'Microsoft.VSTS.Scheduling.CompletedWork': 2
  })
  tfs.add(VAL, {
    'System.Title': 'VAL:: Export service',
    'System.Parent': STORY,
    'Microsoft.VSTS.Scheduling.RemainingWork': 3
  })
  tfs.queried = [DEV, VAL]
}

const workItem = (tfs: FakeTfs, id: number, fields: Partial<WorkItem>): WorkItem => ({
  id,
  title: `Task ${id}`,
  type: 'Task',
  state: 'Active',
  remainingWork: 0,
  iterationPath: ITERATION,
  url: tfs.queryUrl.replace(/_queries\/.*$/, `_workitems/edit/${id}`),
  ...fields
})

/**
 * A saved sprint of the story above, starting this week, with the DEV task on Diogo's
 * calendar and the VAL task in the backlog.
 */
export function sprintFor(tfs: FakeTfs, overrides: Partial<Sprint> = {}): Sprint {
  const items = [
    workItem(tfs, STORY, {
      type: 'User Story',
      title: 'Export service',
      assignedTo: 'Diogo Mesquita',
      tfsTags: ['Squad A', 'Release 24.10'],
      areaPath: 'Proj\\Area'
    }),
    workItem(tfs, DEV, {
      title: 'DEV:: Export service',
      parentId: STORY,
      assignedTo: 'Diogo Mesquita',
      remainingWork: 6,
      completedWork: 2
    }),
    workItem(tfs, VAL, { title: 'VAL:: Export service', parentId: STORY, remainingWork: 3 })
  ]
  const dev: Block = { id: `${DEV}-1`, workItemId: DEV, hours: 6 }
  const val: Block = { id: `${VAL}-1`, workItemId: VAL, hours: 3 }
  return {
    id: 'e2e-sprint',
    name: 'Sprint E2E',
    days: buildSprintDays(startOfWeek(todayISO()), 2, 8),
    hoursPerDay: 8,
    members: [DIOGO, SOFIA],
    capacityOverrides: {},
    queues: { diogo: [dev], sofia: [] },
    backlog: [val],
    workItems: Object.fromEntries(items.map((item) => [item.id, item])),
    notes: [],
    history: {},
    queryUrl: tfs.queryUrl,
    lastRefreshedAt: new Date().toISOString(),
    ...overrides
  }
}

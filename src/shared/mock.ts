import { buildSprintDays, startOfWeek, todayISO } from './dates'
import { freezeHistoryBefore, recordPast } from './scheduling'
import { DEFAULT_HOURS_PER_DAY, type Block, type Member, type Sprint, type WorkItem } from './types'

/**
 * Sample sprint used until the TFS import lands, so the grid can be built and judged
 * without credentials. It starts on the Monday of the current week, which keeps "today"
 * inside the sprint however long from now the app is opened.
 */

const MEMBER_NAMES = ['Diogo', 'Beatriz', 'Daniel', 'Ezra', 'Gilberto', 'Sofia', 'Vitor']

// id, title, type, remaining, state, parent id, TFS assignee, estimate, reported. Tasks hang
// off a User Story or a Bug, which is what the side panel groups them under; the parents carry
// no hours of their own. Assignees are written the several ways TFS actually returns them —
// plain, accented, and with the account trailing — so the drop check is genuinely exercised.
// The estimate/reported pair covers all three sizing cases: nothing reported yet (the estimate
// is the size), reported under the estimate, and an overrun.
type Row = [number, string, string, number, string, number?, string?, number?, number?]
const ITEMS: Row[] = [
  // Parents. Their state and Business Order are what auto-assign sorts on; 4710's tasks are
  // all scheduled already, so it shows as an empty group rather than disappearing.
  [4700, 'Tenant isolation hardening', 'User Story', 0, 'Active'],
  [4710, 'Release 24.09 data migration', 'User Story', 0, 'New'],
  [4720, 'Developer experience', 'User Story', 0, 'Active'],
  // A story split into development and validation for two different people, which is what
  // auto-assign's VAL-after-DEV rule is about.
  [4730, 'Bulk export to Excel', 'User Story', 0, 'Active'],
  [4731, 'DEV:: Bulk export to Excel', 'Task', 6, 'New', 4730, 'Diogo Mesquita', 6, 0],
  [4732, 'VAL:: Bulk export to Excel', 'Task', 3, 'New', 4730, 'Sofia Marques', 3, 0],
  // A person's meeting time for the sprint, which auto-assign spreads across the days.
  [4740, 'Meetings', 'Task', 8, 'New', 4720, 'Gilberto Sousa', 8, 0],

  [
    4821,
    'DEV:: Login fails after password reset',
    'Task',
    5,
    'Active',
    4700,
    'Diogo Mesquita',
    8,
    3
  ],
  [4830, 'DEV::Add audit entry for role change', 'Task', 3, 'Active', 4700, 'Daniel Costa', 3, 0],
  [4907, 'DEV:: Export service refactor', 'Task', 12, 'Active', 4720, 'Diogo Mesquita', 12, 4],
  [4788, '[TEST] Migration scripts for 24.09', 'Task', 8, 'Active', 4710, 'Beatriz Lopes', 8, 4],
  [4791, 'Review migration rollback plan', 'Task', 6, 'New', 4710, undefined, 6, 0],
  // A Bug that is a heading in its own right: it has a task under it, so the task carries the
  // hours and the bug is only a group.
  [4855, 'E2E :: Flaky integration test on CI', 'Bug', 0, 'Active', 4720],
  [4856, 'E2E :: Stabilise the CI container', 'Task', 4, 'Active', 4855, 'Daniel Costa', 4, 6],
  [
    4912,
    'DEV:: Cache invalidation on tenant switch',
    'Task',
    4,
    'New',
    4700,
    'Vítor Andrade',
    4,
    0
  ],
  // Hours reported in TFS that the calendar has no record of: nothing pinned, nothing frozen.
  // These are the ones drawn as done on the days before today.
  [4913, 'DEV:: Tenant switch telemetry', 'Task', 4, 'Active', 4700, 'Vítor Andrade', 6, 2],
  // Estimated, nothing left, hours reported: the size is the nine hours that were done, so it
  // can be dragged onto the days it actually happened.
  [4914, 'DEV:: Session cleanup job', 'Task', 0, 'Closed', 4700, 'Diogo Mesquita', 15, 9],
  [4934, '[TEST] Audit log retention policy', 'Task', 6, 'New', 4700, undefined, 6, 0],
  [4940, 'DEV:: Upgrade charting library', 'Task', 7, 'New', 4720, 'Ezra Nunes', 8, 0],
  [4951, 'Document deployment runbook', 'Task', 3, 'New', 4710, 'Sofia Marques', 3, 1],
  [4962, 'E2E:: Fix timezone drift in scheduler', 'Task', 5, 'Active', 4720, undefined, 5, 0],
  [4977, '[TEST] Bulk import performance', 'Task', 10, 'New', 4710, undefined, 10, 3],
  [
    4983,
    'DEV:: Retry policy for outbound webhooks',
    'Task',
    6,
    'New',
    4720,
    'Gilberto Sousa',
    6,
    0
  ],
  [4990, 'DEV:: Tenant onboarding wizard', 'Task', 9, 'New', 4700, undefined, 9, 0],
  // Backlogs here are written in a mix of English and Portuguese, so the sample carries an
  // accented title: searching for "validacao" has to find it.
  [4995, 'E2E :: Validação de sessão expirada', 'Task', 3, 'New', 4700, 'Sofia Marques', 3, 0],
  // A bug nobody has broken into tasks. Bugs are containers like stories, so it is never
  // draggable — it shows as an empty group, which is the point: work that cannot be planned
  // until somebody adds a task to it stays visible instead of vanishing.
  [4999, 'Crash on empty CSV export', 'Bug', 2, 'New', undefined, 'Ana Ribeiro <CMF\\aribeiro>']
]

let counter = 0

function block(workItemId: number, hours: number): Block {
  return { id: `mock-block-${++counter}`, workItemId, hours }
}

export function createMockSprint(): Sprint {
  const today = todayISO()
  const members: Member[] = MEMBER_NAMES.map((name, order) => ({
    id: name.toLowerCase(),
    name,
    order
  }))

  // Business Order, which only parents carry. Auto-assign puts 50 or lower first.
  const businessOrder: Record<number, number> = { 4700: 20, 4710: 80, 4720: 45, 4730: 30, 4855: 60 }

  const workItems: Record<number, WorkItem> = {}
  for (const [
    id,
    title,
    type,
    remainingWork,
    state,
    parentId,
    assignedTo,
    originalEstimate,
    completedWork
  ] of ITEMS) {
    workItems[id] = {
      id,
      title,
      type,
      state,
      remainingWork,
      parentId,
      assignedTo,
      originalEstimate,
      completedWork,
      businessOrder: businessOrder[id],
      url: `https://tfs-product.cmf.criticalmanufacturing.com/tfs/_workitems/edit/${id}`
    }
  }

  const days = buildSprintDays(startOfWeek(today), 2, DEFAULT_HOURS_PER_DAY)
  // A team-wide half day for demo and retro on the last day of the sprint.
  const lastDay = days[days.length - 1]
  lastDay.capacity = 4
  lastDay.label = 'Demo & retro'
  // A team-wide day off mid-sprint.
  const holiday = days[6]
  holiday.capacity = 0
  holiday.label = 'Public holiday'

  const sprint: Sprint = {
    id: 'mock',
    name: 'Sprint 24.09',
    days,
    hoursPerDay: DEFAULT_HOURS_PER_DAY,
    members,
    capacityOverrides: {
      // Ezra is away for the first two days of the second week.
      ezra: { [days[5].date]: 0, [days[7].date]: 0 },
      // Sofia works mornings on the Wednesday of week one.
      sofia: { [days[2].date]: 4 }
    },
    queues: {
      diogo: [block(4821, 5), block(4830, 3), block(4907, 8)],
      // More than fits in what is left of the sprint, so the spillover warning shows.
      beatriz: [block(4788, 8), block(4791, 6), block(4977, 10), block(4990, 9)],
      daniel: [block(4856, 4), block(4962, 5)],
      ezra: [block(4940, 7)],
      gilberto: [block(4983, 6)],
      sofia: [block(4951, 3)],
      vitor: [block(4913, 4)]
    },
    backlog: [
      block(4912, 4),
      block(4907, 4),
      block(4934, 6),
      block(4995, 3),
      block(4731, 6),
      block(4732, 3),
      block(4740, 8)
    ],
    notes: [
      {
        id: 'mock-note-1',
        memberId: 'beatriz',
        text: 'Out on Friday afternoon for a dentist appointment — moved the rollback review earlier.',
        taskIds: [4791],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'mock-note-2',
        memberId: 'diogo',
        text: 'Export refactor is blocked on the API contract from the platform team.',
        taskIds: [4907],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'mock-note-3',
        memberId: 'ezra',
        text: 'Back on Wednesday. Nothing scheduled before then.',
        taskIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ],
    workItems,
    history: {}
  }

  // Pin the days that have already passed. The queues above are what is *left* to do, so
  // the past is seeded from a separate set of blocks — the work that was actually picked up
  // earlier in the sprint. That is why 4821 shows a full day on Monday and still has five
  // hours queued today: it carried over.
  const worked: Record<string, Block[]> = {
    diogo: [block(4821, 8), block(4907, 10)],
    beatriz: [block(4788, 12), block(4977, 6)],
    daniel: [block(4856, 6), block(4962, 8)],
    ezra: [block(4940, 5)],
    gilberto: [block(4983, 9)],
    sofia: [block(4951, 7)],
    vitor: [block(4934, 4)]
  }
  // The past is drawn once from those, then kept as the sample's record, the way a real sprint
  // keeps it after a refresh.
  const withHistory = {
    ...sprint,
    history: freezeHistoryBefore({ ...sprint, queues: worked, history: {} }, today)
  }
  return { ...withHistory, pastRecord: recordPast(withHistory, today) }
}

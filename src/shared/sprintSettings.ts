import { setHoursPerDay, setQueryUrl } from './mutations'
import type { AppSettings, ChildQueryMode } from './settings'
import { DEFAULT_TASK_TEMPLATES, type TaskTemplate } from './taskCreation'
import type { Block, Member, Sprint } from './types'

/**
 * The settings a sprint has a copy of. The app's settings are the defaults a new sprint starts
 * with; from then on the sprint keeps its own — its URL, its day length, its people, how it
 * creates tasks and fetches children — so changing the defaults never reaches into a sprint
 * that is already being planned, and changing a sprint never changes the next one.
 */
export interface PlanSettings {
  queryUrl: string
  hoursPerDay: number
  members: Member[]
  childQueryMode: ChildQueryMode
  /** A member id, a TFS account, or '' for nobody. */
  docOwner: string
  qaOwner: string
  taskTemplates: TaskTemplate[]
}

/** The defaults a new sprint starts from. */
export function appPlan(settings: AppSettings): PlanSettings {
  return {
    queryUrl: settings.lastQueryUrl ?? '',
    hoursPerDay: settings.hoursPerDay,
    members: settings.members,
    childQueryMode: settings.childQueryMode ?? 'auto',
    docOwner: settings.docOwner ?? '',
    qaOwner: settings.qaOwner ?? '',
    taskTemplates: settings.taskTemplates?.length ? settings.taskTemplates : DEFAULT_TASK_TEMPLATES
  }
}

/**
 * A sprint's own settings. A sprint saved before it kept its own copy borrows the app's for
 * whatever it lacks — `withAppDefaults` makes that copy when it is opened.
 */
export function sprintPlan(sprint: Sprint, settings: AppSettings | null): PlanSettings {
  const app = settings ? appPlan(settings) : undefined
  return {
    queryUrl: sprint.queryUrl ?? '',
    hoursPerDay: sprint.hoursPerDay,
    members: sprint.members,
    childQueryMode: sprint.childQueryMode ?? app?.childQueryMode ?? 'auto',
    docOwner: sprint.docOwner ?? app?.docOwner ?? '',
    qaOwner: sprint.qaOwner ?? app?.qaOwner ?? '',
    taskTemplates: sprint.taskTemplates ?? app?.taskTemplates ?? DEFAULT_TASK_TEMPLATES
  }
}

/**
 * Gives a sprint saved before it kept its own settings a copy of the app's, so it goes on
 * behaving exactly as it did — and stops following the app's from here on. The same sprint
 * when it has them all already.
 */
export function withAppDefaults(sprint: Sprint, settings: AppSettings): Sprint {
  if (
    sprint.childQueryMode !== undefined &&
    sprint.docOwner !== undefined &&
    sprint.qaOwner !== undefined &&
    sprint.taskTemplates !== undefined
  ) {
    return sprint
  }
  const plan = sprintPlan(sprint, settings)
  return {
    ...sprint,
    childQueryMode: plan.childQueryMode,
    docOwner: plan.docOwner,
    qaOwner: plan.qaOwner,
    taskTemplates: plan.taskTemplates
  }
}

/** People the new list leaves out who have work on their calendar, and how many tasks. */
export function removedWithWork(
  sprint: Sprint,
  members: Member[]
): Array<{ member: Member; tasks: number }> {
  const kept = new Set(members.map((member) => member.id))
  return sprint.members
    .filter((member) => !kept.has(member.id))
    .map((member) => ({ member, tasks: (sprint.queues[member.id] ?? []).length }))
    .filter((entry) => entry.tasks > 0)
}

/**
 * The sprint's rows become `members`, in that order. Anyone left out goes, and their tasks go
 * back to the backlog, unpinned — along with their days off and the done hours recorded on
 * their row, which belonged to a row that is no longer there.
 */
export function setSprintMembers(sprint: Sprint, members: Member[]): Sprint {
  const ordered = members.map((member, order) => ({ ...member, order }))
  const same =
    ordered.length === sprint.members.length &&
    ordered.every((member, index) => {
      const old = sprint.members[index]
      return (
        old.id === member.id &&
        old.name === member.name &&
        old.tfsIdentity === member.tfsIdentity &&
        old.order === member.order
      )
    })
  if (same) return sprint

  const kept = new Set(ordered.map((member) => member.id))
  const gone = sprint.members.filter((member) => !kept.has(member.id)).map((m) => m.id)
  const returned: Block[] = gone.flatMap((id) =>
    (sprint.queues[id] ?? []).map(({ pin: _pin, ...block }) => block)
  )
  const without = <T>(record: Record<string, T> | undefined): Record<string, T> | undefined =>
    record && Object.fromEntries(Object.entries(record).filter(([id]) => kept.has(id)))

  const queues = Object.fromEntries(ordered.map((m) => [m.id, sprint.queues[m.id] ?? []]))
  const reportedPins = sprint.reportedPins
    ? Object.fromEntries(
        Object.entries(sprint.reportedPins).filter(([, pin]) => kept.has(pin.memberId))
      )
    : undefined

  return {
    ...sprint,
    members: ordered,
    queues,
    backlog: [...sprint.backlog, ...returned],
    capacityOverrides: without(sprint.capacityOverrides) ?? {},
    history: without(sprint.history) ?? {},
    ...(sprint.pastRecord ? { pastRecord: without(sprint.pastRecord) } : {}),
    ...(reportedPins ? { reportedPins } : {})
  }
}

/**
 * Applies what the Sprint tab of Settings says, as one change: the name, the URL Refresh reads,
 * the day length (which rescales the calendar), the people, and how tasks are created and
 * children fetched. The same sprint when nothing differs.
 */
export function applySprintSettings(sprint: Sprint, next: PlanSettings & { name: string }): Sprint {
  let result = setSprintMembers(sprint, next.members)
  result = setHoursPerDay(result, next.hoursPerDay)
  result = setQueryUrl(result, next.queryUrl)
  const name = next.name.trim()
  const changes: Partial<Sprint> = {}
  if (name && name !== result.name) changes.name = name
  if (next.childQueryMode !== result.childQueryMode) changes.childQueryMode = next.childQueryMode
  if (next.docOwner !== result.docOwner) changes.docOwner = next.docOwner
  if (next.qaOwner !== result.qaOwner) changes.qaOwner = next.qaOwner
  if (JSON.stringify(next.taskTemplates) !== JSON.stringify(result.taskTemplates)) {
    changes.taskTemplates = next.taskTemplates
  }
  return Object.keys(changes).length > 0 ? { ...result, ...changes } : result
}

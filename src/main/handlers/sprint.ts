import { buildSprintDays } from '@shared/dates'
import { schedulableItems } from '@shared/grouping'
import type { StartSprintRequest } from '@shared/settings'
import { appPlan } from '@shared/sprintSettings'
import { plannedHours } from '@shared/sizing'
import type { Block, Sprint, WorkItem } from '@shared/types'
import { getSettings, loadSprint, newSprintId, saveSprint, updateSettings } from '../storage'
import { clientFor, rememberBusinessOrderField } from './tfs'

/** Starting a sprint from a TFS query, and moving between saved sprints. */

export async function startSprint(request: StartSprintRequest): Promise<Sprint> {
  const settings = await getSettings()
  if (settings.members.length === 0) {
    throw new Error('Add the team members in Settings first — they are the rows of the calendar.')
  }

  const defaults = appPlan(settings)
  const { client } = await clientFor(request.queryUrl)
  const items = await client.fetchSprintItems(defaults.childQueryMode)
  await rememberBusinessOrderField(client)

  const workItems: Record<number, WorkItem> = {}
  for (const item of items) workItems[item.id] = item

  // A story or bug is a heading in the panel, not something you can drag onto a calendar, so
  // only the leaves become blocks — sized by what is left of them.
  const backlog: Block[] = schedulableItems(items).map((item) => ({
    id: `${item.id}-1`,
    workItemId: item.id,
    hours: plannedHours(item)
  }))

  const sprint: Sprint = {
    id: newSprintId(),
    name: request.name.trim() || 'Sprint',
    days: buildSprintDays(
      request.startDate,
      request.weeks,
      settings.hoursPerDay,
      request.includeWeekends
    ),
    hoursPerDay: settings.hoursPerDay,
    members: settings.members,
    capacityOverrides: {},
    queues: Object.fromEntries(settings.members.map((member) => [member.id, []])),
    backlog,
    workItems,
    notes: [],
    queryUrl: request.queryUrl,
    lastRefreshedAt: new Date().toISOString(),
    history: {},
    // Its own copy of the app's defaults: changing those later leaves this sprint as it is.
    childQueryMode: defaults.childQueryMode,
    docOwner: defaults.docOwner,
    qaOwner: defaults.qaOwner,
    taskTemplates: defaults.taskTemplates
  }

  await saveSprint(sprint)
  await updateSettings({ activeSprintId: sprint.id, lastQueryUrl: request.queryUrl })
  return sprint
}

/** Opens a saved sprint and makes it the one the app starts on. */
export async function switchSprint(id: string): Promise<Sprint> {
  const sprint = await loadSprint(id)
  if (!sprint) throw new Error('Sprint not found.')
  await updateSettings({ activeSprintId: id })
  return sprint
}

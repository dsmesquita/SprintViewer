import { memberFor } from './assignment'
import { toISO } from './dates'
import { isContainerType } from './grouping'
import { NOTE_CATEGORIES } from './notes'
import { anchorFor, effectiveCapacity, layoutSprint, type MemberLayout } from './scheduling'
import { completedHours, isOffTrack, OFF_TRACK_RATIO } from './sizing'
import type { Snapshot } from './snapshots'
import type { ISODate, Sprint, WorkItem } from './types'
import { round } from './math'

/**
 * A sprint written down for later: the plan, what happened, and what everyone noted.
 *
 * The file is read by an AI agent that builds the organised summary, so it is written for a
 * reader who knows nothing about this app — every figure is defined in the file itself, dates
 * are ISO, hours are plain numbers, and the headings never change from one sprint to the next.
 * People can read it too, which matters when the agent's summary is questioned.
 */

export type ItemFlag =
  | 'off track'
  | 'added mid-sprint'
  | 'reassigned'
  | 'not finished'
  | 'slipped'
  | 'removed'
  | 'in backlog'

export interface ItemMetrics {
  id: number
  title: string
  type: string
  /** TFS state at the end. */
  state: string
  parent?: string
  url: string
  /** Team member ids: whose row it was on in the plan, and whose it is on at the end. */
  ownerStart?: string
  ownerEnd?: string
  /** Hours on calendars in the plan. Zero when it was not in the plan. */
  planned: number
  inPlan: boolean
  /** Hours reported during the sprint. Undefined when there is no way to know. */
  done?: number
  /** True when `done` is planned − remaining, because the server does not track Completed Work. */
  doneEstimated: boolean
  remaining?: number
  /** done + remaining − planned, for planned tasks. Positive: it took, or needs, more. */
  growth?: number
  /** Original Estimate, which is used for nothing but the off-track judgement. */
  estimate?: number
  finished: boolean
  flags: ItemFlag[]
}

export interface PersonMetrics {
  memberId: string
  name: string
  identity?: string
  available: number
  reducedDays: string[]
  planned: number
  done: number
  doneEstimated: boolean
  remaining: number
  /** Hours done on work that was not in the plan. */
  extraUnplanned: number
  /** Hours by which planned work outgrew its plan. */
  extraGrowth: number
  /** Planned work not finished: how many tasks, and the hours still left on them. */
  delayCount: number
  delayHours: number
  slipped: number
  /** Tasks of theirs that took more than a quarter longer than their estimate. */
  offTrack: number
  spillover: number
  notes: Record<string, number>
}

export interface SprintMetrics {
  asOf: ISODate
  finished: boolean
  tracksCompleted: boolean
  hasPlan: boolean
  items: ItemMetrics[]
  people: PersonMetrics[]
}

const UNCATEGORISED = 'Uncategorised'

// ---------------------------------------------------------------------------------------------
// Figures

/**
 * Every figure the summary reports, worked out from the board now and the plan snapshot.
 *
 * Kept apart from the writing so it can be checked on its own: a wrong number in a summary is
 * the thing that matters, and it is far easier to see in data than in prose.
 */
export function sprintMetrics(
  sprint: Sprint,
  plan: Snapshot | null,
  today: ISODate
): SprintMetrics {
  const planSprint = plan?.sprint
  const nowAnchor = anchorFor(sprint, today)
  const nowLayouts = layoutSprint(sprint, nowAnchor)
  const planLayouts = planSprint ? layoutSprint(planSprint, planAnchor(plan!)) : {}

  const tracksCompleted = Object.values(sprint.workItems).some(
    (item) => item.completedWork !== undefined
  )
  const plannedHours = planSprint ? hoursByItem(planSprint) : new Map<number, number>()
  const planHolders = planSprint ? holders(planSprint) : new Map<number, string>()
  const nowHolders = holders(sprint)
  const planEnds = lastDates(planLayouts)
  const nowEnds = lastDates(nowLayouts)
  const inBacklog = new Set(sprint.backlog.map((block) => block.workItemId))

  const ids = new Set<number>()
  for (const source of [sprint.workItems, planSprint?.workItems ?? {}]) {
    for (const item of Object.values(source)) if (!isContainerType(item.type)) ids.add(item.id)
  }

  const items: ItemMetrics[] = []
  for (const id of [...ids].sort((a, b) => a - b)) {
    const now = sprint.workItems[id]
    const then = planSprint?.workItems[id]
    const item = now ?? then!
    const planned = round(plannedHours.get(id) ?? 0)
    const inPlan = planned > 0
    const remaining = now ? Math.max(0, round(now.remainingWork)) : undefined
    const removed = Boolean(then && inPlan && (!now || now.missingFromQuery))

    let done: number | undefined
    if (tracksCompleted) {
      done = Math.max(0, round((completedHours(now) ?? 0) - (completedHours(then) ?? 0)))
    } else if (inPlan && remaining !== undefined) {
      done = Math.max(0, round(planned - remaining))
    }

    const finished = remaining === 0 || isClosed(now?.state)
    const onCalendar = nowHolders.has(id)
    const ownerStart = planHolders.get(id)
    const ownerEnd = nowHolders.get(id) ?? assignee(sprint, now) ?? ownerStart

    // Only things that were part of this sprint: planned, on a calendar now, waiting in the
    // backlog, or worked on. A work item the query happens to carry and nobody touched is not.
    const relevant =
      inPlan || onCalendar || (inBacklog.has(id) && !finished) || (done ?? 0) > 0 || removed
    if (!relevant) continue

    const flags: ItemFlag[] = []
    if (isOffTrack(now)) flags.push('off track')
    if (plan && !inPlan && (onCalendar || (done ?? 0) > 0)) flags.push('added mid-sprint')
    const nowHolder = nowHolders.get(id)
    if (ownerStart && nowHolder && ownerStart !== nowHolder) flags.push('reassigned')
    if (inPlan && !finished && !removed) flags.push('not finished')
    const planEnd = planEnds.get(id)
    const nowEnd = nowEnds.get(id)
    if (planEnd && nowEnd && nowEnd > planEnd && !finished) flags.push('slipped')
    if (removed) flags.push('removed')
    if (!onCalendar && inBacklog.has(id) && !finished) flags.push('in backlog')

    const parent =
      item.parentId !== undefined
        ? (sprint.workItems[item.parentId] ?? planSprint?.workItems[item.parentId])
        : undefined
    items.push({
      id,
      title: item.title,
      type: item.type,
      state: now?.state ?? 'not in the query any more',
      parent: parent ? `#${parent.id} ${parent.title}` : undefined,
      url: item.url,
      ownerStart,
      ownerEnd,
      planned,
      inPlan,
      done,
      doneEstimated: !tracksCompleted && done !== undefined,
      remaining,
      estimate: now?.originalEstimate ?? then?.originalEstimate,
      growth:
        inPlan && done !== undefined && remaining !== undefined
          ? round(done + remaining - planned)
          : undefined,
      finished,
      flags
    })
  }

  const people: PersonMetrics[] = [...sprint.members]
    .sort((a, b) => a.order - b.order)
    .map((member) => {
      const started = items.filter((item) => item.ownerStart === member.id)
      const ended = items.filter((item) => item.ownerEnd === member.id)
      const notes: Record<string, number> = {}
      for (const note of sprint.notes.filter((n) => n.memberId === member.id)) {
        const key = note.category ?? UNCATEGORISED
        notes[key] = (notes[key] ?? 0) + 1
      }
      const late = started.filter((item) => item.flags.includes('not finished'))
      return {
        memberId: member.id,
        name: member.name,
        identity: member.tfsIdentity,
        available: round(
          sum(sprint.days.map((day) => effectiveCapacity(sprint, member.id, day.date)))
        ),
        reducedDays: sprint.days
          .filter((day) => effectiveCapacity(sprint, member.id, day.date) < sprint.hoursPerDay)
          .map((day) => {
            const hours = effectiveCapacity(sprint, member.id, day.date)
            return `${day.date} (${hours === 0 ? 'off' : `${hours}h`}${day.label ? `, ${day.label}` : ''})`
          }),
        planned: round(sum(started.map((item) => item.planned))),
        done: round(sum(ended.map((item) => item.done ?? 0))),
        doneEstimated: !tracksCompleted,
        remaining: round(
          sum(ended.filter((item) => !item.finished).map((item) => item.remaining ?? 0))
        ),
        extraUnplanned: plan
          ? round(sum(ended.filter((item) => !item.inPlan).map((item) => item.done ?? 0)))
          : 0,
        extraGrowth: round(sum(started.map((item) => Math.max(0, item.growth ?? 0)))),
        delayCount: late.length,
        delayHours: round(sum(late.map((item) => item.remaining ?? 0))),
        slipped: started.filter((item) => item.flags.includes('slipped')).length,
        // Judged on whoever holds it at the end: the estimate is about the task, and the
        // person who finished it is the one who lived with it.
        offTrack: ended.filter((item) => item.flags.includes('off track')).length,
        spillover: round(nowLayouts[member.id]?.spillover ?? 0),
        notes
      }
    })

  const lastDay = sprint.days[sprint.days.length - 1]?.date
  return {
    asOf: today,
    finished: lastDay !== undefined && today > lastDay,
    tracksCompleted,
    hasPlan: plan !== null,
    items,
    people
  }
}

/** The day the plan snapshot was laid out from: the working day it was taken on, or after. */
function planAnchor(plan: Snapshot): ISODate {
  return anchorFor(plan.sprint, toISO(new Date(plan.takenAt)))
}

/** Hours of each work item on anyone's calendar. */
function hoursByItem(sprint: Sprint): Map<number, number> {
  const hours = new Map<number, number>()
  for (const queue of Object.values(sprint.queues)) {
    for (const block of queue)
      hours.set(block.workItemId, (hours.get(block.workItemId) ?? 0) + block.hours)
  }
  return hours
}

/** Whose calendar each work item is on — whoever holds most of it, when it is split. */
function holders(sprint: Sprint): Map<number, string> {
  const byItem = new Map<number, Map<string, number>>()
  for (const [memberId, queue] of Object.entries(sprint.queues)) {
    for (const block of queue) {
      const shares = byItem.get(block.workItemId) ?? new Map<string, number>()
      shares.set(memberId, (shares.get(memberId) ?? 0) + block.hours)
      byItem.set(block.workItemId, shares)
    }
  }
  const out = new Map<number, string>()
  for (const [id, shares] of byItem) {
    out.set(id, [...shares].sort((a, b) => b[1] - a[1])[0][0])
  }
  return out
}

/** The last day each work item is planned on — records of the past aside. */
function lastDates(layouts: Record<string, MemberLayout>): Map<number, ISODate> {
  const out = new Map<number, ISODate>()
  for (const layout of Object.values(layouts)) {
    for (const segment of layout.segments) {
      if (segment.fromHistory || segment.isDone) continue
      const seen = out.get(segment.workItemId)
      if (!seen || segment.date > seen) out.set(segment.workItemId, segment.date)
    }
  }
  return out
}

function assignee(sprint: Sprint, item: WorkItem | undefined): string | undefined {
  return memberFor(sprint.members, item?.assignedTo)?.id
}

function isClosed(state: string | undefined): boolean {
  return state !== undefined && /^(closed|done|resolved|removed|completed)$/i.test(state.trim())
}

// ---------------------------------------------------------------------------------------------
// Writing

export interface SummaryInput {
  sprint: Sprint
  /** The snapshot that counts as the plan. Null when there is none. */
  plan: Snapshot | null
  today: ISODate
  /** ISO timestamp, written into the header. */
  generatedAt: string
}

/** The summary file, as Markdown. */
export function buildSprintSummary({ sprint, plan, today, generatedAt }: SummaryInput): string {
  const metrics = sprintMetrics(sprint, plan, today)
  const nameOf = (id: string | undefined): string =>
    id
      ? (sprint.members.find((m) => m.id === id)?.name ??
        plan?.sprint.members.find((m) => m.id === id)?.name ??
        id)
      : '—'
  const first = sprint.days[0]?.date ?? ''
  const last = sprint.days[sprint.days.length - 1]?.date ?? ''
  const out: string[] = []
  const line = (text = ''): void => {
    out.push(text)
  }

  // Header
  line('---')
  line('type: sprint-summary')
  line(`sprint: ${quote(sprint.name)}`)
  line(`start: ${first}`)
  line(`end: ${last}`)
  line(`as_of: ${metrics.asOf}`)
  line(`sprint_finished: ${metrics.finished}`)
  line(`generated_at: ${generatedAt}`)
  line(`plan_snapshot: ${plan ? quote(plan.name) : 'none'}`)
  if (plan) line(`plan_taken_at: ${plan.takenAt}`)
  line(`hours_per_day: ${sprint.hoursPerDay}`)
  line(`completed_work_tracked: ${metrics.tracksCompleted}`)
  if (sprint.queryUrl) line(`source: ${quote(sprint.queryUrl)}`)
  line('---')
  line()
  line(`# Sprint summary — ${sprint.name}`)
  line()
  line(
    `${first} to ${last}. ${
      metrics.finished
        ? 'The sprint has ended.'
        : `Written on ${metrics.asOf}, before the sprint ended — figures are as of that day.`
    }`
  )
  line()

  // How to read
  line('## How to read this file')
  line()
  line(
    'All hours are plain numbers of hours. Dates are YYYY-MM-DD. People are named as on the planning board.'
  )
  line()
  line(
    plan
      ? `- **Plan**: the board in the snapshot "${plan.name}", taken ${plan.takenAt}. Everything "planned" is measured against it.`
      : '- **Plan**: no plan snapshot was available, so nothing below is compared against a plan, and the planned, extra-work and delay figures are not given.'
  )
  line("- **Planned**: hours of a task that were on someone's calendar in the plan.")
  line(
    metrics.tracksCompleted
      ? '- **Done**: hours reported against the task in TFS (Completed Work) during the sprint — reported at the end minus reported in the plan, so hours from earlier sprints are not counted.'
      : '- **Done**: this TFS server does not track Completed Work, so done is estimated as planned minus remaining, and only for planned tasks. Treat it as approximate.'
  )
  line('- **Remaining**: Remaining Work in TFS at the end.')
  line(
    `- **Estimate** is Original Estimate in TFS. It is not used to size anything — a task is worth its remaining plus completed work — and appears only here. **Off track** marks a task whose completed work is more than ${Math.round((OFF_TRACK_RATIO - 1) * 100)}% above its estimate, which is worth asking about.`
  )
  line(
    '- **Growth**: done + remaining − planned, for planned tasks. Positive means the task took, or still needs, more than planned.'
  )
  line(
    '- **Extra work**: hours done on tasks that were not in the plan, plus the positive growth of planned tasks.'
  )
  line(
    '- **Delay**: planned tasks not finished — how many, and the hours still remaining on them. **Slipped** counts planned tasks now due to end on a later day than planned.'
  )
  line('- **Spillover**: hours a person has planned that do not fit in what is left of the sprint.')
  line(
    '- Planned figures belong to whoever had the task in the plan; done and remaining belong to whoever has it at the end.'
  )
  line(
    '- On the boards: *[reported]* is time reported in TFS and drawn on past days, *[recorded]* is how a past day was planned at the time, *[pinned]* is a task fixed to a slot by hand.'
  )
  line()

  // Sprint and team
  line('## Sprint and team')
  line()
  const reducedTeamDays = sprint.days.filter((day) => day.capacity < sprint.hoursPerDay)
  line(`- Working days: ${sprint.days.length}, from ${first} to ${last}.`)
  if (reducedTeamDays.length > 0) {
    line(
      `- Days reduced for everyone: ${reducedTeamDays
        .map(
          (day) =>
            `${day.date} (${day.capacity === 0 ? 'off' : `${day.capacity}h`}${day.label ? `, ${day.label}` : ''})`
        )
        .join('; ')}.`
    )
  }
  line()
  line(
    table(
      ['Person', 'TFS identity', 'Available (h)', 'Days off or part days'],
      metrics.people.map((p) => [
        p.name,
        p.identity ?? '—',
        num(p.available),
        p.reducedDays.join('; ') || '—'
      ])
    )
  )
  line()

  // Boards
  if (plan) {
    line(`## Board at the start (${plan.name})`)
    line()
    board(plan.sprint, planAnchor(plan), 'plan taken', line)
  }
  line(`## Board at the end (as of ${metrics.asOf})`)
  line()
  board(sprint, anchorFor(sprint, today), 'today', line)

  // Per person
  line('## Planned vs actual, per person')
  line()
  const estimated = metrics.tracksCompleted ? '' : ' (estimated)'
  line(
    plan
      ? table(
          [
            'Person',
            'Available',
            'Planned',
            `Done${estimated}`,
            'Remaining',
            'Extra work',
            'Delayed tasks',
            'Delayed hours',
            'Slipped',
            'Off track',
            'Spillover'
          ],
          metrics.people.map((p) => [
            p.name,
            num(p.available),
            num(p.planned),
            num(p.done),
            num(p.remaining),
            num(round(p.extraUnplanned + p.extraGrowth)),
            String(p.delayCount),
            num(p.delayHours),
            String(p.slipped),
            String(p.offTrack),
            num(p.spillover)
          ])
        )
      : table(
          ['Person', 'Available', `Done${estimated}`, 'Remaining', 'Off track', 'Spillover'],
          metrics.people.map((p) => [
            p.name,
            num(p.available),
            num(p.done),
            num(p.remaining),
            String(p.offTrack),
            num(p.spillover)
          ])
        )
  )
  line()
  for (const person of metrics.people) {
    line(`### ${person.name}`)
    line()
    const mine = metrics.items.filter(
      (item) => item.ownerStart === person.memberId || item.ownerEnd === person.memberId
    )
    if (plan) {
      line(
        `- Planned ${num(person.planned)}h of ${num(person.available)}h available; done ${num(person.done)}h${estimated}; ${num(person.remaining)}h remaining at the end.`
      )
      line(
        `- Extra work: ${num(round(person.extraUnplanned + person.extraGrowth))}h — ${num(person.extraUnplanned)}h on tasks not in the plan, ${num(person.extraGrowth)}h of growth on planned tasks.`
      )
      line(
        `- Delay: ${person.delayCount} planned ${person.delayCount === 1 ? 'task' : 'tasks'} not finished, ${num(person.delayHours)}h remaining; ${person.slipped} slipped.`
      )
    }
    if (person.offTrack > 0) {
      line(
        `- Off track: ${person.offTrack} ${person.offTrack === 1 ? 'task' : 'tasks'} took more than a quarter longer than the estimate.`
      )
    } else {
      line(
        `- Done ${num(person.done)}h${estimated}; ${num(person.remaining)}h remaining at the end.`
      )
    }
    const flagged = mine.filter((item) => item.flags.length > 0)
    if (flagged.length > 0) {
      line(
        `- Tasks to note: ${flagged.map((item) => `#${item.id} (${item.flags.join(', ')})`).join('; ')}.`
      )
    }
    line()
  }

  // Work items
  line('## Work items')
  line()
  // Without a plan, the plan's columns would be a column of zeros that reads like a finding.
  const columns: Array<[string, (item: ItemMetrics) => string, boolean]> = [
    ['Id', (item) => `[#${item.id}](${item.url})`, true],
    ['Title', (item) => item.title, true],
    ['Parent', (item) => item.parent ?? '—', true],
    ['TFS state', (item) => item.state, true],
    ['Owner at start', (item) => nameOf(item.ownerStart), metrics.hasPlan],
    ['Owner at end', (item) => nameOf(item.ownerEnd), true],
    ['Planned', (item) => num(item.planned), metrics.hasPlan],
    ['Estimate', (item) => (item.estimate === undefined ? '—' : num(item.estimate)), true],
    [`Done${estimated}`, (item) => (item.done === undefined ? '—' : num(item.done)), true],
    ['Remaining', (item) => (item.remaining === undefined ? '—' : num(item.remaining)), true],
    ['Growth', (item) => (item.growth === undefined ? '—' : signed(item.growth)), metrics.hasPlan],
    ['Flags', (item) => item.flags.join(', ') || '—', true]
  ]
  const shown = columns.filter(([, , show]) => show)
  line(
    table(
      shown.map(([header]) => header),
      metrics.items.map((item) => shown.map(([, value]) => value(item)))
    )
  )
  line()

  // Notes
  line('## Notes')
  line()
  const noted = metrics.people.filter((p) =>
    sprint.notes.some((note) => note.memberId === p.memberId)
  )
  if (noted.length === 0) {
    line('No notes were written during this sprint.')
    line()
  } else {
    const columns = [...NOTE_CATEGORIES, UNCATEGORISED]
    line('Notes per person and category:')
    line()
    line(
      table(
        ['Person', ...columns, 'Total'],
        metrics.people.map((p) => [
          p.name,
          ...columns.map((c) => String(p.notes[c] ?? 0)),
          String(sum(Object.values(p.notes)))
        ])
      )
    )
    line()
    for (const person of noted) {
      line(`### ${person.name}`)
      line()
      const notes = sprint.notes
        .filter((note) => note.memberId === person.memberId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      for (const note of notes) {
        const tasks = note.taskIds.map((id) => {
          const item = sprint.workItems[id]
          return item ? `[#${id} ${item.title}](${item.url})` : `#${id}`
        })
        line(
          `- **${note.category ?? UNCATEGORISED}** · ${note.createdAt.slice(0, 10)}${
            tasks.length > 0 ? ` · about ${tasks.join(', ')}` : ''
          }`
        )
        for (const text of note.text.split(/\r?\n/)) line(`  > ${text}`)
      }
      line()
    }
  }

  return out.join('\n')
}

/**
 * Each person's board, day by day. `marker` names the day the board was looked at from: days
 * before it hold what was recorded, days from it on what was planned.
 */
function board(
  sprint: Sprint,
  anchor: ISODate,
  marker: string,
  line: (text?: string) => void
): void {
  const layouts = layoutSprint(sprint, anchor)
  for (const member of [...sprint.members].sort((a, b) => a.order - b.order)) {
    line(`### ${member.name}`)
    line()
    const segments = layouts[member.id]?.segments ?? []
    const rows = sprint.days.map((day) => {
      const capacity = effectiveCapacity(sprint, member.id, day.date)
      const byItem = new Map<number, { hours: number; start: number; kinds: Set<string> }>()
      for (const segment of segments.filter((s) => s.date === day.date)) {
        const entry = byItem.get(segment.workItemId) ?? {
          hours: 0,
          start: segment.startHour,
          kinds: new Set<string>()
        }
        entry.hours = round(entry.hours + segment.hours)
        entry.start = Math.min(entry.start, segment.startHour)
        if (segment.isDone) entry.kinds.add('reported')
        else if (segment.fromHistory) entry.kinds.add('recorded')
        else if (segment.pinned) entry.kinds.add('pinned')
        byItem.set(segment.workItemId, entry)
      }
      const work = [...byItem]
        .sort((a, b) => a[1].start - b[1].start)
        .map(([id, entry]) => {
          const title = sprint.workItems[id]?.title ?? ''
          const kinds = entry.kinds.size > 0 ? ` [${[...entry.kinds].join(', ')}]` : ''
          return `#${id} ${title} (${num(entry.hours)}h)${kinds}`
        })
      const off = capacity <= 0 ? (day.label ?? 'day off') : ''
      return [
        `${day.date} ${weekday(day.date)}${day.date === anchor ? ` ← ${marker}` : ''}`,
        work.join('; ') || off || '—'
      ]
    })
    line(table(['Day', 'Work'], rows))
    line()
  }
}

// ---------------------------------------------------------------------------------------------
// Formatting

function table(headers: string[], rows: string[][]): string {
  const cell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
  return [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)
  ].join('\n')
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function weekday(date: ISODate): string {
  const [y, m, d] = date.split('-').map(Number)
  return WEEKDAYS[new Date(y, m - 1, d).getDay()]
}

/** A YAML scalar that survives any title — quotes, colons and all. */
function quote(value: string): string {
  return JSON.stringify(value)
}

function num(value: number): string {
  return String(round(value))
}

function signed(value: number): string {
  return value > 0 ? `+${num(value)}` : num(value)
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

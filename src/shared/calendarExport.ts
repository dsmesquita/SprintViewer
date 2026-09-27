import { isMeeting } from './autoAssign'
import { formatDayHeader, formatRange } from './dates'
import { effectiveCapacity, type MemberLayout } from './scheduling'
import { tagOf, UNTAGGED } from './tags'
import type { ISODate, Sprint, WorkItem } from './types'

/**
 * One person's calendar as a plain board: a row per sprint day, and in it the tasks drawn on
 * that day, in the order they come — `#15243 (DEV) / #12345 (VAL)`. The export dialog shows it,
 * and it is what the Markdown and PNG files hold.
 */

export interface ExportOptions {
  /** Include meeting tasks. Off by default: they are not what a calendar export is about. */
  showMeetings: boolean
}

export interface ExportRow {
  date: ISODate
  /** "Mon 14/09" */
  day: string
  /** "#15243 (DEV) / #12345 (VAL)", or a note for an empty day off or locked day. */
  tasks: string
}

export interface CalendarExport {
  memberId: string
  memberName: string
  /** "Sprint 24.09 · 14 Sep – 25 Sep" */
  subtitle: string
  rows: ExportRow[]
}

/** How a task is labelled: its tag, `(Meeting)` for a meeting, `(Other)` with no tag. */
export function exportLabel(item: WorkItem | undefined): string {
  if (!item) return '(Other)'
  if (isMeeting(item)) return '(Meeting)'
  const tag = tagOf(item.title)
  return tag === UNTAGGED ? '(Other)' : `(${tag})`
}

/** One person's board, from the calendar as it is drawn. */
export function calendarExport(
  sprint: Sprint,
  layouts: Record<string, MemberLayout>,
  memberId: string,
  options: ExportOptions
): CalendarExport {
  const member = sprint.members.find((m) => m.id === memberId)
  const segments = layouts[memberId]?.segments ?? []
  const locked = new Set(sprint.lockedDays ?? [])

  const rows = sprint.days.map((day): ExportRow => {
    const ids: number[] = []
    for (const segment of [...segments]
      .filter((s) => s.date === day.date)
      .sort((a, b) => a.startHour - b.startHour)) {
      if (ids.includes(segment.workItemId)) continue
      if (!options.showMeetings && isMeeting(sprint.workItems[segment.workItemId])) continue
      ids.push(segment.workItemId)
    }
    const tasks = ids.map((id) => `#${id} ${exportLabel(sprint.workItems[id])}`).join(' / ')
    const note =
      effectiveCapacity(sprint, memberId, day.date) <= 0
        ? 'Day off'
        : locked.has(day.date)
          ? 'Locked'
          : ''
    return { date: day.date, day: formatDayHeader(day.date), tasks: tasks || note }
  })

  const first = sprint.days[0]?.date
  const last = sprint.days[sprint.days.length - 1]?.date
  return {
    memberId,
    memberName: member?.name ?? memberId,
    subtitle: first && last ? `${sprint.name} · ${formatRange(first, last)}` : sprint.name,
    rows
  }
}

/** The board as a Markdown document: a heading and a two-column table. */
export function calendarMarkdown(board: CalendarExport): string {
  const cell = (text: string): string => text.replace(/\|/g, '\\|')
  return [
    `# ${board.memberName}`,
    '',
    board.subtitle,
    '',
    '| Day | Tasks |',
    '| --- | --- |',
    ...board.rows.map((row) => `| ${cell(row.day)} | ${cell(row.tasks)} |`),
    ''
  ].join('\n')
}

/** A file name for one person's export: "Sprint 24.09 - Diogo". */
export function exportFileName(sprint: Sprint, board: CalendarExport): string {
  return `${sprint.name} - ${board.memberName}`
}

/** A file the export writes: its name without extension, its kind, and what goes in it. */
export interface ExportFile {
  name: string
  kind: 'md' | 'png'
  /** The Markdown text, or the PNG image as base64. */
  content: string
}

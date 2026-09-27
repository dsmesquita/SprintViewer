import { useState } from 'react'
import { formatRange } from '@shared/dates'
import { doneWaiting } from '@shared/doneHours'
import type { PastConflict } from '@shared/pastFit'
import { cx, hours } from '../format'
import {
  AssignIcon,
  CameraIcon,
  ClearIcon,
  ExportIcon,
  RefreshIcon,
  SettingsIcon,
  UndoIcon,
  WarningIcon
} from '../icons'
import { useApp } from '../store'

interface Props {
  /** Reported hours that will not fit before today, surfaced as a warning pill. */
  conflicts: PastConflict[]
  /** Hours over capacity across the team, on the board as currently shown. */
  spillover: number
  /** Blocks on the calendar — nothing to clear when there are none. */
  blocksOnCalendar: number
  onShowPastFit: () => void
  onAutoAssign: () => void
  onClear: () => void
}

/**
 * The bar across the top: what sprint this is and how it stands, then every whole-board
 * action. Actions that need a decision first (auto-assign, clear) hand back to the caller,
 * which owns the dialog that asks.
 */
export default function Toolbar({
  conflicts,
  spillover,
  blocksOnCalendar,
  onShowPastFit,
  onAutoAssign,
  onClear
}: Props): JSX.Element {
  const sprint = useApp((s) => s.sprint)
  const isSample = useApp((s) => s.isSample)
  const saveError = useApp((s) => s.saveError)
  const refreshing = useApp((s) => s.refreshing)
  const refreshStatus = useApp((s) => s.refreshStatus)
  const refresh = useApp((s) => s.refresh)
  const openDialog = useApp((s) => s.openDialog)
  const undo = useApp((s) => s.undo)
  const undoStack = useApp((s) => s.undoStack)

  // Backlog cards, or done hours waiting there to go where they were worked.
  const somethingToAssign =
    sprint !== null && (sprint.backlog.length > 0 || doneWaiting(sprint).length > 0)
  const first = sprint?.days[0]?.date
  const last = sprint?.days[sprint.days.length - 1]?.date
  const lastChange = undoStack[undoStack.length - 1]?.label

  return (
    <header className="toolbar">
      <span className="title">{sprint?.name ?? 'Sprint Viewer'}</span>
      {sprint && first && last && (
        <span className="subtitle">
          {formatRange(first, last)} · {sprint.days.length} working days
        </span>
      )}
      {isSample && <span className="sample-banner">Sample data</span>}
      {conflicts.length > 0 && (
        <button
          type="button"
          className="warn-pill"
          onClick={onShowPastFit}
          title="Reported hours have nowhere to go before today"
        >
          <WarningIcon size={13} /> {hours(conflicts.reduce((sum, c) => sum + c.missing, 0))} of
          reported work is not shown
        </button>
      )}
      {spillover > 0 && (
        <span className="subtitle" style={{ color: 'var(--danger)' }}>
          · {hours(spillover)} over capacity
        </span>
      )}
      {saveError && (
        <span className="subtitle" style={{ color: 'var(--danger)' }} title={saveError}>
          · not saved
        </span>
      )}
      {refreshStatus && (
        <span
          className="subtitle"
          style={{ color: refreshStatus.ok ? 'var(--text-2)' : 'var(--danger)' }}
          title={refreshStatus.text}
        >
          · {refreshStatus.ok ? refreshStatus.text : 'refresh failed'}
        </span>
      )}
      <span className="spacer" />
      <button
        type="button"
        disabled={lastChange === undefined}
        title={lastChange === undefined ? 'Nothing to undo' : `Undo ${lastChange} (Ctrl+Z)`}
        onClick={undo}
      >
        <UndoIcon /> {lastChange === undefined ? 'Back' : `Undo ${lastChange}`}
      </button>
      <button type="button" onClick={() => openDialog('start-sprint')}>
        Start sprint
      </button>
      <button
        type="button"
        disabled={!sprint?.queryUrl || refreshing}
        title={
          sprint?.queryUrl
            ? 'Re-read remaining hours from TFS and re-flow the sprint'
            : 'Only a sprint imported from TFS can be refreshed'
        }
        onClick={() => void refresh()}
      >
        <RefreshIcon /> {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
      <button
        type="button"
        disabled={!sprint}
        title="Keep a copy of the board as it stands, to compare with later"
        onClick={() => openDialog('snapshots')}
      >
        <CameraIcon /> Snapshot
      </button>
      <button
        type="button"
        disabled={!sprint}
        title="Save a summary of the sprint — plan, actuals and notes — for an AI agent to write up"
        onClick={() => openDialog('summary')}
      >
        <ExportIcon /> Summary
      </button>
      <button
        type="button"
        disabled={!sprint || !somethingToAssign}
        title={
          somethingToAssign
            ? 'Put the backlog on the calendar, by assignee and priority'
            : 'Nothing in the backlog to assign'
        }
        onClick={onAutoAssign}
      >
        <AssignIcon /> Auto-assign
      </button>
      <button
        type="button"
        disabled={!sprint || blocksOnCalendar === 0}
        title={
          blocksOnCalendar === 0
            ? 'The calendar is already empty'
            : 'Send every task back to the backlog'
        }
        onClick={onClear}
      >
        <ClearIcon /> Clear
      </button>
      {sprint && sprint.notes.length > 0 && (
        <button
          type="button"
          title="Export all notes to a Markdown file"
          onClick={() => void window.api?.exportNotes(sprint.id)}
        >
          <ExportIcon /> Notes
        </button>
      )}
      <SprintSwitcher />
      <button type="button" onClick={() => openDialog('settings')} aria-label="Settings">
        <SettingsIcon />
      </button>
    </header>
  )
}

/** Moving between saved sprints — shown only when there is more than one. */
function SprintSwitcher(): JSX.Element | null {
  const sprint = useApp((s) => s.sprint)
  const sprintList = useApp((s) => s.sprintList)
  const switchSprint = useApp((s) => s.switchSprint)
  const [open, setOpen] = useState(false)

  if (sprintList.length <= 1) return null
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" title="Switch to another sprint" onClick={() => setOpen((v) => !v)}>
        Sprints ▾
      </button>
      {open && (
        <div className="sprint-menu" onMouseLeave={() => setOpen(false)}>
          {[...sprintList]
            .sort((a, b) => b.startDate.localeCompare(a.startDate))
            .map((s) => (
              <button
                key={s.id}
                type="button"
                className={cx('sprint-menu-item', s.id === sprint?.id && 'is-active')}
                onClick={() => {
                  setOpen(false)
                  void switchSprint(s.id)
                }}
              >
                <span className="sprint-menu-name">{s.name}</span>
                <span className="sprint-menu-date">{s.startDate}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

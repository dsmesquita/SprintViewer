import { useCallback, useEffect, useMemo, useState } from 'react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { planAutoAssign, valWarnings, type AssignPlan } from '@shared/autoAssign'
import { freePastSpace, pastConflicts } from '@shared/pastFit'
import { formatDayHeader, formatRange } from '@shared/dates'
import { clearCalendarCost, findBlock } from '@shared/mutations'
import { anchorFor, layoutSprint } from '@shared/scheduling'
import type { ISODate, Sprint } from '@shared/types'
import AutoAssignDialog from './components/AutoAssignDialog'
import ContextMenu, { type MenuItem, type MenuState } from './components/ContextMenu'
import CreateTasksDialog from './components/CreateTasksDialog'
import Dialog from './components/Dialog'
import { MismatchDialog, SplitQuestionDialog } from './components/DropDialogs'
import HoursDialog from './components/HoursDialog'
import NoteDialog from './components/NoteDialog'
import RefreshHoursDialog from './components/RefreshHoursDialog'
import SettingsDialog from './components/SettingsDialog'
import SidePanel from './components/SidePanel'
import SnapshotsDialog from './components/SnapshotsDialog'
import SummaryDialog from './components/SummaryDialog'
import HelpDialog from './components/HelpDialog'
import SplitDialog from './components/SplitDialog'
import SprintGrid from './components/SprintGrid'
import StartSprintDialog from './components/StartSprintDialog'
import { cx, hours, toneFor } from './format'
import {
  AssignIcon,
  CameraIcon,
  ClearIcon,
  RefreshIcon,
  SettingsIcon,
  UndoIcon,
  WarningIcon
} from './icons'
// ExportIcon inline - a simple download arrow
const ExportIcon = (): JSX.Element => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)
import { useApp } from './store'
import { useSprintDnd } from './dnd/useSprintDnd'

/**
 * Places where a click does not mean "I am done looking at this task".
 *
 * The block itself, obviously. The side panel, because that is where the task is being read and
 * acted on. A dialog or a menu, because those were opened *about* something and closing that
 * something underneath them would be absurd. And the zoom control, which changes how the
 * calendar is drawn rather than what is being looked at.
 */
const KEEPS_SELECTION = '.seg, .panel, .backdrop, .context-menu, .sprint-menu, .corner-zoom'

/** How far a pointer may travel and still be a click rather than a drag. */
const CLICK_SLOP = 4

export default function App(): JSX.Element {
  const sprint = useApp((s) => s.sprint)
  const isSample = useApp((s) => s.isSample)
  const loading = useApp((s) => s.loading)
  const saveError = useApp((s) => s.saveError)
  const refreshing = useApp((s) => s.refreshing)
  const refreshStatus = useApp((s) => s.refreshStatus)
  const pendingRefresh = useApp((s) => s.pendingRefresh)
  const refresh = useApp((s) => s.refresh)
  const today = useApp((s) => s.today)
  const dialog = useApp((s) => s.dialog)
  const openDialog = useApp((s) => s.openDialog)
  const closeDialog = useApp((s) => s.closeDialog)
  const openSplit = useApp((s) => s.openSplit)
  const openNote = useApp((s) => s.openNote)
  const openHours = useApp((s) => s.openHours)
  const moveBlock = useApp((s) => s.moveBlock)
  const applySprint = useApp((s) => s.applySprint)
  const unpinBlock = useApp((s) => s.unpinBlock)
  const setDayCapacity = useApp((s) => s.setDayCapacity)
  const setMemberCapacity = useApp((s) => s.setMemberCapacity)
  const clearSprint = useApp((s) => s.clearSprint)
  const undo = useApp((s) => s.undo)
  const undoStack = useApp((s) => s.undoStack)
  const init = useApp((s) => s.init)
  const lockDay = useApp((s) => s.lockDay)
  const unlockDay = useApp((s) => s.unlockDay)
  const selectTask = useApp((s) => s.selectTask)
  const clearTask = useApp((s) => s.clearTask)
  const nudge = useApp((s) => s.nudge)
  const selectedWorkItemId = useApp((s) => s.selectedWorkItemId)
  const unpinReported = useApp((s) => s.unpinReported)
  const sprintList = useApp((s) => s.sprintList)
  const switchSprint = useApp((s) => s.switchSprint)
  const [showSprintMenu, setShowSprintMenu] = useState(false)

  const [menu, setMenu] = useState<MenuState | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  // The plan with every rule applied, and — only when that would move work already on the
  // calendar — the same run with the calendar held fixed, so the dialog can offer both.
  const [assignPlan, setAssignPlan] = useState<{
    allow: AssignPlan
    keep: AssignPlan | null
  } | null>(null)
  const [showPastFit, setShowPastFit] = useState(false)
  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // Not while typing: Ctrl+Z in a text box belongs to the text box.
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

  /*
   * Shift + ← / → moves the selected task one working hour, or swaps it with the task beside
   * it. Not while typing, where Shift + arrow selects text, and not while a dialog is open,
   * where the calendar underneath is not what the keyboard is talking to.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (document.querySelector('.backdrop')) return
      if (useApp.getState().selectedBlockId === null) return
      event.preventDefault()
      nudge(event.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nudge])

  /*
   * Clicking away from a task puts the panel back to the backlog.
   *
   * Run in the capture phase, ahead of everything else's `onClick`, so that a click which both
   * deselects *and* means something of its own settles in that order — clicking a person's name
   * clears the task and then opens their panel, rather than the two fighting over the tab.
   */
  useEffect(() => {
    if (selectedWorkItemId === null) return
    let pressedAt: { x: number; y: number } | null = null

    const onPointerDown = (event: PointerEvent): void => {
      pressedAt = { x: event.clientX, y: event.clientY }
    }
    const onClick = (event: MouseEvent): void => {
      const start = pressedAt
      pressedAt = null
      // Dragging a block across the calendar ends in a click on whatever is underneath. That
      // is a move, not a click away from the thing being moved.
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= CLICK_SLOP) {
        return
      }
      if ((event.target as Element | null)?.closest?.(KEEPS_SELECTION)) return
      clearTask()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [selectedWorkItemId, clearTask])

  // The whole grid is derived: queues in, positions out. Nothing about a task's place on the
  // calendar is stored, which is what lets a refresh re-flow everything by changing hours.
  const anchor = useMemo(() => (sprint ? anchorFor(sprint, today) : today), [sprint, today])
  const layouts = useMemo(() => (sprint ? layoutSprint(sprint, anchor) : {}), [sprint, anchor])

  const drag = useSprintDnd({ sprint, layouts, anchor, today })
  const { shownSprint, shownLayouts } = drag

  // VAL tasks left starting before their DEV ends — auto-assign links them once, and a DEV that
  // grows or moves afterwards does not take its VAL along.
  const warnings = useMemo(
    () =>
      shownSprint ? valWarnings(shownSprint, shownLayouts, anchor) : new Map<string, string>(),
    [shownSprint, shownLayouts, anchor]
  )

  // Reported hours that will not fit in the days that have passed. Worth surfacing rather
  // than leaving to be noticed: the calendar is understating what was done until it is fixed.
  const conflicts = useMemo(() => (sprint ? pastConflicts(sprint, anchor) : []), [sprint, anchor])
  const clearCost = sprint ? clearCalendarCost(sprint) : { blocks: 0, recordedDays: 0 }
  const spillover = Object.values(shownLayouts).reduce((sum, layout) => sum + layout.spillover, 0)
  const first = sprint?.days[0]?.date
  const last = sprint?.days[sprint.days.length - 1]?.date

  // Wrapped so the memoised rows and blocks in SprintGrid see the same functions on every hop
  // of a drag. `sprint` itself does not change until the drop, so these stay stable throughout.
  const onDayContextMenu = useCallback(
    (date: ISODate, event: React.MouseEvent, memberId?: string): void => {
      event.preventDefault()
      if (!sprint) return
      setMenu({
        x: event.clientX,
        y: event.clientY,
        label: formatDayHeader(date),
        items: dayMenuItems(sprint, date, memberId, {
          openDialog,
          setDayCapacity,
          setMemberCapacity
        })
      })
    },
    [sprint, openDialog, setDayCapacity, setMemberCapacity]
  )

  const onMemberContextMenu = useCallback(
    (memberId: string, event: React.MouseEvent): void => {
      event.preventDefault()
      if (!sprint) return
      const member = sprint.members.find((m) => m.id === memberId)
      setMenu({
        x: event.clientX,
        y: event.clientY,
        label: member?.name,
        items: [{ label: 'Add note…', onSelect: () => openNote({ memberId }) }]
      })
    },
    [sprint, openNote]
  )

  const onReportedContextMenu = useCallback(
    (workItemId: number, event: React.MouseEvent, label: string): void => {
      event.preventDefault()
      if (!sprint) return
      setMenu({
        x: event.clientX,
        y: event.clientY,
        label,
        items: [
          {
            label: 'Reset to automatic',
            onSelect: () => unpinReported(workItemId),
            disabled: sprint.reportedPins?.[workItemId] === undefined
          },
          { label: 'Add note…', onSelect: () => openNote({ taskId: workItemId }) }
        ]
      })
    },
    [sprint, openNote, unpinReported]
  )

  const openCreateTasks = useApp((s) => s.openCreateTasks)

  const onGroupContextMenu = useCallback(
    (parentId: number, event: React.MouseEvent): void => {
      event.preventDefault()
      if (!sprint) return
      const parent = sprint.workItems[parentId]
      // Writing needs somewhere to write to: a sprint that came from TFS, in the desktop app.
      const unavailable = !sprint.queryUrl
        ? 'Only a sprint imported from TFS'
        : !window.api
          ? 'Only in the desktop app'
          : null
      setMenu({
        x: event.clientX,
        y: event.clientY,
        label: `#${parentId} ${parent?.title ?? ''}`,
        items: [
          {
            label: unavailable ? `Create tasks… (${unavailable})` : 'Create tasks…',
            onSelect: () => openCreateTasks(parentId),
            disabled: unavailable !== null
          }
        ]
      })
    },
    [sprint, openCreateTasks]
  )

  const onBlockContextMenu = useCallback(
    (blockId: string, event: React.MouseEvent, label: string): void => {
      event.preventDefault()
      if (!sprint) return
      setMenu({
        x: event.clientX,
        y: event.clientY,
        label,
        items: [
          {
            label: 'Split…',
            onSelect: () => openSplit(blockId),
            // Nothing to divide when the whole block is a single hour or less.
            disabled: (findBlock(sprint, blockId)?.block.hours ?? 0) <= 1
          },
          {
            label: 'Set hours…',
            onSelect: () => {
              const workItemId = findBlock(sprint, blockId)?.block.workItemId
              if (workItemId !== undefined) openHours(workItemId)
            }
          },
          {
            label: 'Add note…',
            onSelect: () => openNote({ taskId: findBlock(sprint, blockId)?.block.workItemId })
          },
          ...(findBlock(sprint, blockId)?.block.pin
            ? [{ label: 'Unpin — let it flow again', onSelect: () => unpinBlock(blockId) }]
            : []),
          ...(findBlock(sprint, blockId)?.location.kind === 'member'
            ? [
                {
                  label: 'Return to backlog',
                  onSelect: () => moveBlock(blockId, { kind: 'backlog' }, sprint.backlog.length)
                }
              ]
            : [])
        ]
      })
    },
    [sprint, openSplit, openHours, openNote, unpinBlock, moveBlock]
  )

  return (
    <DndContext {...drag.dndProps}>
      <div className="app">
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
              onClick={() => setShowPastFit(true)}
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
            disabled={undoStack.length === 0}
            title={
              undoStack.length === 0
                ? 'Nothing to undo'
                : `Undo ${undoStack[undoStack.length - 1].label} (Ctrl+Z)`
            }
            onClick={undo}
          >
            <UndoIcon />{' '}
            {undoStack.length === 0 ? 'Back' : `Undo ${undoStack[undoStack.length - 1].label}`}
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
            disabled={!sprint || sprint.backlog.length === 0}
            title={
              sprint && sprint.backlog.length > 0
                ? 'Put the backlog on the calendar, by assignee and priority'
                : 'Nothing in the backlog to assign'
            }
            onClick={() => {
              if (!sprint) return
              const newId = (): string => crypto.randomUUID()
              const allow = planAutoAssign(sprint, anchor, { newId })
              const keep =
                allow.baseChanges.length > 0
                  ? planAutoAssign(sprint, anchor, { keepBase: true, newId })
                  : null
              setAssignPlan({ allow, keep })
            }}
          >
            <AssignIcon /> Auto-assign
          </button>
          <button
            type="button"
            disabled={!sprint || clearCost.blocks === 0}
            title={
              clearCost.blocks === 0
                ? 'The calendar is already empty'
                : 'Send every task back to the backlog'
            }
            onClick={() => setConfirmClear(true)}
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
          {sprintList.length > 1 && (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                title="Switch to another sprint"
                onClick={() => setShowSprintMenu((v) => !v)}
              >
                Sprints ▾
              </button>
              {showSprintMenu && (
                <div className="sprint-menu" onMouseLeave={() => setShowSprintMenu(false)}>
                  {[...sprintList]
                    .sort((a, b) => b.startDate.localeCompare(a.startDate))
                    .map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={cx('sprint-menu-item', s.id === sprint?.id && 'is-active')}
                        onClick={() => {
                          setShowSprintMenu(false)
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
          )}
          <button type="button" onClick={() => openDialog('settings')} aria-label="Settings">
            <SettingsIcon />
          </button>
        </header>

        {sprint ? (
          <div className="body">
            <SprintGrid
              layouts={shownLayouts}
              previewBlockId={drag.previewBlockId}
              warnings={warnings}
              anchor={anchor}
              onDayContextMenu={onDayContextMenu}
              onBlockContextMenu={onBlockContextMenu}
              onReportedContextMenu={onReportedContextMenu}
              onMemberContextMenu={onMemberContextMenu}
              onSelectTask={selectTask}
              onLockDay={lockDay}
              onUnlockDay={unlockDay}
            />
            <SidePanel
              layouts={shownLayouts}
              onBlockContextMenu={onBlockContextMenu}
              onGroupContextMenu={onGroupContextMenu}
            />
          </div>
        ) : (
          <EmptyState loading={loading} />
        )}

        {dialog === 'settings' && <SettingsDialog />}
        {dialog === 'start-sprint' && <StartSprintDialog />}
        {dialog === 'split' && sprint && <SplitDialog />}
        {dialog === 'note' && sprint && <NoteDialog />}
        {dialog === 'hours' && sprint && <HoursDialog />}
        {dialog === 'snapshots' && sprint && <SnapshotsDialog />}
        {dialog === 'summary' && sprint && <SummaryDialog />}
        {dialog === 'help' && <HelpDialog onClose={closeDialog} />}
        {dialog === 'create-tasks' && sprint && <CreateTasksDialog />}
        {pendingRefresh && <RefreshHoursDialog />}
        {showPastFit && sprint && (
          <Dialog
            title="Reported hours do not fit"
            onClose={() => setShowPastFit(false)}
            footer={
              <>
                <button type="button" onClick={() => setShowPastFit(false)}>
                  Dismiss
                </button>
                {conflicts.some((c) => c.freeable > 0) && (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      applySprint(
                        freePastSpace(sprint, anchor, () => crypto.randomUUID()),
                        'making room in the past'
                      )
                      setShowPastFit(false)
                    }}
                  >
                    Move them forward
                  </button>
                )}
              </>
            }
          >
            <p style={{ margin: '0 0 10px' }}>
              Work that has hours reported against it in TFS happened on days that have passed, so
              that is where it belongs. These people have tasks holding space back there that
              nothing was reported against.
            </p>
            {conflicts.map((conflict) => (
              <div key={conflict.memberId} className="conflict">
                <div className="conflict-head">
                  <strong>{conflict.memberName}</strong> — {hours(conflict.missing)} of reported
                  work has nowhere to go
                </div>
                {conflict.offenders.length > 0 && (
                  <ul className="left-behind">
                    {conflict.offenders.map((offender) => (
                      <li key={offender.blockId}>
                        <strong>#{offender.workItemId}</strong>{' '}
                        {sprint.workItems[offender.workItemId]?.title ?? ''} —{' '}
                        {hours(offender.excess)}{' '}
                        {offender.justified > 0
                          ? `moves forward, ${hours(offender.justified)} reported stays`
                          : 'moves forward, nothing was reported against it'}
                      </li>
                    ))}
                  </ul>
                )}
                {conflict.impossible && (
                  <p className="conflict-bad">
                    {conflict.freeable > 0
                      ? `That frees ${hours(conflict.freeable)} of the ${hours(
                          conflict.missing
                        )} needed. `
                      : 'Nothing back there can be moved — every hour before today is already accounted for by work that was reported. '}
                    More hours are reported against {conflict.memberName} than the days that have
                    passed can hold, so the rest cannot be drawn wherever things are put. Check the
                    Completed Work on {conflict.memberName}&rsquo;s tasks in TFS.
                  </p>
                )}
              </div>
            ))}
          </Dialog>
        )}
        {assignPlan && sprint && (
          <AutoAssignDialog
            sprint={sprint}
            allow={assignPlan.allow}
            keep={assignPlan.keep}
            onClose={() => setAssignPlan(null)}
            onApply={(plan) => {
              applySprint(plan.sprint, 'auto-assign')
              setAssignPlan(null)
            }}
          />
        )}
        {confirmClear && (
          <Dialog
            title="Clear the sprint?"
            onClose={() => setConfirmClear(false)}
            footer={
              <>
                <button type="button" onClick={() => setConfirmClear(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    clearSprint()
                    setConfirmClear(false)
                  }}
                >
                  Clear sprint
                </button>
              </>
            }
          >
            <p style={{ margin: 0 }}>
              <strong>
                {clearCost.blocks} {clearCost.blocks === 1 ? 'task returns' : 'tasks return'}
              </strong>{' '}
              to the backlog
              {clearCost.recordedDays > 0 && (
                <>
                  , and the recorded work on{' '}
                  <strong>
                    {clearCost.recordedDays} past {clearCost.recordedDays === 1 ? 'day' : 'days'}
                  </strong>{' '}
                  is discarded
                </>
              )}
              . This cannot be undone.
            </p>
            <p className="hint" style={{ marginBottom: 0 }}>
              Parts of a task that were split rejoin as one. Nothing is written to TFS.
            </p>
          </Dialog>
        )}
        {drag.splitQuestion && sprint && (
          <SplitQuestionDialog
            sprint={sprint}
            question={drag.splitQuestion}
            onAnswer={drag.answerSplit}
            onClose={drag.dismissSplit}
          />
        )}
        {drag.mismatch && (
          <MismatchDialog
            mismatch={drag.mismatch}
            onConfirm={drag.confirmMismatch}
            onClose={drag.dismissMismatch}
          />
        )}
        <ContextMenu menu={menu} onClose={() => setMenu(null)} />
      </div>

      <DragOverlay dropAnimation={null}>
        {/*
          Hidden rather than unmounted while the calendar is previewing the drop. Two
          representations of the same block chasing the cursor is worse than one, and the
          preview is the better one — but mounting and unmounting the ghost each time the
          preview came and went made it blink its way across the board.
        */}
        {drag.dragging && (
          <div
            className={cx('seg', 'drag-ghost', toneFor(drag.dragging.workItemId))}
            style={{ opacity: drag.previewing ? 0 : 1 }}
          >
            <span className="seg-id">#{drag.dragging.workItemId}</span>
            <span className="seg-title">{hours(drag.dragging.hours)}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

interface MenuActions {
  openDialog: (dialog: 'start-sprint', seed: ISODate) => void
  setDayCapacity: (date: ISODate, capacity: number, label?: string) => void
  setMemberCapacity: (memberId: string, date: ISODate, capacity: number | null) => void
}

function dayMenuItems(
  sprint: Sprint,
  date: ISODate,
  memberId: string | undefined,
  actions: MenuActions
): MenuItem[] {
  const day = sprint.days.find((d) => d.date === date)
  const member = sprint.members.find((m) => m.id === memberId)
  const half = sprint.hoursPerDay / 2
  const items: MenuItem[] = [
    { label: 'Start sprint here…', onSelect: () => actions.openDialog('start-sprint', date) }
  ]

  if (member) {
    const override = sprint.capacityOverrides[member.id]?.[date]
    items.push(
      {
        label: `Day off for ${member.name}`,
        onSelect: () => actions.setMemberCapacity(member.id, date, 0)
      },
      {
        label: `Half day for ${member.name}`,
        onSelect: () => actions.setMemberCapacity(member.id, date, half)
      }
    )
    if (override !== undefined) {
      items.push({
        label: `Clear ${member.name}'s day`,
        onSelect: () => actions.setMemberCapacity(member.id, date, null)
      })
    }
  }

  items.push(
    (day?.capacity ?? 0) > 0
      ? {
          label: 'Disable day for everyone',
          onSelect: () => actions.setDayCapacity(date, 0, 'Day off')
        }
      : {
          label: 'Enable day for everyone',
          onSelect: () => actions.setDayCapacity(date, sprint.hoursPerDay, undefined)
        },
    {
      label: 'Half day for everyone',
      onSelect: () => actions.setDayCapacity(date, half, 'Half day')
    }
  )
  return items
}

function EmptyState({ loading }: { loading: boolean }): JSX.Element {
  const openDialog = useApp((s) => s.openDialog)
  const loadSample = useApp((s) => s.loadSample)
  const settings = useApp((s) => s.settings)

  if (loading) return <div className="empty-state">Loading…</div>

  const needsSetup = !settings?.hasPat || settings.members.length === 0

  return (
    <div className="empty-state">
      <h1>No sprint yet</h1>
      <p style={{ maxWidth: 460, margin: 0 }}>
        {needsSetup
          ? 'Add your team and a personal access token in Settings, then import a sprint from a TFS query.'
          : 'Import a sprint from a TFS query to fill the calendar.'}
      </p>
      <div className="actions">
        <button type="button" className="primary" onClick={() => openDialog('start-sprint')}>
          Start sprint…
        </button>
        <button type="button" onClick={() => openDialog('settings')}>
          Settings
        </button>
        <button type="button" onClick={loadSample}>
          Load sample data
        </button>
        <button type="button" onClick={() => openDialog('help')}>
          Read me
        </button>
      </div>
    </div>
  )
}

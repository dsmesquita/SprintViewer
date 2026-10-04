import { useEffect, useMemo, useState } from 'react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { planAutoAssign, valWarnings, type AssignPlan } from '@shared/autoAssign'
import { clearCalendarCost } from '@shared/mutations'
import { freePastSpace, pastConflicts } from '@shared/pastFit'
import { anchorFor, layoutSprint } from '@shared/scheduling'
import AutoAssignDialog from './components/AutoAssignDialog'
import CalendarExportDialog from './components/CalendarExportDialog'
import ClearSprintDialog from './components/ClearSprintDialog'
import DoneHoursDialog from './components/DoneHoursDialog'
import ContextMenu from './components/ContextMenu'
import CreateTasksDialog from './components/CreateTasksDialog'
import { MismatchDialog, SplitQuestionDialog } from './components/DropDialogs'
import EmptyState from './components/EmptyState'
import HelpDialog from './components/HelpDialog'
import HoursDialog from './components/HoursDialog'
import NoteDialog from './components/NoteDialog'
import PastFitDialog from './components/PastFitDialog'
import RefreshErrorDialog from './components/RefreshErrorDialog'
import RefreshHoursDialog from './components/RefreshHoursDialog'
import SettingsDialog from './components/SettingsDialog'
import SidePanel from './components/panel/SidePanel'
import SnapshotsDialog from './components/SnapshotsDialog'
import SplitDialog from './components/SplitDialog'
import SprintGrid from './components/SprintGrid'
import StartSprintDialog from './components/StartSprintDialog'
import SummaryDialog from './components/SummaryDialog'
import Toolbar from './components/Toolbar'
import { useSprintDnd } from './dnd/useSprintDnd'
import { cx, hours, toneFor } from './format'
import { useContextMenus } from './menus'
import {
  useClickAwayDeselect,
  useFullScreenShortcut,
  useNudgeShortcut,
  useUndoShortcut
} from './shortcuts'
import { useApp } from './store'

/**
 * The main window: toolbar, calendar and side panel, and every dialog that can open over them.
 *
 * The board is derived here once — queues in, positions out — and handed down. Nothing about a
 * task's place on the calendar is stored, which is what lets a refresh re-flow everything by
 * changing hours.
 */
/** The drag ghost's height, as in `06-dnd.css`. */
const GHOST_HEIGHT = 26

export default function App(): JSX.Element {
  const sprint = useApp((s) => s.sprint)
  const loading = useApp((s) => s.loading)
  const pendingRefresh = useApp((s) => s.pendingRefresh)
  const doneQuestion = useApp((s) => s.doneQuestion)
  const today = useApp((s) => s.today)
  const dialog = useApp((s) => s.dialog)
  const closeDialog = useApp((s) => s.closeDialog)
  const applySprint = useApp((s) => s.applySprint)
  const clearSprint = useApp((s) => s.clearSprint)
  const init = useApp((s) => s.init)
  const lockDay = useApp((s) => s.lockDay)
  const unlockDay = useApp((s) => s.unlockDay)
  const selectTask = useApp((s) => s.selectTask)
  const hourWidth = useApp((s) => s.hourWidth)

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
  useUndoShortcut()
  useNudgeShortcut()
  useFullScreenShortcut()
  const fullScreen = useApp((s) => s.fullScreen)
  // The window says when it enters or leaves full screen, whatever asked it to.
  useEffect(() => window.api?.onFullScreen?.((on) => useApp.setState({ fullScreen: on })), [])
  useClickAwayDeselect()

  const anchor = useMemo(() => (sprint ? anchorFor(sprint, today) : today), [sprint, today])
  const layouts = useMemo(() => (sprint ? layoutSprint(sprint, anchor) : {}), [sprint, anchor])

  const drag = useSprintDnd({ sprint, layouts, anchor, today })
  const { shownSprint, shownLayouts } = drag
  const menus = useContextMenus(sprint)

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

  const planAssign = (): void => {
    if (!sprint) return
    const newId = (): string => crypto.randomUUID()
    const allow = planAutoAssign(sprint, anchor, { newId })
    const keep =
      allow.baseChanges.length > 0
        ? planAutoAssign(sprint, anchor, { keepBase: true, newId })
        : null
    setAssignPlan({ allow, keep })
  }

  return (
    <DndContext {...drag.dndProps}>
      <div className={cx('app', fullScreen && 'is-full-screen')}>
        <Toolbar
          conflicts={conflicts}
          spillover={spillover}
          blocksOnCalendar={clearCost.blocks}
          onShowPastFit={() => setShowPastFit(true)}
          onAutoAssign={planAssign}
          onClear={() => setConfirmClear(true)}
        />

        {sprint ? (
          <div className="body">
            <SprintGrid
              layouts={shownLayouts}
              previewBlockId={drag.previewBlockId}
              warnings={warnings}
              anchor={anchor}
              onDayContextMenu={menus.onDayContextMenu}
              onBlockContextMenu={menus.onBlockContextMenu}
              onReportedContextMenu={menus.onReportedContextMenu}
              onMemberContextMenu={menus.onMemberContextMenu}
              onSelectTask={selectTask}
              onLockDay={lockDay}
              onUnlockDay={unlockDay}
            />
            <SidePanel
              layouts={shownLayouts}
              onBlockContextMenu={menus.onBlockContextMenu}
              onGroupContextMenu={menus.onGroupContextMenu}
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
        {dialog === 'export-calendar' && sprint && <CalendarExportDialog />}
        {dialog === 'refresh-error' && <RefreshErrorDialog />}
        {pendingRefresh && <RefreshHoursDialog />}
        {doneQuestion && sprint && !pendingRefresh && <DoneHoursDialog ids={doneQuestion} />}
        {showPastFit && sprint && (
          <PastFitDialog
            sprint={sprint}
            conflicts={conflicts}
            onClose={() => setShowPastFit(false)}
            onMoveForward={() => {
              applySprint(
                freePastSpace(sprint, anchor, () => crypto.randomUUID()),
                'making room in the past'
              )
              setShowPastFit(false)
            }}
          />
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
          <ClearSprintDialog
            cost={clearCost}
            onClose={() => setConfirmClear(false)}
            onConfirm={() => {
              clearSprint()
              setConfirmClear(false)
            }}
          />
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
        <ContextMenu menu={menus.menu} onClose={menus.closeMenu} />
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
            className={cx(
              'seg',
              'drag-ghost',
              toneFor(drag.dragging.workItemId),
              drag.refused && 'is-refused'
            )}
            // As long as the task is, at the calendar's scale — not as wide as the backlog card
            // it may have been picked up from, which hid a dozen hours under the pointer.
            style={{
              opacity: drag.previewing ? 0 : 1,
              width: Math.max(drag.dragging.hours * hourWidth - 2, 24),
              // Level with the pointer: a card is taller than a block, and was picked up by
              // wherever the pointer went down on it.
              marginTop: Math.max(0, drag.grabbedDown - GHOST_HEIGHT / 2)
            }}
          >
            <span className="seg-id">#{drag.dragging.workItemId}</span>
            <span className="seg-title">{hours(drag.dragging.hours)}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

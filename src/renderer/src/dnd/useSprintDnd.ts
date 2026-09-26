import { useMemo, useState } from 'react'
import {
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DndContextProps,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent
} from '@dnd-kit/core'
import { checkAssignment, type AssignmentMismatch } from '@shared/assignment'
import {
  applyDrop,
  questionFor,
  slotAt,
  type DropChoice,
  type DropContext,
  type DropTarget
} from '@shared/drop'
import { layoutSprint, type MemberLayout, type Occupant } from '@shared/scheduling'
import type { ISODate, Sprint } from '@shared/types'
import { BACKLOG_DROP_ID, MEMBER_DROP_PREFIX, type DragData } from '../grid'
import { useApp } from '../store'

/**
 * What is being dragged, as the id the grid draws it under.
 *
 * Reported hours have no block, so the layout gives their segments a synthetic `done:<id>`
 * blockId — matching it here is what lets the preview outline them like anything else.
 */
export function keyOf(data: DragData): string {
  return data.kind === 'block' ? data.blockId : `done:${data.workItemId}`
}

/** A drop that landed inside another task, waiting to be told how to make room. */
export interface SplitQuestion {
  data: DragData
  target: DropTarget
  occupant: Occupant
}

interface Board {
  sprint: Sprint | null
  layouts: Record<string, MemberLayout>
  anchor: ISODate
  today: ISODate
}

/**
 * Dragging tasks around the calendar: the sensors, the live preview of where a drag would land,
 * and the drop itself — including the two questions a drop can raise before it is made.
 *
 * The store is untouched until the drop. While dragging, `shownSprint` and `shownLayouts` are
 * the board as it would be if the drag ended now; the grid and the panel draw those.
 */
export function useSprintDnd({ sprint, layouts, anchor, today }: Board) {
  const hourWidth = useApp((s) => s.hourWidth)
  const moveBlock = useApp((s) => s.moveBlock)
  const unpinReported = useApp((s) => s.unpinReported)
  const applySprint = useApp((s) => s.applySprint)

  const [dragging, setDragging] = useState<DragData | null>(null)
  // Where the block being dragged would land. Held as a slot rather than as pixels, so the
  // preview is recomputed only when the cursor crosses into a new hour.
  const [preview, setPreview] = useState<{ data: DragData; target: DropTarget } | null>(null)
  const [splitQuestion, setSplitQuestion] = useState<SplitQuestion | null>(null)
  // A drop that contradicts TFS waits here for an answer. The placement is held as the
  // closure that would have run, so confirming does exactly what the drop would have done.
  const [mismatch, setMismatch] = useState<{
    mismatch: AssignmentMismatch
    place: () => void
  } | null>(null)

  // A few pixels of movement before a drag starts, so clicking and right-clicking a task
  // still work normally.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const context: DropContext = useMemo(
    () => ({ layouts, anchor, today, newId: () => crypto.randomUUID() }),
    [layouts, anchor, today]
  )

  // The sprint as it would be if the drag ended now.
  const shownSprint = useMemo(() => {
    if (!sprint || !preview) return sprint
    // Where the drop lands inside another task the preview shows it parted, which is both the
    // literal reading of the gesture and the choice the dialog offers first.
    const choice = questionFor(sprint, preview.data, preview.target, context) ? 'split' : 'auto'
    return applyDrop(sprint, preview.data, preview.target, context, choice)
  }, [sprint, preview, context])
  const shownLayouts = useMemo(
    () => (shownSprint === sprint ? layouts : shownSprint ? layoutSprint(shownSprint, anchor) : {}),
    [shownSprint, sprint, layouts, anchor]
  )

  /** Which member, day and hour the pointer is currently over, if it is over the calendar. */
  const targetFor = (event: DragMoveEvent | DragEndEvent): DropTarget | null => {
    const { over } = event
    if (!sprint || !over || typeof over.id !== 'string') return null
    if (!over.id.startsWith(MEMBER_DROP_PREFIX)) return null

    const memberId = over.id.slice(MEMBER_DROP_PREFIX.length)
    if (!layouts[memberId]) return null

    // Where the pointer finished, not where the dragged block's left edge is — the user
    // grabbed the block somewhere in its middle and expects the drop to follow the cursor.
    const pointer = (event.activatorEvent as MouseEvent | undefined)?.clientX
    const x =
      pointer === undefined
        ? (event.active.rect.current.translated?.left ?? over.rect.left) - over.rect.left
        : pointer + event.delta.x - over.rect.left
    return slotAt(sprint, memberId, x, hourWidth)
  }

  const onDragStart = (event: DragStartEvent): void =>
    setDragging((event.active.data.current as DragData | undefined) ?? null)

  /**
   * Also wired to `onDragOver`, which fires the moment the row under the cursor changes.
   * `onDragMove` alone reports the previous drop target on the event where it changes, so
   * the preview would trail the cursor by one movement — invisible with a real mouse, but
   * wrong for someone who stops moving and releases straight away.
   */
  const onDragMove = (event: DragMoveEvent): void => {
    const data = event.active.data.current as DragData | undefined
    const target = data ? targetFor(event) : null

    // A preview survives `over` going momentarily null. Applying one re-renders the grid,
    // which makes dnd-kit re-measure its drop targets, and for that tick nothing is under the
    // cursor — clearing the preview then would put the block back, bring the target back, and
    // set the preview again, flickering for the whole drag. Only an explicit move to the
    // backlog takes the preview down.
    if (!target && event.over?.id !== BACKLOG_DROP_ID) return

    setPreview((current) => {
      if (!target || !data) return current === null ? current : null
      if (
        current &&
        keyOf(current.data) === keyOf(data) &&
        current.target.memberId === target.memberId &&
        current.target.date === target.date &&
        current.target.hour === target.hour
      ) {
        return current
      }
      return { data, target }
    })
  }

  const onDragEnd = (event: DragEndEvent): void => {
    setDragging(null)
    setPreview(null)
    const data = event.active.data.current as DragData | undefined
    if (!data || !sprint) return

    if (event.over?.id === BACKLOG_DROP_ID) {
      // Reported hours cannot be unscheduled — they happened. Dropping them here is read as
      // "I no longer want to say when", which hands them back to the automatic placement.
      if (data.kind === 'reported') unpinReported(data.workItemId)
      else moveBlock(data.blockId, { kind: 'backlog' }, sprint.backlog.length)
      return
    }

    // The cursor's own answer, falling back to the previewed one. Both are needed: dnd-kit
    // can report no drop target on the tick after a re-render, which would swallow the drop
    // entirely, while the preview can be a moment behind if the pointer stopped before the
    // release. With a real mouse the two agree, and the preview is then literally what lands.
    const previewed = preview && keyOf(preview.data) === keyOf(data) ? preview.target : null
    const target = targetFor(event) ?? previewed
    if (!target) return

    const place = (): void => {
      const occupant = questionFor(sprint, data, target, context)
      if (occupant) setSplitQuestion({ data, target, occupant })
      else applySprint(applyDrop(sprint, data, target, context), 'move')
    }

    // TFS may already say who owns this. Disagreeing with it is allowed — plans change
    // before the work item does — but it is worth asking, because the usual cause is a drop
    // on the wrong row.
    const found = checkAssignment(sprint, data.workItemId, target.memberId)
    if (found) setMismatch({ mismatch: found, place })
    else place()
  }

  const dndProps: DndContextProps = {
    sensors,
    collisionDetection: pointerWithin,
    /*
     * Drop targets are re-measured whenever the DOM changes, not just at drag start.
     * Showing a live preview re-renders the grid mid-drag, and with the default strategy
     * (`WhileDragging`) dnd-kit keeps its original measurements — so after the first preview
     * it no longer knows which row the cursor is over, and the drag sticks to wherever it
     * began. The cost of re-measuring is bounded by dnd-kit's default `Optimized` frequency,
     * which coalesces to one measurement per frame; keeping the mutations themselves down is
     * the job of the memoised rows and blocks in SprintGrid.
     */
    measuring: { droppable: { strategy: MeasuringStrategy.Always } },
    onDragStart,
    onDragMove,
    onDragOver: onDragMove,
    onDragEnd,
    onDragCancel: () => {
      setDragging(null)
      setPreview(null)
    }
  }

  return {
    dndProps,
    /** What is being dragged, for the ghost under the cursor. */
    dragging,
    /** True while the grid is showing where the drag would land. */
    previewing: preview !== null,
    previewBlockId: preview ? keyOf(preview.data) : undefined,
    shownSprint,
    shownLayouts,
    /** "It landed inside another task": how to make room. */
    splitQuestion,
    answerSplit: (choice: Exclude<DropChoice, 'auto'>): void => {
      if (sprint && splitQuestion) {
        applySprint(
          applyDrop(sprint, splitQuestion.data, splitQuestion.target, context, choice),
          choice === 'split' ? 'split and move' : 'move'
        )
      }
      setSplitQuestion(null)
    },
    dismissSplit: () => setSplitQuestion(null),
    /** "TFS says this belongs to someone else": put it there anyway? */
    mismatch: mismatch?.mismatch ?? null,
    confirmMismatch: (): void => {
      mismatch?.place()
      setMismatch(null)
    },
    dismissMismatch: () => setMismatch(null)
  }
}

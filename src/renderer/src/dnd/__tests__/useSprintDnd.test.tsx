import { useMemo } from 'react'
import { act, renderHook } from '@testing-library/react'
import type { DragEndEvent, DragMoveEvent, DragStartEvent } from '@dnd-kit/core'
import { beforeEach, describe, expect, it } from 'vitest'
import { findBlock } from '@shared/blocks'
import { applyDrop, type DropTarget } from '@shared/drop'
import { lockDay } from '@shared/mutations'
import { layoutSprint } from '@shared/scheduling'
import type { Sprint } from '@shared/types'
import { BACKLOG_DROP_ID, MEMBER_DROP_PREFIX, type DragData } from '../../grid'
import { useApp } from '../../store'
import { useSprintDnd } from '../useSprintDnd'
import { installFakeApi } from '../../../../../test/fakeApi'
import { block, drawn, FRI, item, MON, sprint, THU, WED } from '../../../../../test/fixtures'

/**
 * The drag state machine between dnd-kit and `applyDrop`: the live preview, the fallbacks
 * when dnd-kit loses the drop target for a tick, and the two questions a drop can ask.
 *
 * jsdom has no layout, so dnd-kit is not driven here. Its handlers are called with the events it
 * would send; real pointer drags are covered by the Electron end-to-end tests.
 */

// Today is Wednesday. Diogo has a 16h task A from today (Wednesday and Thursday), then a 2h
// task B on Friday morning; C, assigned to Diogo in TFS, waits in the backlog.
const board = (): Sprint =>
  sprint({
    items: [
      item(1, { remainingWork: 16, assignedTo: 'Diogo Mesquita' }),
      item(2, { remainingWork: 2 }),
      item(3, { remainingWork: 3, completedWork: 2, assignedTo: 'Diogo Mesquita' })
    ],
    queues: { diogo: [block('a', 1, 16), block('b', 2, 2)] },
    backlog: [block('c', 3, 3)]
  })

// Ten pixels an hour: a day is 80px wide, and the row's track starts at x = 100.
const HOUR_W = 10
const TRACK_LEFT = 100
const DAYS = [MON, '2026-09-15', WED, THU, FRI]
const xOf = (date: string, hour: number) => DAYS.indexOf(date) * 80 + hour * HOUR_W + 5

const a: DragData = { kind: 'block', blockId: 'a', workItemId: 1, hours: 16 }
const c: DragData = { kind: 'block', blockId: 'c', workItemId: 3, hours: 3 }
const reported: DragData = { kind: 'reported', workItemId: 3, hours: 2 }

type Over = { memberId: string } | 'backlog' | null

/**
 * The event dnd-kit sends while dragging `data`, with the pointer `x` pixels into the track.
 * The pointer went down `pressedAt` pixels into the track, so `delta.x` is the difference.
 */
function event(data: DragData, over: Over, x: number, grabbed = true, pressedAt = 0) {
  const overId =
    over === null ? null : over === 'backlog' ? BACKLOG_DROP_ID : MEMBER_DROP_PREFIX + over.memberId
  return {
    active: {
      id: 'drag',
      data: { current: data },
      rect: { current: { translated: { left: TRACK_LEFT + x } } }
    },
    over: overId === null ? null : { id: overId, rect: { left: TRACK_LEFT } },
    activatorEvent: grabbed ? { clientX: TRACK_LEFT + pressedAt } : undefined,
    delta: { x: x - pressedAt, y: 0 }
  } as unknown as DragMoveEvent & DragEndEvent
}

function render() {
  return renderHook(() => {
    const current = useApp((s) => s.sprint)
    const layouts = useMemo(() => (current ? layoutSprint(current, WED) : {}), [current])
    return useSprintDnd({ sprint: current, layouts, anchor: WED, today: WED })
  })
}

type Hook = ReturnType<typeof render>['result']

/**
 * Starts a drag. A backlog card is picked up with nothing known about it on the calendar; a
 * piece of the calendar starts at `pieceAt` and is pressed `pressedAt` pixels into the track.
 */
const start = (hook: Hook, data: DragData, pressedAt = 0, pieceAt?: number) =>
  act(() =>
    hook.current.dndProps.onDragStart!({
      active: {
        data: { current: data },
        rect: {
          current: { initial: pieceAt === undefined ? null : { left: TRACK_LEFT + pieceAt } }
        }
      },
      activatorEvent: { clientX: TRACK_LEFT + pressedAt }
    } as unknown as DragStartEvent)
  )
const move = (hook: Hook, data: DragData, over: Over, x: number, pressedAt = 0) =>
  act(() => hook.current.dndProps.onDragMove!(event(data, over, x, true, pressedAt)))
const end = (hook: Hook, data: DragData, over: Over, x: number, pressedAt = 0) =>
  act(() => hook.current.dndProps.onDragEnd!(event(data, over, x, true, pressedAt)))

const stored = () => useApp.getState().sprint!
const queue = (memberId = 'diogo') => stored().queues[memberId].map((b) => b.id)
const labels = () => useApp.getState().undoStack.map((u) => u.label)
const context = (s: Sprint) => ({ layouts: layoutSprint(s, WED), anchor: WED, today: WED })
const pinOf = (s: Sprint | null, id: string) => (s ? findBlock(s, id)?.block.pin : undefined)

const initial = useApp.getState()

beforeEach(() => {
  installFakeApi()
  useApp.setState(
    { ...initial, sprint: board(), loading: false, today: WED, hourWidth: HOUR_W },
    true
  )
})

describe('the preview while dragging', () => {
  it('shows the board as the drop would leave it, without touching the store', () => {
    const { result } = render()
    start(result, c)
    expect(result.current.dragging).toEqual(c)
    move(result, c, { memberId: 'diogo' }, xOf(FRI, 5))

    const target: DropTarget = { memberId: 'diogo', date: FRI, hour: 5 }
    expect(result.current.previewing).toBe(true)
    expect(result.current.previewBlockId).toBe('c')
    expect(result.current.shownSprint).toEqual(applyDrop(board(), c, target, context(board())))
    expect(result.current.shownLayouts).toEqual(layoutSprint(result.current.shownSprint!, WED))
    expect(stored()).toEqual(board())
  })

  it('inside another task, shows it parted around the dragged one', () => {
    const { result } = render()
    start(result, c)
    // Thursday hour 3 is 11 hours into A.
    move(result, c, { memberId: 'diogo' }, xOf(THU, 3))
    expect(pinOf(result.current.shownSprint, 'c')).toEqual({ date: THU, startHour: 3 })
    expect(drawn(result.current.shownSprint!, WED, 'diogo', 'a')).toEqual([
      '09-16@0+8',
      '09-17@0+3',
      '09-17@6+2',
      '09-18@0+3'
    ])
    expect(queue()).toEqual(['a', 'b'])
  })

  it('over a slot the task may not go on, shows nothing and says so', () => {
    const { result } = render()
    start(result, c)
    move(result, c, { memberId: 'diogo' }, xOf(FRI, 5))
    expect(result.current.refused).toBe(false)
    // Tuesday has passed: work still to do cannot go there.
    move(result, c, { memberId: 'diogo' }, xOf('2026-09-15', 2))
    expect(result.current.previewing).toBe(false)
    expect(result.current.refused).toBe(true)
    expect(result.current.previewBlockId).toBeUndefined()
    expect(result.current.shownSprint).toBe(stored())
    // Back onto an allowed slot, the preview returns.
    move(result, c, { memberId: 'diogo' }, xOf(FRI, 5))
    expect(result.current.previewing).toBe(true)
    expect(result.current.refused).toBe(false)
  })

  it('is kept while the pointer stays in the same hour, and replaced in the next one', () => {
    const { result } = render()
    start(result, c)
    move(result, c, { memberId: 'diogo' }, xOf(FRI, 5))
    const first = result.current.shownSprint
    move(result, c, { memberId: 'diogo' }, xOf(FRI, 5) + 3)
    expect(result.current.shownSprint).toBe(first)
    move(result, c, { memberId: 'diogo' }, xOf(FRI, 6))
    expect(result.current.shownSprint).not.toBe(first)
  })

  it('survives dnd-kit losing the drop target for a tick; only the backlog takes it down', () => {
    const { result } = render()
    start(result, c)
    move(result, c, { memberId: 'diogo' }, xOf(FRI, 5))
    move(result, c, null, xOf(FRI, 5))
    expect(result.current.previewing).toBe(true)
    move(result, c, 'backlog', 0)
    expect(result.current.previewing).toBe(false)
    expect(result.current.shownSprint).toBe(stored())
  })

  it('follows the pointer, not the left edge of the block being dragged', () => {
    const { result } = render()
    start(result, c)
    // Grabbed 2 hours into the block: the pointer is on Friday hour 2, just after B, while the
    // block's left edge is on Friday hour 0, which would mean "in front of B".
    const grabbedMiddle = {
      ...event(c, { memberId: 'diogo' }, xOf(FRI, 2)),
      active: {
        id: 'drag',
        data: { current: c },
        rect: { current: { translated: { left: TRACK_LEFT + xOf(FRI, 0) } } }
      }
    } as unknown as DragMoveEvent
    act(() => result.current.dndProps.onDragMove!(grabbedMiddle))
    expect(pinOf(result.current.shownSprint, 'c')).toEqual({ date: FRI, startHour: 2 })

    // With no pointer event to go by (a keyboard drag), the block's edge is all there is:
    // Friday hour 0 puts C in front of B.
    act(() =>
      result.current.dndProps.onDragMove!({
        ...event(c, { memberId: 'diogo' }, xOf(FRI, 0), false),
        activatorEvent: undefined
      } as unknown as DragMoveEvent)
    )
    expect(pinOf(result.current.shownSprint, 'c')).toEqual({ date: FRI, startHour: 0 })
  })

  it('ignores rows that are not on the board', () => {
    const { result } = render()
    start(result, c)
    move(result, c, { memberId: 'ghost' }, xOf(FRI, 5))
    expect(result.current.previewing).toBe(false)
  })

  it('is cleared, with nothing changed, when the drag is cancelled', () => {
    const { result } = render()
    start(result, c)
    move(result, c, { memberId: 'diogo' }, xOf(FRI, 5))
    act(() => result.current.dndProps.onDragCancel!({} as never))
    expect(result.current.dragging).toBeNull()
    expect(result.current.previewing).toBe(false)
    expect(stored()).toEqual(board())
    expect(labels()).toEqual([])
  })
})

describe('a task on the calendar is held where it was picked up', () => {
  // The left edge of an hour on the track, where a piece drawn from that hour starts.
  const edgeOf = (date: string, hour: number) => xOf(date, hour) - 5

  it('picked up by its second hour and moved one cell on, it moves one hour', () => {
    const { result } = render()
    // B runs Friday 0–2; pressed on its second hour.
    const b: DragData = { kind: 'block', blockId: 'b', workItemId: 2, hours: 2, hoursBefore: 0 }
    const pressed = xOf(FRI, 1)
    start(result, b, pressed, edgeOf(FRI, 0))
    move(result, b, { memberId: 'diogo' }, xOf(FRI, 2), pressed)
    end(result, b, { memberId: 'diogo' }, xOf(FRI, 2), pressed)
    expect(pinOf(stored(), 'b')).toEqual({ date: FRI, startHour: 1 })
  })

  it('picked up by the part on its second day and moved a day on, it moves a day', () => {
    const { result } = render()
    // A runs all of Wednesday and Thursday; pressed on Thursday's hour 2, ten hours in.
    const thursdayPiece: DragData = { ...a, hours: 8, hoursBefore: 8 }
    const pressed = xOf(THU, 2)
    start(result, thursdayPiece, pressed, edgeOf(THU, 0))
    move(result, thursdayPiece, { memberId: 'diogo' }, xOf(FRI, 2), pressed)
    end(result, thursdayPiece, { memberId: 'diogo' }, xOf(FRI, 2), pressed)
    expect(pinOf(stored(), 'a')).toEqual({ date: THU, startHour: 0 })
  })

  it('left where it is, it stays: the preview shows it on its own hours', () => {
    const { result } = render()
    const b: DragData = { kind: 'block', blockId: 'b', workItemId: 2, hours: 2, hoursBefore: 0 }
    const pressed = xOf(FRI, 1)
    start(result, b, pressed, edgeOf(FRI, 0))
    move(result, b, { memberId: 'diogo' }, pressed, pressed)
    expect(drawn(result.current.shownSprint!, WED, 'diogo', 'b')).toEqual(['09-18@0+2'])
  })

  it('a backlog card lands where the pointer is, having nothing ahead of it', () => {
    const { result } = render()
    start(result, c, 40)
    move(result, c, { memberId: 'diogo' }, xOf(FRI, 5), 40)
    expect(pinOf(result.current.shownSprint, 'c')).toEqual({ date: FRI, startHour: 5 })
  })
})

describe('the drop', () => {
  it('lands where the pointer is, as one undoable step', () => {
    const { result } = render()
    start(result, c)
    move(result, c, { memberId: 'diogo' }, xOf(FRI, 5))
    end(result, c, { memberId: 'diogo' }, xOf(FRI, 5))
    expect(pinOf(stored(), 'c')).toEqual({ date: FRI, startHour: 5 })
    expect(stored().backlog).toEqual([])
    expect(labels()).toEqual(['move'])
    expect(result.current.dragging).toBeNull()
    expect(result.current.previewing).toBe(false)

    act(() => useApp.getState().undo())
    expect(stored()).toEqual(board())
  })

  it('falls back to the preview when dnd-kit reports no target on release', () => {
    const { result } = render()
    start(result, c)
    move(result, c, { memberId: 'diogo' }, xOf(FRI, 5))
    end(result, c, null, xOf(FRI, 5))
    expect(pinOf(stored(), 'c')).toEqual({ date: FRI, startHour: 5 })
  })

  it('on a slot it may not go on, nothing happens — and nothing is asked', () => {
    const { result } = render()
    // A belongs to Diogo in TFS; Sofia's Tuesday has passed. Refused before any question
    // about whose task it is.
    start(result, a)
    end(result, a, { memberId: 'sofia' }, xOf('2026-09-15', 2))
    expect(result.current.mismatch).toBeNull()
    expect(result.current.splitQuestion).toBeNull()
    expect(stored()).toEqual(board())
    expect(labels()).toEqual([])
  })

  it('does not use a preview left from dragging something else', () => {
    const { result } = render()
    start(result, c)
    move(result, c, { memberId: 'diogo' }, xOf(FRI, 5))
    end(result, a, null, xOf(FRI, 5))
    expect(stored()).toEqual(board())
    expect(labels()).toEqual([])
  })

  it('on the backlog: a block goes to its end; reported hours go back to automatic placement', () => {
    const { result } = render()
    start(result, a)
    end(result, a, 'backlog', 0)
    expect(stored().backlog.map((b) => b.id)).toEqual(['c', 'a'])
    expect(queue()).toEqual(['b'])

    const pinned = applyDrop(
      board(),
      reported,
      { memberId: 'diogo', date: MON, hour: 2 },
      context(board())
    )
    act(() => useApp.setState({ sprint: pinned, undoStack: [] }))
    start(result, reported)
    end(result, reported, 'backlog', 0)
    expect(stored().reportedPins?.[3]).toBeUndefined()
    expect(labels()).toEqual(['reported hours'])
  })

  it('a task on a locked day stays: not even the backlog takes it', () => {
    const locked = lockDay(board(), THU, WED, () => 'thu')
    act(() => useApp.setState({ sprint: locked }))
    const { result } = render()
    const thursdayPart: DragData = { kind: 'block', blockId: 'thu', workItemId: 1, hours: 8 }
    start(result, thursdayPart)
    end(result, thursdayPart, 'backlog', 0)
    expect(stored()).toEqual(locked)
    expect(labels()).toEqual([])
  })

  it('reported hours dropped before today are pinned where they were really worked', () => {
    const { result } = render()
    start(result, reported)
    end(result, reported, { memberId: 'diogo' }, xOf(MON, 2))
    expect(stored().reportedPins?.[3]).toEqual({ memberId: 'diogo', date: MON, startHour: 2 })
  })

  it('reported hours go on today, but never on a later day', () => {
    const { result } = render()
    start(result, reported)
    end(result, reported, { memberId: 'diogo' }, xOf(THU, 2))
    expect(stored().reportedPins?.[3]).toBeUndefined()
    start(result, reported)
    end(result, reported, { memberId: 'diogo' }, xOf(WED, 2))
    expect(stored().reportedPins?.[3]).toEqual({ memberId: 'diogo', date: WED, startHour: 2 })
  })
})

describe('a drop inside another task', () => {
  const dropInsideA = (result: Hook) => {
    start(result, c)
    move(result, c, { memberId: 'diogo' }, xOf(THU, 3))
    end(result, c, { memberId: 'diogo' }, xOf(THU, 3))
  }

  it('asks how to make room before changing anything', () => {
    const { result } = render()
    dropInsideA(result)
    expect(result.current.splitQuestion).toMatchObject({
      data: c,
      target: { memberId: 'diogo', date: THU, hour: 3 },
      occupant: { blockId: 'a', offset: 11 }
    })
    expect(stored()).toEqual(board())
  })

  it('split: the task parts around the dropped one', () => {
    const { result } = render()
    dropInsideA(result)
    act(() => result.current.answerSplit('split'))
    expect(pinOf(stored(), 'c')).toEqual({ date: THU, startHour: 3 })
    expect(drawn(stored(), WED, 'diogo', 'a')).toEqual([
      '09-16@0+8',
      '09-17@0+3',
      '09-17@6+2',
      '09-18@0+3'
    ])
    expect(labels()).toEqual(['split and move'])
    expect(result.current.splitQuestion).toBeNull()
  })

  it('before or after: the task stays whole', () => {
    const { result } = render()
    dropInsideA(result)
    act(() => result.current.answerSplit('before'))
    expect(pinOf(stored(), 'c')).toEqual({ date: WED, startHour: 0 })
    expect(drawn(stored(), WED, 'diogo', 'a')).toEqual(['09-16@3+5', '09-17@0+8', '09-18@0+3'])
    expect(labels()).toEqual(['move'])

    act(() => useApp.getState().undo())
    dropInsideA(result)
    act(() => result.current.answerSplit('after'))
    expect(pinOf(stored(), 'c')).toEqual({ date: FRI, startHour: 0 })
    expect(drawn(stored(), WED, 'diogo', 'a')).toEqual(['09-16@0+8', '09-17@0+8'])
  })

  it('dismissed: nothing happens', () => {
    const { result } = render()
    dropInsideA(result)
    act(() => result.current.dismissSplit())
    expect(result.current.splitQuestion).toBeNull()
    expect(stored()).toEqual(board())
  })
})

describe('a drop on the row of someone TFS does not assign it to', () => {
  const dropAOnSofia = (result: Hook) => {
    start(result, a)
    end(result, a, { memberId: 'sofia' }, xOf(FRI, 0))
  }

  it('asks first, naming both people', () => {
    const { result } = render()
    dropAOnSofia(result)
    expect(result.current.mismatch).toEqual({
      assignee: 'Diogo Mesquita',
      memberName: 'Sofia',
      workItemId: 1
    })
    expect(stored()).toEqual(board())
  })

  it('confirmed: does exactly what the drop would have done', () => {
    const { result } = render()
    dropAOnSofia(result)
    act(() => result.current.confirmMismatch())
    expect(stored()).toEqual(
      applyDrop(board(), a, { memberId: 'sofia', date: FRI, hour: 0 }, context(board()))
    )
    expect(queue('sofia')).toEqual(['a'])
    expect(labels()).toEqual(['move'])
    expect(result.current.mismatch).toBeNull()
  })

  it('dismissed: nothing happens', () => {
    const { result } = render()
    dropAOnSofia(result)
    act(() => result.current.dismissMismatch())
    expect(result.current.mismatch).toBeNull()
    expect(stored()).toEqual(board())
  })

  it('confirmed onto a task on that row: then asks how to make room', () => {
    const { result } = render()
    act(() =>
      useApp.setState({
        sprint: { ...board(), queues: { ...board().queues, sofia: [block('s', 2, 16)] } }
      })
    )
    start(result, a)
    end(result, a, { memberId: 'sofia' }, xOf(THU, 3))
    act(() => result.current.confirmMismatch())
    expect(result.current.splitQuestion).toMatchObject({ occupant: { blockId: 's' } })
  })

  it('never for a drop on the row TFS names', () => {
    const { result } = render()
    start(result, c)
    end(result, c, { memberId: 'diogo' }, xOf(FRI, 5))
    expect(result.current.mismatch).toBeNull()
  })
})

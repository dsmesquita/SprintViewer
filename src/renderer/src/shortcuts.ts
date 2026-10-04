import { useEffect } from 'react'
import { useApp } from './store'

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

/** Ctrl+Z undoes the last change to the board — except while typing, where it is the text's. */
export function useUndoShortcut(): void {
  const undo = useApp((s) => s.undo)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
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
}

/**
 * Esc leaves full screen — unless a dialog or a menu is open, which Esc closes first. In the
 * desktop app F11 is the window's own (see main); in a browser it toggles the calendar view.
 */
export function useFullScreenShortcut(): void {
  const setFullScreen = useApp((s) => s.setFullScreen)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const { fullScreen } = useApp.getState()
      if (event.key === 'F11' && !window.api?.setFullScreen) {
        event.preventDefault()
        setFullScreen(!fullScreen)
        return
      }
      if (event.key !== 'Escape' || !fullScreen) return
      if (document.querySelector('.backdrop, .context-menu')) return
      setFullScreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setFullScreen])
}

/**
 * Shift + ← / → moves the selected task one working hour, or swaps it with the task beside
 * it. Not while typing, where Shift + arrow selects text, and not while a dialog is open,
 * where the calendar underneath is not what the keyboard is talking to.
 */
export function useNudgeShortcut(): void {
  const nudge = useApp((s) => s.nudge)
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
}

/**
 * Clicking away from a task puts the panel back to the backlog.
 *
 * Run in the capture phase, ahead of everything else's `onClick`, so that a click which both
 * deselects *and* means something of its own settles in that order — clicking a person's name
 * clears the task and then opens their panel, rather than the two fighting over the tab.
 */
export function useClickAwayDeselect(): void {
  const selectedWorkItemId = useApp((s) => s.selectedWorkItemId)
  const clearTask = useApp((s) => s.clearTask)
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
}

/** Geometry shared by the grid and the drop calculations. */

/**
 * Width of one hour column at 100%, in px. Mirrored into `--hour-w` so the CSS gridlines line
 * up with the absolutely-positioned blocks drawn over them.
 */
export const DEFAULT_HOUR_W = 34

/**
 * The zoom stops, as hour widths.
 *
 * Whole pixels only, and the width itself is the state rather than a percentage multiplied by
 * 34 on the way out. A fractional width would be rounded twice — once by the header's flex
 * cells and once by the `left`/`width` of every block — and the two roundings disagree further
 * and further to the right, which is exactly the drift the hour columns were rewritten to fix.
 */
export const HOUR_W_STEPS = [14, 17, 20, 24, 27, 31, 34, 41, 48, 54, 61, 68, 78, 88]

/** The zoom, as the percentage the corner control shows. */
export function zoomPercent(hourWidth: number): number {
  return Math.round((hourWidth / DEFAULT_HOUR_W) * 100)
}

/** The nearest zoom stop `steps` away from `hourWidth`. */
export function stepZoom(hourWidth: number, steps: number): number {
  const nearest = HOUR_W_STEPS.reduce((best, width, index) =>
    Math.abs(width - hourWidth) < Math.abs(HOUR_W_STEPS[best] - hourWidth) ? index : best, 0)
  return HOUR_W_STEPS[Math.min(Math.max(nearest + steps, 0), HOUR_W_STEPS.length - 1)]
}

export const DRAG_ID_PREFIX = 'block:'
export const MEMBER_DROP_PREFIX = 'member:'
export const BACKLOG_DROP_ID = 'backlog'

/**
 * What is being dragged.
 *
 * Two things can be: a block, which is a chunk of a work item's remaining hours and lives in
 * somebody's queue, and the ribbon of hours TFS already reports against a work item, which is
 * derived from a field and has no block behind it at all. They move for different reasons and
 * land in different places, so the drop has to be able to tell them apart.
 */
export type DragData =
  | { kind: 'block'; blockId: string; workItemId: number; hours: number }
  | { kind: 'reported'; workItemId: number; hours: number }

/**
 * Arithmetic on hours.
 *
 * Hours are fractional (2.5h, 0.25h) and are added and subtracted over and over as a task is
 * split, resized and re-flowed, so floating-point drift would otherwise show up as 7.999999h
 * in the UI and as off-by-a-hair comparisons in the layout. Everything that stores or
 * compares hours rounds through here, to the hundredth.
 */

/** Rounds to two decimal places — the precision hours are kept at everywhere. */
export function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** `value`, kept within `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

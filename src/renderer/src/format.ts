/** Presentation helpers shared by the grid and the panel. */
import { round } from '@shared/math'

/** "8h", "2.5h" — never "2.5000000004h". */
export function hours(value: number): string {
  const rounded = round(value)
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}h`
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/**
 * Stable colour per work item, so a task keeps the same tone wherever it appears and across
 * restarts. Splits of one item share a tone, which is what makes a split readable.
 */
export function toneFor(workItemId: number): string {
  return `tone-${Math.abs(workItemId) % 8}`
}

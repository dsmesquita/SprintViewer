import { isReportedOnly } from '@shared/sizing'
import type { WorkItem } from '@shared/types'
import { cx, hours } from '../../format'

export type TimeField = 'estimated' | 'completed' | 'remaining' | 'custom'

/**
 * Which TFS field the size on the board comes from.
 *
 * Shown wherever the numbers are, because "8h" means something different depending on where it
 * came from, and the answer is not obvious from the fields side by side. Never the estimate:
 * that is a guess about the task, not a statement of how big it is.
 */
export function sourceField(custom: number | undefined, item: WorkItem | undefined): TimeField {
  if (custom !== undefined) return 'custom'
  if (item && isReportedOnly(item)) return 'completed'
  return 'remaining'
}

export function TimeFields({
  item,
  custom,
  active
}: {
  item: WorkItem
  custom: number | undefined
  active: TimeField
}): JSX.Element {
  const fmt = (value: number | undefined): string =>
    value === undefined || value <= 0 ? '—' : hours(value)

  return (
    <div className="task-time-info">
      <span className={cx('time-row', active === 'estimated' && 'is-active')}>
        <span className="time-label">Estimated</span>
        <span className="time-value">{fmt(item.originalEstimate)}</span>
      </span>
      <span className={cx('time-row', active === 'completed' && 'is-active')}>
        <span className="time-label">Completed</span>
        <span className="time-value">{fmt(item.completedWork)}</span>
      </span>
      <span className={cx('time-row', active === 'remaining' && 'is-active')}>
        <span className="time-label">Remaining</span>
        <span className="time-value">{fmt(item.remainingWork)}</span>
      </span>
      <span className={cx('time-row', active === 'custom' && 'is-active')}>
        <span className="time-label">Custom</span>
        <span className="time-value">{custom !== undefined ? hours(custom) : '—'}</span>
      </span>
    </div>
  )
}

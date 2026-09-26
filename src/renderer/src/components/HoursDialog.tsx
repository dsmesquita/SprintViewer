import { useState } from 'react'
import { plannedHours } from '@shared/sizing'
import { hours as fmt } from '../format'
import { useApp, useSprint } from '../store'
import Dialog from './Dialog'

/**
 * Setting a task's hours by hand.
 *
 * The figure TFS gives is shown alongside, because the point of this dialog is to disagree
 * with it and you cannot do that sensibly without seeing it.
 */
export default function HoursDialog(): JSX.Element | null {
  const sprint = useSprint()
  const workItemId = useApp((s) => s.hoursTarget)
  const close = useApp((s) => s.closeDialog)
  const setCustomHours = useApp((s) => s.setCustomHours)
  const clearCustomHours = useApp((s) => s.clearCustomHours)

  const item = workItemId === null ? undefined : sprint.workItems[workItemId]
  const current = workItemId === null ? undefined : sprint.customHours?.[workItemId]
  const [value, setValue] = useState(String(current ?? (item ? plannedHours(item) : 0)))

  if (workItemId === null || !item) return null
  const parsed = Number(value)
  const valid = Number.isFinite(parsed) && parsed > 0

  const apply = (): void => {
    if (!valid) return
    setCustomHours(workItemId, parsed)
    close()
  }

  return (
    <Dialog
      title={`Hours for #${workItemId}`}
      onClose={close}
      footer={
        <>
          {current !== undefined && (
            <button
              type="button"
              onClick={() => {
                clearCustomHours(workItemId)
                close()
              }}
            >
              Use the TFS figure
            </button>
          )}
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={!valid} onClick={apply}>
            Set hours
          </button>
        </>
      }
    >
      <p style={{ margin: '0 0 10px' }}>{item.title}</p>
      <div className="field">
        <label htmlFor="custom-hours">Hours to plan for</label>
        <input
          id="custom-hours"
          type="number"
          min="0.5"
          step="0.5"
          value={value}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && apply()}
        />
        <p className="hint">
          TFS says {fmt(plannedHours(item))}
          {current !== undefined && ` · you have set ${fmt(current)}`}. Nothing is written back to
          TFS — this only changes how much room the task takes here.
        </p>
      </div>
    </Dialog>
  )
}

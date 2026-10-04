import { useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { InfoIcon, LockIcon } from '../icons'

/**
 * The ⓘ in the calendar's corner: what the keys do and what the marks mean, shown while it is
 * hovered or focused. Drawn above everything (in a portal), so the calendar never clips it.
 */
export default function CalendarKey(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const button = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  const show = (): void => {
    const box = button.current?.getBoundingClientRect()
    if (box) setAt({ top: box.bottom + 6, left: box.left })
    setOpen(true)
  }
  const hide = (): void => setOpen(false)

  return (
    <>
      <button
        ref={button}
        type="button"
        className="ghost calendar-key-button"
        aria-label="Keys and marks"
        aria-describedby={open ? panelId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        <InfoIcon size={14} />
      </button>
      {open &&
        createPortal(
          <div id={panelId} role="tooltip" className="calendar-key" style={at}>
            <h4>Keys</h4>
            <dl>
              <Row keys={['Shift', '←', '→']}>Move the selected task an hour</Row>
              <Row keys={['Shift', 'wheel']}>Scroll the calendar sideways</Row>
              <Row keys={['Ctrl', 'wheel']}>Zoom in and out</Row>
              <Row keys={['Ctrl', 'Z']}>Undo the last change</Row>
              <Row keys={['F11']}>Full screen: only the calendar; Esc leaves</Row>
              <Row keys={['Ctrl', 'click']}>Pick several people; Shift+click, a run of them</Row>
            </dl>
            <p className="calendar-key-tip">
              <strong>Right-click</strong> a task, a person&rsquo;s name or a day for more options.
            </p>
            <h4>Marks</h4>
            <dl>
              <div className="calendar-key-row">
                <dt>
                  <LockIcon locked size={12} />
                </dt>
                <dd>
                  <strong>Locked day</strong> — settled: nothing moves on or off it.
                </dd>
              </div>
              <div className="calendar-key-row">
                <dt>
                  <span className="calendar-key-pin" aria-hidden="true" />
                </dt>
                <dd>
                  <strong>Pinned task</strong> — keeps its hour; other work flows around it.
                </dd>
              </div>
              <div className="calendar-key-row">
                <dt>
                  <span className="calendar-key-today" aria-hidden="true" />
                </dt>
                <dd>
                  <strong>Today</strong> — done work to its left, the plan to its right.
                </dd>
              </div>
            </dl>
          </div>,
          document.body
        )}
    </>
  )
}

function Row({ keys, children }: { keys: string[]; children: ReactNode }): JSX.Element {
  return (
    <div className="calendar-key-row">
      <dt>
        {keys.map((key, index) => (
          <span key={key}>
            {index > 0 && key !== '→' && '+'}
            {index > 0 && key === '→' && ' '}
            <kbd>{key}</kbd>
          </span>
        ))}
      </dt>
      <dd>{children}</dd>
    </div>
  )
}

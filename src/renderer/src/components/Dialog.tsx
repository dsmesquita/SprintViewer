import { useEffect, type ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  footer: ReactNode
  /** A reading-sized dialog, for long content such as the Read me. */
  wide?: boolean
  /** An extra class on the dialog, for one that needs its own shape. */
  className?: string
}

/** Modal shell. Escape closes it; clicking the backdrop does not, to protect typed input. */
export default function Dialog({
  title,
  onClose,
  children,
  footer,
  wide,
  className
}: Props): JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="backdrop">
      <div
        className={['dialog', wide && 'is-wide', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dialog-head">
          <h2>{title}</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        <div className="dialog-foot">{footer}</div>
      </div>
    </div>
  )
}

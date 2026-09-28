import { useState } from 'react'
import { failureLines, failureReport } from '@shared/failure'
import { useApp } from '../store'
import Dialog from './Dialog'

/**
 * Why the last refresh failed, in full: the message, then the facts behind it — the sprint's
 * URL, the request that failed, the step, what the server answered — ready to copy into a
 * message or a ticket. The token is never among them.
 */
export default function RefreshErrorDialog(): JSX.Element | null {
  const status = useApp((s) => s.refreshStatus)
  const closeDialog = useApp((s) => s.closeDialog)
  const [copied, setCopied] = useState<boolean | null>(null)
  if (!status || status.ok) return null

  const report = failureReport(status.text, status.detail)
  const copy = async (): Promise<void> => setCopied(await copyText(report))

  return (
    <Dialog
      title="Refresh failed"
      onClose={closeDialog}
      className="refresh-error"
      footer={
        <>
          {copied !== null && (
            <span className="hint" role="status">
              {copied ? 'Copied.' : 'Could not copy — select the text instead.'}
            </span>
          )}
          <span className="spacer" />
          <button type="button" onClick={() => void copy()}>
            Copy details
          </button>
          <button type="button" className="primary" onClick={closeDialog}>
            Close
          </button>
        </>
      }
    >
      <div className="message is-error refresh-error-message">{status.text}</div>
      {status.detail ? (
        <>
          <dl className="refresh-error-facts">
            {failureLines(status.detail).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {status.detail.response && (
            <>
              <p className="section-title">What the server answered</p>
              <pre className="refresh-error-response">{status.detail.response}</pre>
            </>
          )}
        </>
      ) : (
        <p className="hint">There are no further details for this failure.</p>
      )}
    </Dialog>
  )
}

/**
 * Copies text to the clipboard. The async clipboard API can be refused (no focus, no
 * permission), so the old select-and-copy stands in for it.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const done = document.execCommand?.('copy') ?? false
    area.remove()
    return done
  }
}

import { useState } from 'react'
import { findBlock } from '@shared/mutations'
import { hours } from '../format'
import { useApp, useSprint } from '../store'
import Dialog from './Dialog'

/**
 * Splits a placed task. Two modes:
 * - Keep/return: keep a specific amount here, the rest returns to the backlog.
 * - Split in N: divide into N equal parts (remainder on the first), all editable.
 */
export default function SplitDialog(): JSX.Element | null {
  const sprint = useSprint()
  const blockId = useApp((s) => s.splitTarget)
  const closeDialog = useApp((s) => s.closeDialog)
  const splitBlock = useApp((s) => s.splitBlock)
  const splitIntoN = useApp((s) => s.splitIntoN)

  const position = blockId ? findBlock(sprint, blockId) : null
  const total = position?.block.hours ?? 2

  const [mode, setMode] = useState<'keep' | 'n-parts'>('keep')
  const [keep, setKeep] = useState(() => Math.max(0.5, Math.floor(total / 2)))
  const [n, setN] = useState(2)
  const [parts, setParts] = useState<number[]>(() => equalParts(total, 2))

  if (!position || !blockId) return null

  const item = sprint.workItems[position.block.workItemId]
  const where = position.location.kind === 'backlog' ? 'the backlog' : 'the calendar'

  // Keep/return mode
  const remainder = Math.round((total - keep) * 100) / 100
  const keepValid = keep > 0 && keep < total

  // N-parts mode
  const partsSum = Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100
  const partsValid = parts.length >= 2 && parts.every((p) => p > 0) && partsSum === total

  const handleNChange = (newN: number): void => {
    const clamped = Math.max(2, Math.min(20, newN))
    setN(clamped)
    setParts(equalParts(total, clamped))
  }

  const handlePartChange = (index: number, value: number): void => {
    const next = [...parts]
    next[index] = value
    setParts(next)
  }

  const handleConfirm = (): void => {
    if (mode === 'keep') {
      splitBlock(blockId, keep)
    } else {
      splitIntoN(blockId, parts)
    }
    closeDialog()
  }

  return (
    <Dialog
      title="Split task"
      onClose={closeDialog}
      footer={
        <>
          <span className="spacer" />
          <button type="button" onClick={closeDialog}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={mode === 'keep' ? !keepValid : !partsValid}
            onClick={handleConfirm}
          >
            Split
          </button>
        </>
      }
    >
      <div className="field">
        <label>
          #{position.block.workItemId} {item?.title ?? ''}
        </label>
        <div className="hint" style={{ marginTop: 0 }}>
          {hours(total)} currently on {where}.
        </div>
      </div>

      <div className="field">
        <div className="row" style={{ gap: 16, marginBottom: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
            <input
              type="radio"
              name="split-mode"
              checked={mode === 'keep'}
              onChange={() => setMode('keep')}
              style={{ width: 'auto' }}
            />
            Keep / return
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
            <input
              type="radio"
              name="split-mode"
              checked={mode === 'n-parts'}
              onChange={() => setMode('n-parts')}
              style={{ width: 'auto' }}
            />
            Split in N parts
          </label>
        </div>
      </div>

      {mode === 'keep' ? (
        <>
          <div className="field">
            <label htmlFor="keep">Keep here</label>
            <div className="row">
              <input
                id="keep"
                type="number"
                min={0.5}
                max={total - 0.5}
                step={0.5}
                style={{ width: 110 }}
                value={keep}
                onChange={(event) => setKeep(Number(event.target.value))}
              />
              <input
                type="range"
                min={0.5}
                max={total - 0.5}
                step={0.5}
                value={keep}
                onChange={(event) => setKeep(Number(event.target.value))}
                style={{ flex: 1 }}
              />
            </div>
          </div>
          <div className={`message ${keepValid ? 'is-ok' : 'is-error'}`}>
            {keepValid
              ? `${hours(keep)} stays on ${where}. ${hours(remainder)} returns to the backlog.`
              : `Choose a number between 0.5 and ${hours(total - 0.5)}.`}
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="n-parts">Number of parts</label>
            <input
              id="n-parts"
              type="number"
              min={2}
              max={20}
              step={1}
              style={{ width: 90 }}
              value={n}
              onChange={(event) => handleNChange(Number(event.target.value))}
            />
          </div>
          <div className="field">
            <label>Hours per part</label>
            <div className="parts-grid">
              {parts.map((p, i) => (
                <div
                  key={i}
                  className="row"
                  style={{ alignItems: 'center', gap: 8, marginBottom: 4 }}
                >
                  <span style={{ minWidth: 56, fontSize: 12, color: 'var(--text-3)' }}>
                    {i === 0 ? 'Part 1 (here)' : `Part ${i + 1}`}
                  </span>
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    style={{ width: 90 }}
                    value={p}
                    onChange={(event) => handlePartChange(i, Number(event.target.value))}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className={`message ${partsValid ? 'is-ok' : 'is-error'}`}>
            {partsValid
              ? `Part 1 stays on ${where}. ${parts.length - 1} part${parts.length > 2 ? 's' : ''} return to the backlog.`
              : `Parts must sum to exactly ${hours(total)} (currently ${hours(partsSum)}).`}
          </div>
        </>
      )}
    </Dialog>
  )
}

function equalParts(total: number, n: number): number[] {
  const base = Math.floor((total / n) * 2) / 2
  const remainder = Math.round((total - base * n) * 100) / 100
  const parts = Array(n).fill(base) as number[]
  if (remainder > 0) parts[0] = Math.round((parts[0] + remainder) * 100) / 100
  return parts
}

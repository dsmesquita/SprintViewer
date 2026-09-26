import { useEffect, useState } from 'react'
import {
  applySquadSync,
  defaultChoices,
  planSquadSync,
  type SyncRow,
  type TfsTeam
} from '@shared/squad'
import type { Member } from '@shared/types'
import { cx } from '../format'

interface Props {
  /** Any query or sprint URL in the project; only the project is taken from it. */
  url: string
  roster: Member[]
  onApply: (next: Member[], teamName: string) => void
  onClose: () => void
}

/**
 * Proposes roster changes from a TFS team, inside Settings.
 *
 * Nothing is written here. Applying hands the new roster back to the Settings form, where it
 * sits like any other unsaved edit until Save — so Cancel still undoes a sync.
 */
export default function SquadSync({ url, roster, onApply, onClose }: Props): JSX.Element {
  const [teams, setTeams] = useState<TfsTeam[] | null>(null)
  const [teamId, setTeamId] = useState('')
  const [rows, setRows] = useState<SyncRow[] | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const named = roster.filter((member) => member.name.trim().length > 0)

  const loadMembers = async (id: string): Promise<void> => {
    setTeamId(id)
    setRows(null)
    if (!id) return
    setBusy(true)
    setError(null)
    const result = await window.api.teamMembers(url, id)
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    const plan = planSquadSync(named, result.value)
    setRows(plan)
    setChosen(defaultChoices(plan))
  }

  useEffect(() => {
    if (!url) {
      setError(
        'Enter a query or sprint URL under Connection first — the team is read from its project.'
      )
      return
    }
    let cancelled = false
    setBusy(true)
    void window.api.listTeams(url).then((result) => {
      if (cancelled) return
      setBusy(false)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setTeams(result.value.teams)
      if (result.value.suggested) void loadMembers(result.value.suggested)
    })
    return () => {
      cancelled = true
    }
    // Loaded once per opening; the URL cannot change while the panel is open, and re-running
    // on every render (which listing loadMembers would do) would fetch the teams in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = (key: string): void =>
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const team = teams?.find((t) => t.id === teamId)
  const changes = (rows ?? []).filter((row) =>
    row.kind === 'keep' ? !chosen.has(row.key) : row.kind !== 'linked' && chosen.has(row.key)
  ).length

  /** Ticks or unticks every row of one section at once. */
  const setAll = (keys: string[], on: boolean): void =>
    setChosen((current) => {
      const next = new Set(current)
      for (const key of keys) {
        if (on) next.add(key)
        else next.delete(key)
      }
      return next
    })

  const section = (kind: SyncRow['kind'], title: string): JSX.Element | null => {
    const mine = (rows ?? []).filter((row) => row.kind === kind)
    if (mine.length === 0) return null
    const keys = mine.map((row) => row.key)
    const allOn = keys.every((key) => chosen.has(key))
    return (
      <div className="sync-section">
        <div className="sync-title">
          <span>{title}</span>
          {kind !== 'linked' && mine.length > 1 && (
            <button
              type="button"
              className="link-button"
              onClick={() => setAll(keys, !allOn)}
              title={
                kind === 'keep'
                  ? allOn
                    ? 'Take everyone who is not on this team off the roster'
                    : 'Keep everyone on the roster'
                  : undefined
              }
            >
              {allOn ? 'Unselect all' : 'Select all'}
            </button>
          )}
        </div>
        {mine.map((row) => (
          <label key={row.key} className={cx('sync-row', row.kind === 'linked' && 'is-settled')}>
            {row.kind === 'linked' ? (
              <span className="sync-check">✓</span>
            ) : (
              <input
                type="checkbox"
                checked={chosen.has(row.key)}
                onChange={() => toggle(row.key)}
              />
            )}
            <span className="sync-text">{describe(row)}</span>
          </label>
        ))}
      </div>
    )
  }

  return (
    <div className="squad-sync">
      {error && <div className="message is-error">{error}</div>}

      <div className="row">
        <label htmlFor="sync-team" style={{ flex: 'none' }}>
          Team
        </label>
        <select
          id="sync-team"
          value={teamId}
          disabled={!teams || busy}
          onChange={(event) => void loadMembers(event.target.value)}
        >
          <option value="">{teams ? 'Choose a team…' : busy ? 'Loading teams…' : '—'}</option>
          {(teams ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {busy && teams && <p className="hint">Reading {team?.name ?? 'the team'}…</p>}

      {rows && (
        <>
          {rows.length === 0 ? (
            <p className="hint">{team?.name} has nobody in it, and the roster is empty.</p>
          ) : (
            <>
              {section('link', 'Link to their TFS account')}
              {section('add', `On ${team?.name ?? 'the team'}, not on the roster`)}
              {section('keep', 'On the roster, not on this team — untick to remove')}
              {section('linked', 'Already linked')}
            </>
          )}
        </>
      )}

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
        <span className="hint" style={{ marginTop: 0, marginRight: 'auto' }}>
          {rows &&
            (changes === 0
              ? 'Nothing to change.'
              : `${changes} ${changes === 1 ? 'change' : 'changes'}`)}
        </span>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={!rows || changes === 0}
          onClick={() => rows && onApply(applySquadSync(named, rows, chosen), team?.name ?? 'TFS')}
        >
          Apply to roster
        </button>
      </div>
    </div>
  )
}

function describe(row: SyncRow): string {
  switch (row.kind) {
    case 'link':
      return `${row.member.name} → ${row.identity}${
        row.member.tfsIdentity ? ` (was ${row.member.tfsIdentity})` : ''
      }`
    case 'linked':
      return `${row.member.name} — ${row.person.displayName}`
    case 'add':
      return `Add ${row.name}  ·  ${row.identity}${
        row.maybe.length > 0
          ? ` — could be ${row.maybe.join(' or ')}, who is already on the roster`
          : ''
      }`
    case 'keep':
      return `Keep ${row.member.name}`
  }
}

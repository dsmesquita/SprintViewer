import { useState, type ReactNode } from 'react'
import type { ChildQueryMode } from '@shared/settings'
import { DEFAULT_DOMAIN, normaliseIdentity, OTHER_OWNER } from '@shared/taskCreation'
import type { Member } from '@shared/types'
import { cx } from '../../format'
import SquadSync from '../SquadSync'
import { uniqueId, type PlanForm } from './form'

interface Props {
  form: PlanForm
  onChange: (patch: Partial<PlanForm>) => void
  /** Says what the URL is for on this tab. */
  urlHint: ReactNode
  /** Says what the day length does on this tab. */
  hoursHint?: ReactNode
  /** Runs the URL: the connection, then the query itself. */
  onTest: () => void
  busy: boolean
  /** Where the TFS team sync reads the project from when this tab's URL is empty. */
  fallbackUrl: string
  /** What the rows are called on this tab: the team roster, or the sprint's people. */
  teamTitle: string
}

/**
 * The settings both tabs have — the app's defaults and the open sprint's own copy: the URL,
 * the working day, the people, creating tasks, and fetching child tasks.
 */
export default function PlanFields({
  form,
  onChange,
  urlHint,
  hoursHint,
  onTest,
  busy,
  fallbackUrl,
  teamTitle
}: Props): JSX.Element {
  const [syncOpen, setSyncOpen] = useState(false)
  const [syncedFrom, setSyncedFrom] = useState<string | null>(null)
  const { members, templates } = form

  const setMembers = (next: Member[]): void =>
    onChange({ members: next.map((member, order) => ({ ...member, order })) })
  const updateMember = (index: number, patch: Partial<Member>): void =>
    setMembers(members.map((m, i) => (i === index ? { ...m, ...patch } : m)))
  const moveMember = (index: number, delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= members.length) return
    const next = [...members]
    ;[next[index], next[target]] = [next[target], next[index]]
    setMembers(next)
  }
  const setTemplates = (next: PlanForm['templates']): void => onChange({ templates: next })

  return (
    <>
      <div className="field">
        <label htmlFor="test-url">Query or sprint URL</label>
        <div className="row">
          <input
            id="test-url"
            type="url"
            value={form.queryUrl}
            placeholder="https://tfs-product.cmf.criticalmanufacturing.com/tfs/Collection/Project/_queries/query/…"
            onChange={(event) => onChange({ queryUrl: event.target.value })}
          />
          <button
            type="button"
            disabled={busy || !form.queryUrl.trim() || !window.api}
            title="Connect, then run the query"
            onClick={onTest}
          >
            {busy ? 'Testing…' : 'Test'}
          </button>
        </div>
        <p className="hint">{urlHint}</p>
      </div>

      <p className="section-title" style={{ marginTop: 16 }}>
        {teamTitle}
      </p>
      <div className="field">
        <label htmlFor="hours">Hours in a working day</label>
        <input
          id="hours"
          type="number"
          min={1}
          max={24}
          step={1}
          style={{ width: 90 }}
          value={form.hoursPerDay}
          onChange={(event) => onChange({ hoursPerDay: Number(event.target.value) || 8 })}
        />
        {hoursHint && <div className="hint">{hoursHint}</div>}
      </div>

      {members.map((member, index) => (
        <div className="roster-row" key={member.id}>
          <span className="handle">{index + 1}</span>
          <input
            type="text"
            value={member.name}
            placeholder="Name shown on the calendar row"
            onChange={(event) => updateMember(index, { name: event.target.value })}
          />
          <input
            type="text"
            value={member.tfsIdentity ?? ''}
            placeholder="TFS display name (optional)"
            onChange={(event) => updateMember(index, { tfsIdentity: event.target.value })}
          />
          <button
            type="button"
            className="ghost"
            onClick={() => moveMember(index, -1)}
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => moveMember(index, 1)}
            aria-label="Move down"
          >
            ↓
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => setMembers(members.filter((_, i) => i !== index))}
            aria-label="Remove"
          >
            ✕
          </button>
        </div>
      ))}
      <div className="row">
        <button
          type="button"
          onClick={() =>
            setMembers([...members, { id: uniqueId('member', members), name: '', order: 0 }])
          }
        >
          Add member
        </button>
        <button
          type="button"
          disabled={syncOpen || !window.api}
          title={
            window.api
              ? 'Match these people against a team in TFS and link everyone to their account'
              : 'Only in the desktop app'
          }
          onClick={() => setSyncOpen(true)}
        >
          Sync with TFS team…
        </button>
      </div>
      {syncOpen && (
        <SquadSync
          url={form.queryUrl.trim() || fallbackUrl}
          roster={members}
          onClose={() => setSyncOpen(false)}
          onApply={(next, team) => {
            setMembers(next)
            setSyncOpen(false)
            setSyncedFrom(team)
          }}
        />
      )}
      {syncedFrom && !syncOpen && (
        <div className="sync-note">
          Updated from <strong>{syncedFrom}</strong> — Save to keep it.
        </div>
      )}

      <p className="section-title" style={{ marginTop: 16 }}>
        Creating tasks
      </p>
      <div className="row" style={{ gap: 12, marginBottom: 12 }}>
        {(
          [
            ['doc-owner', 'DOC tasks go to', 'docOwner', 'docOther'],
            ['qa-owner', 'QA tasks go to', 'qaOwner', 'qaOther']
          ] as const
        ).map(([id, label, choiceKey, otherKey]) => {
          const value = form[choiceKey]
          const other = form[otherKey]
          const resolved = normaliseIdentity(other)
          return (
            <div className="field" key={id} style={{ flex: 1, marginBottom: 0 }}>
              <label htmlFor={id}>{label}</label>
              <select
                id={id}
                value={value}
                onChange={(event) => onChange({ [choiceKey]: event.target.value })}
              >
                <option value="">Nobody — leave unassigned</option>
                {members
                  .filter((member) => member.name.trim().length > 0)
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                <option value={OTHER_OWNER}>Someone else…</option>
              </select>
              {value === OTHER_OWNER && (
                <>
                  <input
                    type="text"
                    value={other}
                    aria-label={`${label} — TFS account`}
                    placeholder="e.g. bsrocha or CMF\bsrocha"
                    className={cx(other.trim().length > 0 && !resolved && 'is-invalid')}
                    style={{ marginTop: 6 }}
                    onChange={(event) => onChange({ [otherKey]: event.target.value })}
                  />
                  <div className="hint">
                    {resolved
                      ? `Saved as ${resolved}`
                      : other.trim()
                        ? 'That is not an account name — use the login, like bsrocha.'
                        : `Their TFS login. ${DEFAULT_DOMAIN}\\ is added if you leave it out.`}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
      <div className="field">
        <label>Templates</label>
        {templates.map((template, index) => (
          <div className="template-row" key={index}>
            <input
              type="text"
              value={template.name}
              placeholder="Name"
              aria-label="Template name"
              onChange={(event) =>
                setTemplates(
                  templates.map((t, i) => (i === index ? { ...t, name: event.target.value } : t))
                )
              }
            />
            <input
              type="text"
              value={template.prefixes}
              placeholder="Prefixes, e.g. DEV, VAL"
              aria-label="Template prefixes"
              onChange={(event) =>
                setTemplates(
                  templates.map((t, i) =>
                    i === index ? { ...t, prefixes: event.target.value } : t
                  )
                )
              }
            />
            <button
              type="button"
              className="ghost"
              aria-label="Remove template"
              onClick={() => setTemplates(templates.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setTemplates([...templates, { name: '', prefixes: '' }])}
        >
          Add template
        </button>
        <div className="hint">
          Applying a template adds one task per prefix, titled like{' '}
          <code>DEV:: Work item title</code>. With no templates saved, DEV + VAL is offered.
        </div>
      </div>

      <p className="section-title" style={{ marginTop: 16 }}>
        Import
      </p>
      <div className="field">
        <label htmlFor="child-query-mode">Fetch child tasks</label>
        <select
          id="child-query-mode"
          value={form.childQueryMode}
          onChange={(event) => onChange({ childQueryMode: event.target.value as ChildQueryMode })}
          style={{ width: 180 }}
        >
          <option value="auto">Auto — when all results are containers</option>
          <option value="always">Always fetch child tasks</option>
          <option value="never">Never fetch child tasks</option>
        </select>
        <div className="hint">
          When a TFS query returns only User Stories or Bugs, automatically fetch their child tasks
          so the backlog is immediately usable. Always does it for every User Story or Bug the query
          returns, even when it returns tasks as well. Only tasks in the same iteration as their
          User Story or Bug are fetched, at import and at every refresh.
        </div>
      </div>
    </>
  )
}

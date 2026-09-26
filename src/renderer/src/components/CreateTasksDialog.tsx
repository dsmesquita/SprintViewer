import { useState } from 'react'
import { memberMatches } from '@shared/assignment'
import {
  assigneeFor,
  DEFAULT_TASK_TEMPLATES,
  isIdentity,
  normaliseIdentity,
  OTHER_OWNER,
  parseTags,
  taggedTitle,
  type CreateTasksResult,
  type TaskDraft
} from '@shared/taskCreation'
import type { Member } from '@shared/types'
import { cx, hours } from '../format'
import { useApp, useSprint } from '../store'
import Dialog from './Dialog'

type Mode = 'single' | 'multiple' | 'team'

interface Row {
  key: string
  title: string
  /** Team member id, {@link OTHER_OWNER} for someone off the team, or empty for unassigned. */
  ownerId: string
  /** The TFS account typed for someone off the team. */
  other: string
  estimate: number
}

/**
 * Creates Tasks in TFS under a Bug or User Story.
 *
 * Three shapes of the same request: one task, a hand-built list of them (with templates and
 * the DOC and QA shortcuts to fill it quickly), or one identical task per person on the team.
 * Area and iteration are always the parent's. Tags are too unless the user types their own, and
 * a task can go to somebody off the team by their TFS account — DOC and QA often do.
 */
export default function CreateTasksDialog(): JSX.Element | null {
  const sprint = useSprint()
  const parentId = useApp((s) => s.createTasksParent)
  const settings = useApp((s) => s.settings)
  const closeDialog = useApp((s) => s.closeDialog)
  const createTasks = useApp((s) => s.createTasks)

  const parent = parentId === null ? undefined : sprint.workItems[parentId]
  const baseTitle = parent?.title ?? ''
  const members = [...sprint.members].sort((a, b) => a.order - b.order)
  const templates = settings?.taskTemplates?.length
    ? settings.taskTemplates
    : DEFAULT_TASK_TEMPLATES
  // The parent's own assignee is the best first guess for a single task, and only for that:
  // a VAL or QA task is exactly the kind that belongs to someone else.
  const parentOwner = members.find(
    (member) => parent?.assignedTo !== undefined && memberMatches(member, parent.assignedTo)
  )

  const [mode, setMode] = useState<Mode>('single')
  const [rows, setRows] = useState<Row[]>(() => [row(baseTitle, parentOwner?.id ?? '')])
  const [tagMode, setTagMode] = useState<'parent' | 'custom'>('parent')
  const [customTags, setCustomTags] = useState(() => (parent?.tfsTags ?? []).join(', '))
  const [teamTitle, setTeamTitle] = useState(baseTitle)
  const [teamEstimate, setTeamEstimate] = useState(0)
  const [skipped, setSkipped] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [partial, setPartial] = useState<CreateTasksResult | null>(null)

  if (!parent || parentId === null) return null

  const memberById = new Map(members.map((member) => [member.id, member]))
  /** The saved DOC or QA owner as a row's owner: a team member, an outside account, or nobody. */
  const savedOwner = (value: string | undefined): Pick<Row, 'ownerId' | 'other'> =>
    isIdentity(value)
      ? { ownerId: OTHER_OWNER, other: value! }
      : { ownerId: value !== undefined && memberById.has(value) ? value : '', other: '' }
  const parentTags = parent?.tfsTags ?? []
  const tags = tagMode === 'custom' ? parseTags(customTags) : parentTags

  const planned: Row[] =
    mode === 'single'
      ? rows.slice(0, 1)
      : mode === 'multiple'
        ? rows
        : members
            .filter((member) => !skipped.includes(member.id))
            .map((member) => ({
              key: member.id,
              title: teamTitle,
              ownerId: member.id,
              other: '',
              estimate: teamEstimate
            }))

  const valid =
    planned.length > 0 &&
    planned.every(
      (r) =>
        r.title.trim().length > 0 &&
        (r.ownerId !== OTHER_OWNER || normaliseIdentity(r.other) !== null)
    )
  const totalHours = planned.reduce((sum, r) => sum + (r.estimate > 0 ? r.estimate : 0), 0)

  const updateRow = (key: string, patch: Partial<Row>): void =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  /**
   * Adds rows to the list. The untouched starting row is replaced rather than kept: applying a
   * template to a fresh dialog should give exactly that template, not the template plus a
   * blank task nobody asked for.
   */
  const addRows = (added: Row[]): void => {
    setMode('multiple')
    setRows((current) => {
      const pristine =
        current.length === 1 && current[0].title === baseTitle && current[0].estimate === 0
      return pristine ? added : [...current, ...added]
    })
  }

  const submit = async (): Promise<void> => {
    const drafts: TaskDraft[] = planned.map((r) => ({
      title: r.title.trim(),
      assignedTo:
        r.ownerId === OTHER_OWNER
          ? (normaliseIdentity(r.other) ?? undefined)
          : assigneeFor(memberById.get(r.ownerId)),
      estimate: r.estimate > 0 ? r.estimate : 0,
      // Left out when the parent's are wanted, so the server copies them as it always has.
      tags: tagMode === 'custom' ? tags : undefined
    }))
    setBusy(true)
    setError(null)
    const result = await createTasks(parentId, drafts)
    setBusy(false)

    if (typeof result === 'string') {
      setError(result)
      return
    }
    if (result.failures.length === 0) {
      closeDialog()
      return
    }
    // What went through is already in the backlog. What did not is put back in front of the
    // user on its own, so trying again cannot create the successful ones twice.
    setPartial(result)
    setMode('multiple')
    setRows(result.failures.map((failure) => ({ ...planned[failure.index], key: newKey() })))
  }

  return (
    <Dialog
      title={`Create tasks under #${parent.id}`}
      onClose={closeDialog}
      footer={
        <>
          <span className="hint" style={{ marginTop: 0 }}>
            {planned.length} {planned.length === 1 ? 'task' : 'tasks'}
            {totalHours > 0 && ` · ${hours(totalHours)}`}
          </span>
          <span className="spacer" />
          <button type="button" onClick={closeDialog} disabled={busy}>
            {partial ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!valid || busy}
            onClick={() => void submit()}
          >
            {busy
              ? 'Creating…'
              : `${partial ? 'Retry' : 'Create'} ${planned.length} ${
                  planned.length === 1 ? 'task' : 'tasks'
                }`}
          </button>
        </>
      }
    >
      {error && <div className="message is-error">{error}</div>}
      {partial && (
        <div className="message is-error">
          {partial.created.length > 0
            ? `${partial.created.length} created and added to the backlog. `
            : ''}
          TFS refused {partial.failures.length === 1 ? 'this one' : 'these'}:
          <ul className="create-failures">
            {partial.failures.map((failure) => (
              <li key={failure.index}>
                <strong>{failure.title || '(no title)'}</strong> — {failure.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="field">
        <label>
          {parent.type} · {parent.title}
        </label>
        <div className="hint" style={{ marginTop: 0 }}>
          Area and iteration are copied from #{parent.id}. Remaining work starts equal to the
          estimate.
        </div>
      </div>

      <div className="field create-tags">
        <label>Tags</label>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={cx('choice-pill', tagMode === 'parent' && 'is-on')}
            aria-pressed={tagMode === 'parent'}
            onClick={() => setTagMode('parent')}
          >
            Parent&rsquo;s tags
          </button>
          <button
            type="button"
            className={cx('choice-pill', tagMode === 'custom' && 'is-on')}
            aria-pressed={tagMode === 'custom'}
            onClick={() => setTagMode('custom')}
          >
            Custom tags
          </button>
        </div>
        {tagMode === 'parent' ? (
          <div className="tag-chips">
            {parentTags.length > 0 ? (
              parentTags.map((tag) => (
                <span className="tag-chip" key={tag}>
                  {tag}
                </span>
              ))
            ) : (
              <span className="hint" style={{ marginTop: 0 }}>
                #{parent.id} has no tags, so neither will the new tasks.
              </span>
            )}
          </div>
        ) : (
          <>
            <input
              type="text"
              value={customTags}
              aria-label="Custom tags"
              placeholder="e.g. Release 24.10, Backend"
              onChange={(event) => setCustomTags(event.target.value)}
            />
            <div className="tag-chips">
              {tags.length > 0 ? (
                tags.map((tag) => (
                  <span className="tag-chip" key={tag}>
                    {tag}
                  </span>
                ))
              ) : (
                <span className="hint" style={{ marginTop: 0 }}>
                  No tags — the new tasks will have none.
                </span>
              )}
            </div>
          </>
        )}
        <div className="hint">
          {tagMode === 'parent'
            ? `Every new task gets the same tags as #${parent.id}.`
            : 'Separate tags with commas. These replace the parent’s on every new task.'}
        </div>
      </div>

      <div className="row create-modes">
        {(
          [
            ['single', 'Single task'],
            ['multiple', 'Multiple tasks'],
            ['team', 'Same task for the whole team']
          ] as Array<[Mode, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={cx('choice-pill', mode === value && 'is-on')}
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode !== 'team' ? (
        <>
          <div className="task-rows">
            <div className="task-rows-head">
              <span>Title</span>
              <span>Owner</span>
              <span>Estimate</span>
              <span />
            </div>
            {(mode === 'single' ? rows.slice(0, 1) : rows).map((r) => (
              <div className="task-row" key={r.key}>
                <input
                  type="text"
                  value={r.title}
                  aria-label="Task title"
                  placeholder="Task title"
                  onChange={(event) => updateRow(r.key, { title: event.target.value })}
                />
                <OwnerSelect
                  members={members}
                  value={r.ownerId}
                  other={r.other}
                  onChange={(ownerId) => updateRow(r.key, { ownerId })}
                  onOtherChange={(other) => updateRow(r.key, { other })}
                />
                <HoursInput
                  value={r.estimate}
                  onChange={(estimate) => updateRow(r.key, { estimate })}
                />
                {mode === 'multiple' ? (
                  <button
                    type="button"
                    className="ghost"
                    aria-label="Remove task"
                    disabled={rows.length <= 1}
                    onClick={() => setRows((current) => current.filter((x) => x.key !== r.key))}
                  >
                    ✕
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>

          <div className="row create-actions">
            <button type="button" onClick={() => addRows([row(baseTitle, '')])}>
              + Add task
            </button>
            <select
              value=""
              aria-label="Apply template"
              onChange={(event) => {
                const template = templates[Number(event.target.value)]
                if (!template) return
                addRows(template.prefixes.map((prefix) => row(taggedTitle(prefix, baseTitle), '')))
              }}
            >
              <option value="" disabled>
                Apply template…
              </option>
              {templates.map((template, index) => (
                <option key={template.name + index} value={index}>
                  {template.name} ({template.prefixes.join(', ')})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() =>
                addRows([
                  { ...row(taggedTitle('DOC', baseTitle), ''), ...savedOwner(settings?.docOwner) }
                ])
              }
            >
              + DOC task
            </button>
            <button
              type="button"
              onClick={() =>
                addRows([
                  { ...row(taggedTitle('QA', baseTitle), ''), ...savedOwner(settings?.qaOwner) }
                ])
              }
            >
              + QA task
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="task-rows">
            <div className="task-row is-team">
              <input
                type="text"
                value={teamTitle}
                aria-label="Task title"
                onChange={(event) => setTeamTitle(event.target.value)}
              />
              <HoursInput value={teamEstimate} onChange={setTeamEstimate} />
            </div>
          </div>
          <p className="section-title" style={{ marginTop: 12 }}>
            One for each of
          </p>
          <div className="team-picks">
            {members.map((member) => (
              <label key={member.id} className="team-pick">
                <input
                  type="checkbox"
                  checked={!skipped.includes(member.id)}
                  onChange={(event) =>
                    setSkipped((current) =>
                      event.target.checked
                        ? current.filter((id) => id !== member.id)
                        : [...current, member.id]
                    )
                  }
                />
                {member.name}
              </label>
            ))}
          </div>
        </>
      )}
    </Dialog>
  )
}

function OwnerSelect({
  members,
  value,
  other,
  onChange,
  onOtherChange
}: {
  members: Member[]
  value: string
  other: string
  onChange: (ownerId: string) => void
  onOtherChange: (other: string) => void
}): JSX.Element {
  const resolved = normaliseIdentity(other)
  return (
    <span className="owner-cell">
      <select value={value} aria-label="Owner" onChange={(event) => onChange(event.target.value)}>
        <option value="">Unassigned</option>
        {members.map((member) => (
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
            aria-label="TFS account"
            placeholder="e.g. bsrocha or CMF\bsrocha"
            className={cx(other.trim().length > 0 && !resolved && 'is-invalid')}
            onChange={(event) => onOtherChange(event.target.value)}
          />
          <span className="owner-resolved">
            {resolved ? `→ ${resolved}` : other.trim() ? 'Not an account name' : 'TFS account'}
          </span>
        </>
      )}
    </span>
  )
}

function HoursInput({
  value,
  onChange
}: {
  value: number
  onChange: (value: number) => void
}): JSX.Element {
  return (
    <span className="hours-input">
      <input
        type="number"
        min={0}
        step={0.5}
        value={value > 0 ? value : ''}
        placeholder="—"
        aria-label="Estimate in hours"
        onChange={(event) => {
          const parsed = Number(event.target.value)
          onChange(Number.isFinite(parsed) && parsed > 0 ? parsed : 0)
        }}
      />
      h
    </span>
  )
}

let counter = 0
function newKey(): string {
  counter += 1
  return `row-${counter}`
}

function row(title: string, ownerId: string): Row {
  return { key: newKey(), title, ownerId, other: '', estimate: 0 }
}

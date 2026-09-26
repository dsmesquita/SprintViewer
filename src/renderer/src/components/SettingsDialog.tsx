import { useEffect, useState } from 'react'
import type { AuthMode } from '@shared/settings'
import {
  DEFAULT_DOMAIN,
  DEFAULT_TASK_TEMPLATES,
  isIdentity,
  normaliseIdentity,
  OTHER_OWNER
} from '@shared/taskCreation'
type ChildQueryMode = 'auto' | 'always' | 'never'
import type { Member } from '@shared/types'
import { cx } from '../format'
import { useApp } from '../store'
import Dialog from './Dialog'
import HelpDialog from './HelpDialog'
import SquadSync from './SquadSync'

/**
 * Settings. The PAT is write-only from here: it goes to the main process to be encrypted,
 * and all that ever comes back is a masked hint, so the token cannot be read out of the UI.
 */
export default function SettingsDialog(): JSX.Element {
  const settings = useApp((s) => s.settings)
  const closeDialog = useApp((s) => s.closeDialog)
  const saveSettings = useApp((s) => s.saveSettings)
  const applySettings = useApp((s) => s.applySettings)
  const sprint = useApp((s) => s.sprint)
  const applyHoursPerDay = useApp((s) => s.setHoursPerDay)
  const syncSprintMembers = useApp((s) => s.syncSprintMembers)
  const isSample = useApp((s) => s.isSample)

  const [members, setMembers] = useState<Member[]>(settings?.members ?? [])
  const [hoursPerDay, setHoursPerDay] = useState(settings?.hoursPerDay ?? 8)
  const [authMode, setAuthMode] = useState<AuthMode>(settings?.authMode ?? 'pat')
  const [trustedHosts, setTrustedHosts] = useState((settings?.trustedHosts ?? []).join(', '))
  const [childQueryMode, setChildQueryMode] = useState<ChildQueryMode>(settings?.childQueryMode ?? 'auto')
  // A saved owner is a team member's id or, for someone off the team, their TFS account.
  const [docOwner, setDocOwner] = useState(ownerChoice(settings?.docOwner))
  const [qaOwner, setQaOwner] = useState(ownerChoice(settings?.qaOwner))
  const [docOther, setDocOther] = useState(isIdentity(settings?.docOwner) ? settings!.docOwner! : '')
  const [qaOther, setQaOther] = useState(isIdentity(settings?.qaOwner) ? settings!.qaOwner! : '')
  // Prefixes are edited as the text the user types, and only split into a list on save, so a
  // half-typed "DEV, " does not lose its trailing comma under the cursor.
  const [templates, setTemplates] = useState(() =>
    (settings?.taskTemplates?.length ? settings.taskTemplates : DEFAULT_TASK_TEMPLATES).map(
      (template) => ({ name: template.name, prefixes: template.prefixes.join(', ') })
    )
  )
  const [token, setToken] = useState('')
  const [testUrl, setTestUrl] = useState(settings?.lastQueryUrl ?? '')
  const [apiVersion, setApiVersion] = useState(settings?.apiVersion ?? '')
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [storagePath, setStoragePath] = useState('')
  const [version, setVersion] = useState('')
  const [syncOpen, setSyncOpen] = useState(false)
  // Shown in place of Settings rather than over it, so Escape closes one dialog at a time and
  // nothing typed here is lost on the way back.
  const [helpOpen, setHelpOpen] = useState(false)
  // Set once a sync has been applied: what it changed, and whether Save should carry it into the
  // open sprint too.
  const [synced, setSynced] = useState<{ team: string; toSprint: boolean } | null>(null)

  useEffect(() => {
    void window.api?.getStoragePath().then(setStoragePath)
    void window.api?.getAppVersion().then(setVersion)
  }, [])

  const addMember = (): void =>
    setMembers((current) => [...current, { id: uniqueId('member', current), name: '', order: current.length }])

  const updateMember = (index: number, patch: Partial<Member>): void =>
    setMembers((current) => current.map((m, i) => (i === index ? { ...m, ...patch } : m)))

  const removeMember = (index: number): void =>
    setMembers((current) =>
      current.filter((_, i) => i !== index).map((member, order) => ({ ...member, order }))
    )

  const moveMember = (index: number, delta: number): void =>
    setMembers((current) => {
      const target = index + delta
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next.map((member, order) => ({ ...member, order }))
    })

  const saveToken = async (): Promise<void> => {
    setBusy(true)
    const result = await window.api.setPat(token)
    setBusy(false)
    if (result.ok) {
      applySettings(result.value)
      setToken('')
      setMessage({ text: 'Token saved and encrypted for this Windows account.', ok: true })
    } else {
      setMessage({ text: result.message, ok: false })
    }
  }

  const removeToken = async (): Promise<void> => {
    applySettings(await window.api.clearPat())
    setMessage({ text: 'Token removed.', ok: true })
  }

  const test = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    const result = await window.api.testConnection(testUrl)
    setBusy(false)
    setMessage({ text: result.message, ok: result.ok })
    if (result.ok) {
      applySettings(await window.api.getSettings())
      if (result.apiVersion) setApiVersion(result.apiVersion)
    }
  }

  const save = async (): Promise<void> => {
    const named = members.filter((member) => member.name.trim().length > 0)
    // An owner who was just removed from the roster is nobody's owner any more.
    const onRoster = (id: string): string => (named.some((member) => member.id === id) ? id : '')
    const owner = (choice: string, other: string): string =>
      choice === OTHER_OWNER ? (normaliseIdentity(other) ?? '') : onRoster(choice)
    // Before the settings are written, and not conditional on that write: the setting alone
    // only decides how the *next* sprint is built — the open one carries its own day length
    // and per-day capacities, and changing the number and watching the calendar ignore it is
    // the whole of the bug this addresses.
    applyHoursPerDay(hoursPerDay)
    const roster = named.map((member, order) => ({ ...member, name: member.name.trim(), order }))
    // The sprint keeps its own copy of the rows, so a sync reaches it only when asked to.
    if (synced?.toSprint) syncSprintMembers(roster)
    await saveSettings({
      members: roster,
      hoursPerDay,
      authMode,
      apiVersion: apiVersion.trim(),
      trustedHosts: trustedHosts
        .split(',')
        .map((host) => host.trim())
        .filter(Boolean),
      childQueryMode,
      docOwner: owner(docOwner, docOther),
      qaOwner: owner(qaOwner, qaOther),
      taskTemplates: templates
        .map((template) => ({
          name: template.name.trim(),
          prefixes: template.prefixes
            .split(',')
            .map((prefix) => prefix.trim())
            .filter(Boolean)
        }))
        .filter((template) => template.name.length > 0 && template.prefixes.length > 0)
    })
    closeDialog()
  }

  if (helpOpen) return <HelpDialog onClose={() => setHelpOpen(false)} />

  return (
    <Dialog
      title="Settings"
      onClose={closeDialog}
      footer={
        <>
          <button type="button" onClick={() => setHelpOpen(true)} title="How to use Sprint Viewer">
            Read me
          </button>
          <span className="spacer" />
          <button type="button" onClick={closeDialog}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      {message && (
        <div className={`message ${message.ok ? 'is-ok' : 'is-error'}`}>{message.text}</div>
      )}

      <p className="section-title">Authentication</p>
      <div className="field">
        <div className="row">
          <label className="row" style={{ gap: 5 }}>
            <input
              type="radio"
              style={{ width: 'auto' }}
              checked={authMode === 'pat'}
              onChange={() => setAuthMode('pat')}
            />
            Personal access token
          </label>
          <label className="row" style={{ gap: 5 }}>
            <input
              type="radio"
              style={{ width: 'auto' }}
              checked={authMode === 'windows'}
              onChange={() => setAuthMode('windows')}
            />
            Windows account
          </label>
        </div>
        <div className="hint">
          Use a token unless your server has tokens disabled, in which case Windows integrated
          authentication is tried instead.
        </div>
      </div>

      {authMode === 'pat' && (
        <div className="field">
          <label htmlFor="pat">Token</label>
          {settings?.hasPat ? (
            <div className="row">
              <input id="pat" type="text" value={settings.patHint ?? ''} readOnly />
              <button type="button" onClick={() => void removeToken()}>
                Remove
              </button>
            </div>
          ) : (
            <div className="row">
              <input
                id="pat"
                type="password"
                value={token}
                placeholder="Paste the token from TFS"
                onChange={(event) => setToken(event.target.value)}
                autoComplete="off"
              />
              <button type="button" disabled={busy || !token.trim()} onClick={() => void saveToken()}>
                Save token
              </button>
            </div>
          )}
          <div className="hint">
            Needs Work Items (Read), or Read &amp; Write to create tasks from the backlog. Stored
            encrypted with Windows DPAPI — only this account on
            this machine can decrypt it, and it is never shown again after saving.
          </div>
        </div>
      )}

      <p className="section-title" style={{ marginTop: 16 }}>
        Connection
      </p>
      <div className="field">
        <label htmlFor="test-url">Query or sprint URL</label>
        <div className="row">
          <input
            id="test-url"
            type="url"
            value={testUrl}
            placeholder="https://tfs-product.cmf.criticalmanufacturing.com/tfs/Collection/Project/_queries/query/…"
            onChange={(event) => setTestUrl(event.target.value)}
          />
          <button type="button" disabled={busy || !testUrl.trim()} onClick={() => void test()}>
            {busy ? 'Testing…' : 'Test'}
          </button>
        </div>
      </div>

      <div className="field">
        <label htmlFor="api-version">API version</label>
        <input
          id="api-version"
          type="text"
          value={apiVersion}
          placeholder="Negotiated automatically"
          onChange={(event) => setApiVersion(event.target.value)}
          style={{ width: 180 }}
        />
        <div className="hint">
          Filled in by Test. Only set it by hand if your server rejects every version the app
          tries — the error names the one it wants, and some older servers need the preview
          form, like 3.0-preview. Clear the box to go back to negotiating.
        </div>
      </div>

      <div className="field">
        <label htmlFor="trusted">Trust certificates from</label>
        <input
          id="trusted"
          type="text"
          value={trustedHosts}
          placeholder="tfs-product.cmf.criticalmanufacturing.com"
          onChange={(event) => setTrustedHosts(event.target.value)}
        />
        <div className="hint">
          Only fill this in if the connection fails on a certificate error. Named hosts skip
          certificate validation, so list nothing but your own server.
        </div>
      </div>

      <p className="section-title" style={{ marginTop: 16 }}>
        Team
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
          value={hoursPerDay}
          onChange={(event) => setHoursPerDay(Number(event.target.value) || 8)}
        />
        {sprint && hoursPerDay !== sprint.hoursPerDay && (
          <div className="hint">
            Saving rescales <strong>{sprint.name}</strong> from {sprint.hoursPerDay} to{' '}
            {hoursPerDay} hours a day. Days set to off stay off and half days stay half. Undo
            puts it back.
          </div>
        )}
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
          <button type="button" className="ghost" onClick={() => moveMember(index, -1)} aria-label="Move up">
            ↑
          </button>
          <button type="button" className="ghost" onClick={() => moveMember(index, 1)} aria-label="Move down">
            ↓
          </button>
          <button type="button" className="ghost" onClick={() => removeMember(index)} aria-label="Remove">
            ✕
          </button>
        </div>
      ))}
      <div className="row">
        <button type="button" onClick={addMember}>
          Add member
        </button>
        <button
          type="button"
          disabled={syncOpen || !window.api}
          title={
            window.api
              ? 'Match the roster against a team in TFS and link everyone to their account'
              : 'Only in the desktop app'
          }
          onClick={() => setSyncOpen(true)}
        >
          Sync with TFS team…
        </button>
      </div>
      {syncOpen && (
        <SquadSync
          url={testUrl.trim() || settings?.lastQueryUrl || sprint?.queryUrl || ''}
          roster={members}
          onClose={() => setSyncOpen(false)}
          onApply={(next, team) => {
            setMembers(next)
            setSyncOpen(false)
            setSynced({ team, toSprint: Boolean(sprint) && !isSample })
          }}
        />
      )}
      {synced && !syncOpen && (
        <div className="sync-note">
          Roster updated from <strong>{synced.team}</strong> — Save to keep it.
          {sprint && !isSample && (
            <label className="row" style={{ gap: 6, marginTop: 4 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={synced.toSprint}
                onChange={(event) => setSynced({ ...synced, toSprint: event.target.checked })}
              />
              Also update {sprint.name}: link the same accounts and add new people as empty rows.
              Nobody is removed from it.
            </label>
          )}
        </div>
      )}

      <p className="section-title" style={{ marginTop: 16 }}>
        Creating tasks
      </p>
      <div className="row" style={{ gap: 12, marginBottom: 12 }}>
        {(
          [
            ['doc-owner', 'DOC tasks go to', docOwner, setDocOwner, docOther, setDocOther],
            ['qa-owner', 'QA tasks go to', qaOwner, setQaOwner, qaOther, setQaOther]
          ] as Array<[string, string, string, (value: string) => void, string, (value: string) => void]>
        ).map(([id, label, value, change, other, changeOther]) => {
          const resolved = normaliseIdentity(other)
          return (
            <div className="field" key={id} style={{ flex: 1, marginBottom: 0 }}>
              <label htmlFor={id}>{label}</label>
              <select id={id} value={value} onChange={(event) => change(event.target.value)}>
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
                    onChange={(event) => changeOther(event.target.value)}
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
                setTemplates((current) =>
                  current.map((t, i) => (i === index ? { ...t, name: event.target.value } : t))
                )
              }
            />
            <input
              type="text"
              value={template.prefixes}
              placeholder="Prefixes, e.g. DEV, VAL"
              aria-label="Template prefixes"
              onChange={(event) =>
                setTemplates((current) =>
                  current.map((t, i) => (i === index ? { ...t, prefixes: event.target.value } : t))
                )
              }
            />
            <button
              type="button"
              className="ghost"
              aria-label="Remove template"
              onClick={() => setTemplates((current) => current.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setTemplates((current) => [...current, { name: '', prefixes: '' }])}
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
          value={childQueryMode}
          onChange={(event) => setChildQueryMode(event.target.value as ChildQueryMode)}
          style={{ width: 180 }}
        >
          <option value="auto">Auto — when all results are containers</option>
          <option value="always">Always fetch child tasks</option>
          <option value="never">Never fetch child tasks</option>
        </select>
        <div className="hint">
          When a TFS query returns only User Stories or Bugs, automatically fetch their child
          tasks so the backlog is immediately usable. Always does it for every User Story or Bug
          the query returns, even when it returns tasks as well. Only tasks in the same iteration
          as their User Story or Bug are fetched, at import and at every refresh.
        </div>
      </div>

      <p className="hint" style={{ marginTop: 16 }}>
        Sprint Viewer {version || '…'}
        <br />
        Sprints and settings are stored in {storagePath || '…'}
      </p>
    </Dialog>
  )
}

/** Stable, readable id that survives a rename of the person. */
function uniqueId(prefix: string, existing: Member[]): string {
  let index = existing.length + 1
  while (existing.some((member) => member.id === `${prefix}-${index}`)) index++
  return `${prefix}-${index}`
}

/** The owner list's value for a saved owner: a member id as it is, an account as "someone else". */
function ownerChoice(saved: string | undefined): string {
  if (!saved) return ''
  return isIdentity(saved) ? OTHER_OWNER : saved
}

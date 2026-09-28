import { useEffect, useState } from 'react'
import { formatDayHeader } from '@shared/dates'
import { DEFAULT_SETTINGS, type AuthMode, type ChildQueryMode } from '@shared/settings'
import { appPlan, removedWithWork, sprintPlan } from '@shared/sprintSettings'
import { cx } from '../format'
import { useApp } from '../store'
import Dialog from './Dialog'
import HelpDialog from './HelpDialog'
import { copyForm, formOf, planOf, type PlanForm } from './settings/form'
import PlanFields from './settings/PlanFields'

type Tab = 'sprint' | 'app'

/**
 * Settings, in two tabs. **App** holds how this PC reaches TFS and the defaults a new sprint
 * starts from; **Sprint** holds the open sprint's own copy of those defaults, which is what that
 * sprint uses. Each tab can be filled from the other; Save writes both.
 *
 * The PAT is write-only from here: it goes to the main process to be encrypted, and all that
 * ever comes back is a masked hint, so the token cannot be read out of the UI.
 */
export default function SettingsDialog(): JSX.Element {
  const settings = useApp((s) => s.settings)
  const closeDialog = useApp((s) => s.closeDialog)
  const saveSettings = useApp((s) => s.saveSettings)
  const applySettings = useApp((s) => s.applySettings)
  const applySprintSettings = useApp((s) => s.applySprintSettings)
  const storeSprint = useApp((s) => s.sprint)
  const isSample = useApp((s) => s.isSample)
  // Sample data is not saved, so it has no settings of its own to edit.
  const sprint = storeSprint && !isSample ? storeSprint : null

  const [tab, setTab] = useState<Tab>(sprint ? 'sprint' : 'app')
  const [appForm, setAppForm] = useState<PlanForm>(() =>
    formOf(appPlan(settings ?? DEFAULT_SETTINGS))
  )
  const [sprintForm, setSprintForm] = useState<PlanForm | null>(() =>
    sprint ? formOf(sprintPlan(sprint, settings)) : null
  )
  const [name, setName] = useState(sprint?.name ?? '')

  const [authMode, setAuthMode] = useState<AuthMode>(settings?.authMode ?? 'pat')
  const [trustedHosts, setTrustedHosts] = useState((settings?.trustedHosts ?? []).join(', '))
  const [token, setToken] = useState('')
  const [apiVersion, setApiVersion] = useState(settings?.apiVersion ?? '')
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  // People Save would take off the sprint while they still have work on it, awaiting a yes.
  const [removing, setRemoving] = useState<ReturnType<typeof removedWithWork> | null>(null)
  const [storagePath, setStoragePath] = useState('')
  const [version, setVersion] = useState('')
  // Shown in place of Settings rather than over it, so Escape closes one dialog at a time and
  // nothing typed here is lost on the way back.
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    void window.api?.getStoragePath().then(setStoragePath)
    void window.api?.getAppVersion().then(setVersion)
  }, [])

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

  /**
   * Connects, then runs the query as Refresh would. Connecting alone proves the server and the
   * sign-in, not the query — a query that was deleted or no longer runs would pass.
   */
  const test = async (url: string, mode: ChildQueryMode): Promise<void> => {
    setBusy(true)
    setMessage(null)
    const connected = await window.api.testConnection(url)
    if (!connected.ok) {
      setBusy(false)
      setMessage({ text: connected.message, ok: false })
      return
    }
    applySettings(await window.api.getSettings())
    if (connected.apiVersion) setApiVersion(connected.apiVersion)
    const query = await window.api.refreshSprint(url, mode)
    setBusy(false)
    setMessage(
      query.ok
        ? {
            text: `${connected.message} The query returns ${query.value.length} work ${
              query.value.length === 1 ? 'item' : 'items'
            }.`,
            ok: true
          }
        : { text: `${connected.message} But the query failed: ${query.message}`, ok: false }
    )
  }

  const save = async (confirmed = false): Promise<void> => {
    if (sprint && sprintForm) {
      const next = { ...planOf(sprintForm), name }
      const removed = removedWithWork(sprint, next.members)
      if (removed.length > 0 && !confirmed) {
        setTab('sprint')
        setRemoving(removed)
        return
      }
      applySprintSettings(next)
    }
    const defaults = planOf(appForm)
    await saveSettings({
      ...(defaults.queryUrl ? { lastQueryUrl: defaults.queryUrl } : {}),
      members: defaults.members,
      hoursPerDay: defaults.hoursPerDay,
      childQueryMode: defaults.childQueryMode,
      docOwner: defaults.docOwner,
      qaOwner: defaults.qaOwner,
      taskTemplates: defaults.taskTemplates,
      authMode,
      apiVersion: apiVersion.trim(),
      trustedHosts: trustedHosts
        .split(',')
        .map((host) => host.trim())
        .filter(Boolean)
    })
    closeDialog()
  }

  if (helpOpen) return <HelpDialog onClose={() => setHelpOpen(false)} />

  const changeSprint = (patch: Partial<PlanForm>): void => {
    setRemoving(null)
    setSprintForm((current) => current && { ...current, ...patch })
  }
  const changeApp = (patch: Partial<PlanForm>): void =>
    setAppForm((current) => ({ ...current, ...patch }))
  const sprintFrom = sprint?.days[0]?.date
  const sprintTo = sprint?.days[sprint.days.length - 1]?.date

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
      {sprint && (
        <div className="settings-tabs" role="tablist" aria-label="Settings for">
          {(
            [
              ['sprint', 'This sprint'],
              ['app', 'App & new sprints']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={cx('tab', tab === id && 'is-active')}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {message && (
        <div className={`message ${message.ok ? 'is-ok' : 'is-error'}`}>{message.text}</div>
      )}

      {tab === 'sprint' && sprint && sprintForm ? (
        <div role="tabpanel" aria-label="This sprint">
          {removing && (
            <div className="message is-error">
              Saving takes{' '}
              {removing
                .map(
                  ({ member, tasks }) =>
                    `${member.name} (${tasks} ${tasks === 1 ? 'task' : 'tasks'})`
                )
                .join(', ')}{' '}
              off this sprint. Their tasks go back to the backlog; Undo puts everything back.
              <div className="row" style={{ marginTop: 8 }}>
                <button type="button" className="primary" onClick={() => void save(true)}>
                  Remove and save
                </button>
                <button type="button" onClick={() => setRemoving(null)}>
                  Keep them
                </button>
              </div>
            </div>
          )}
          <p className="hint" style={{ marginTop: 0 }}>
            What <strong>{sprint.name}</strong> uses. It started as a copy of the app&rsquo;s
            defaults; changing one never changes the other.
          </p>
          <div className="field">
            <label htmlFor="sprint-name">Sprint name</label>
            <input
              id="sprint-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <div className="hint">
              {sprintFrom &&
                sprintTo &&
                `${formatDayHeader(sprintFrom)} – ${formatDayHeader(sprintTo)}`}
              {sprint.lastRefreshedAt &&
                ` · last refreshed ${new Date(sprint.lastRefreshedAt).toLocaleString()}`}
            </div>
          </div>
          <PlanFields
            form={sprintForm}
            onChange={changeSprint}
            urlHint="Refresh reads this sprint from here. Paste another query's address and Save to point the sprint at it."
            hoursHint={
              sprintForm.hoursPerDay !== sprint.hoursPerDay && (
                <>
                  Saving rescales <strong>{sprint.name}</strong> from {sprint.hoursPerDay} to{' '}
                  {sprintForm.hoursPerDay} hours a day. Days set to off stay off and half days stay
                  half. Undo puts it back.
                </>
              )
            }
            onTest={() => void test(sprintForm.queryUrl.trim(), sprintForm.childQueryMode)}
            busy={busy}
            fallbackUrl={appForm.queryUrl.trim()}
            teamTitle="People in this sprint"
          />
          <div className="settings-copy">
            <button
              type="button"
              onClick={() => {
                changeSprint(copyForm(appForm))
                setMessage({
                  text: 'Filled in from the app’s settings — Save to apply them to this sprint.',
                  ok: true
                })
              }}
            >
              Apply app settings to this sprint
            </button>
          </div>
        </div>
      ) : (
        <div role="tabpanel" aria-label="App & new sprints">
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
                  <button
                    type="button"
                    disabled={busy || !token.trim()}
                    onClick={() => void saveToken()}
                  >
                    Save token
                  </button>
                </div>
              )}
              <div className="hint">
                Needs Work Items (Read), or Read &amp; Write to create tasks from the backlog.
                Stored encrypted with Windows DPAPI — only this account on this machine can decrypt
                it, and it is never shown again after saving.
              </div>
            </div>
          )}

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
            Defaults for new sprints
          </p>
          <PlanFields
            form={appForm}
            onChange={changeApp}
            urlHint="Start sprint begins from this URL."
            hoursHint="New sprints start with this many hours a day."
            onTest={() => void test(appForm.queryUrl.trim(), appForm.childQueryMode)}
            busy={busy}
            fallbackUrl={sprintForm?.queryUrl.trim() ?? ''}
            teamTitle="Team"
          />
          {sprint && sprintForm && (
            <div className="settings-copy">
              <button
                type="button"
                onClick={() => {
                  changeApp(copyForm(sprintForm))
                  setMessage({
                    text: `Filled in from ${sprint.name} — Save to make them the defaults.`,
                    ok: true
                  })
                }}
              >
                Use this sprint&rsquo;s settings as defaults
              </button>
            </div>
          )}

          <p className="hint" style={{ marginTop: 16 }}>
            Sprint Viewer {version || '…'}
            <br />
            Sprints and settings are stored in {storagePath || '…'}
          </p>
        </div>
      )}
    </Dialog>
  )
}

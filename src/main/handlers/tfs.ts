import { session } from 'electron'
import type { ChildQueryMode, ConnectionResult } from '@shared/settings'
import type { TaskDraft } from '@shared/taskCreation'
import { getSettings, readPat, updateSettings } from '../storage'
import { TfsClient, type TfsCredentials } from '../tfs/client'
import { parseTfsUrl, type ParsedTfsUrl } from '../tfs/url'
import { messageFor } from '../result'

/** Talking to TFS with the credentials and network settings the user chose. */

/** Builds a client for `url`, applying the credentials and network settings the user chose. */
export async function clientFor(url: string): Promise<{ client: TfsClient; target: ParsedTfsUrl }> {
  const target = parseTfsUrl(url)
  const settings = await getSettings()
  const credentials: TfsCredentials = { mode: settings.authMode }

  if (settings.authMode === 'pat') credentials.pat = await readPat()
  else session.defaultSession.allowNTLMCredentialsForDomains(target.host)

  return {
    client: new TfsClient(target, credentials, settings.apiVersion, settings.businessOrderField),
    target
  }
}

/**
 * Keeps the Business Order field the client discovered, so later imports ask for it by name
 * instead of hunting for it again.
 */
export async function rememberBusinessOrderField(client: TfsClient): Promise<void> {
  const field = client.businessOrderField
  const settings = await getSettings()
  if (field && field !== settings.businessOrderField)
    await updateSettings({ businessOrderField: field })
}

export async function testConnection(url: string): Promise<ConnectionResult> {
  try {
    const { client } = await clientFor(url)
    const { user, apiVersion } = await client.connect()
    await updateSettings({ apiVersion })
    return {
      ok: true,
      message: `Connected as ${user}, using REST API version ${apiVersion}.`,
      user,
      apiVersion
    }
  } catch (error) {
    return { ok: false, message: messageFor(error) }
  }
}

/**
 * The work items a query or sprint URL returns now. Only a fetch: the reconciliation runs in
 * the renderer, where the sprint lives, so the main process never holds a second copy of it.
 * `mode` is the sprint's own child-task setting; the app's default when it has none.
 */
export async function fetchSprintItems(url: string, mode?: ChildQueryMode) {
  const { client } = await clientFor(url)
  const items = await client.fetchSprintItems(
    mode ?? (await getSettings()).childQueryMode ?? 'auto'
  )
  await rememberBusinessOrderField(client)
  return items
}

/**
 * The one write to TFS. It needs the sprint's own URL only to know which server and project to
 * talk to; the parent is named by id and read afresh there.
 */
export async function createTasks(url: string, parentId: number, drafts: TaskDraft[]) {
  const { client } = await clientFor(url)
  return client.createTasks(parentId, drafts)
}

/**
 * The project's teams, for the roster sync — and the one to start on: the team a board or
 * sprint URL names, else the one TFS creates with every project.
 */
export async function listTeams(url: string) {
  const { client, target } = await clientFor(url)
  const teams = await client.listTeams()
  const wanted = [target.team, target.project && `${target.project} Team`]
    .filter((name): name is string => Boolean(name))
    .map((name) => name.toLowerCase())
  const suggested = wanted
    .map((name) => teams.find((team) => team.name.toLowerCase() === name))
    .find(Boolean)?.id
  return { teams, suggested }
}

export async function teamMembers(url: string, teamId: string) {
  return (await clientFor(url)).client.teamMembers(teamId)
}

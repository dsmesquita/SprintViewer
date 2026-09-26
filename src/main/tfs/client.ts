import { net } from 'electron'
import { isContainerType, schedulableItems } from '@shared/grouping'
import type { CreateTasksResult, TaskDraft } from '@shared/taskCreation'
import type { WorkItem } from '@shared/types'
import type { AppSettings, AuthMode } from '@shared/settings'
import type { TfsPerson, TfsTeam } from '@shared/squad'
import type { ParsedTfsUrl } from './url'

/**
 * Minimal TFS REST client.
 *
 * Almost entirely a reader: GETs, and WIQL POSTs that only query. The single exception is
 * `createTasks`, which adds new Task work items under a Bug or User Story when the user asks
 * for it — nothing here ever modifies a work item that already exists. Requests go through
 * Electron's `net` stack rather than Node's `https`, so the user's system proxy and Windows
 * integrated authentication both work without extra code.
 */

/**
 * Newest first. On-prem servers reject versions they predate, so we walk down until one
 * sticks. The ladder reaches back to 1.0 because TFS installs still in service can be a
 * decade old, and an unknown version is answered with a 400, not a redirect to a known one.
 */
const API_VERSIONS = ['7.0', '6.0', '5.0', '4.1', '3.2', '3.0', '2.0', '1.0']

const REQUIRED_FIELDS = [
  'System.Title',
  'System.WorkItemType',
  'System.State',
  'System.AssignedTo',
  // A core field on every TFS there has ever been. Child tasks are only taken when it matches
  // their parent's, so it has to be known for every task, not just the containers.
  'System.IterationPath',
  'Microsoft.VSTS.Scheduling.RemainingWork'
]

export type ChildQueryMode = NonNullable<AppSettings['childQueryMode']>

/**
 * Fields that only exist on some servers and process templates. `System.Parent` became
 * queryable in later releases; the scheduling pair is absent from templates that do not track
 * hours. An older server rejects the whole batch for naming a field it does not have, which
 * would take the entire import down, so these are asked for separately and dropped if the
 * server objects. Without them the app falls back to sizing tasks by remaining work.
 */
const OPTIONAL_FIELDS = [
  'System.Parent',
  'Microsoft.VSTS.Scheduling.OriginalEstimate',
  'Microsoft.VSTS.Scheduling.CompletedWork'
]

/** TFS caps a work item batch at 200 ids. */
const BATCH_SIZE = 200

export class TfsError extends Error {}

export interface TfsCredentials {
  mode: AuthMode
  pat?: string
}

interface RawWorkItem {
  id: number
  /** The REST address of the item, which is what a link to it has to name. */
  url?: string
  fields?: Record<string, unknown>
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH'
  contentType?: string
}

const ESTIMATE_FIELD = 'Microsoft.VSTS.Scheduling.OriginalEstimate'

export class TfsClient {
  private apiVersion: string | undefined
  /** Set once the server has told us it does not know one of the optional fields. */
  private optionalFieldsRejected = false
  /** Reference name of the Business Order field, given or discovered. */
  private orderField: string | undefined
  /** What the query or sprint itself returned, before any parent was added to it. */
  private resolvedIds: number[] = []

  constructor(
    private readonly target: ParsedTfsUrl,
    private readonly credentials: TfsCredentials,
    cachedApiVersion?: string,
    businessOrderField?: string
  ) {
    this.apiVersion = cachedApiVersion
    this.orderField = businessOrderField
  }

  /** The Business Order field this import used, so it can be remembered for the next one. */
  get businessOrderField(): string | undefined {
    return this.orderField
  }

  /** Confirms the server is reachable and the credentials work, and settles the API version. */
  async connect(): Promise<{ user: string; apiVersion: string }> {
    const candidates = this.apiVersion
      ? [this.apiVersion, ...API_VERSIONS.filter((v) => v !== this.apiVersion)]
      : [...API_VERSIONS]

    let lastError: Error | undefined
    const tried: string[] = []

    for (let index = 0; index < candidates.length; index++) {
      const version = candidates[index]
      tried.push(version)
      try {
        const data = await this.request<{ authenticatedUser?: { providerDisplayName?: string } }>(
          `${this.target.collectionBase}/_apis/connectionData`,
          version
        )
        // `request` may have fallen back to the -preview form; keep whichever worked.
        this.apiVersion = this.lastWorkingVersion ?? version
        return {
          user: data.authenticatedUser?.providerDisplayName ?? 'unknown user',
          apiVersion: this.apiVersion
        }
      } catch (error) {
        lastError = error as Error
        // An auth or network failure will fail identically on every version — stop early.
        if (error instanceof TfsError && !error.message.includes('API version')) throw error

        // Some servers name the range they accept. Jump straight to the top of it rather
        // than walking down one step at a time.
        const ceiling = supportedCeiling(lastError.message)
        if (ceiling && !tried.includes(ceiling)) {
          // Move it to the front of what is left rather than only adding it when absent —
          // otherwise a ceiling already on the ladder is reached by walking, one round trip
          // at a time, which is slow over a VPN.
          const queued = candidates.indexOf(ceiling, index + 1)
          if (queued >= 0) candidates.splice(queued, 1)
          candidates.splice(index + 1, 0, ceiling)
        }
      }
    }

    throw new TfsError(
      `${this.target.host} did not accept any REST API version this app knows about ` +
        `(tried ${tried.join(', ')}).\nLast response: ${lastError?.message ?? 'no detail'}\n` +
        'If you know the version your server wants, set it in Settings under API version.'
    )
  }

  /**
   * Every work item the URL points at, plus any parent story or bug that the query itself
   * did not return. The parents are what the side panel groups tasks under, so without them
   * a task would know its parent's id and nothing else about it.
   */
  async fetchWorkItems(): Promise<WorkItem[]> {
    if (!this.apiVersion) await this.connect()
    const ids = await this.resolveIds()
    this.resolvedIds = ids
    if (ids.length === 0) return []

    const items = await this.fetchByIds(ids)
    const known = new Set(items.map((item) => item.id))

    // Every container, whether the query returned it or only a task pointed at it. Only the
    // leaves need a parent looked up: a story is never a card, so what sits above *it* is
    // never drawn and never worth fetching.
    const containers = new Set(items.filter((item) => isContainerType(item.type)).map((i) => i.id))
    for (const item of schedulableItems(items)) {
      if (typeof item.parentId === 'number' && !known.has(item.parentId)) {
        containers.add(item.parentId)
      }
    }
    if (containers.size === 0) return items

    // Containers are asked for in full rather than by named field. There are few of them, and
    // it is the only way to find a Business Order field whose reference name nobody knows —
    // it is a customisation, so it is called something different on every server.
    const raw = await this.fetchRaw([...containers], true)
    this.orderField ??= detectBusinessOrder(raw)
    const parents = raw.map((item) => this.toWorkItem(item))
    const replaced = new Set(parents.map((item) => item.id))
    return [...items.filter((item) => !replaced.has(item.id)), ...parents]
  }

  /**
   * Everything a sprint is made of: what the URL returns, plus the child tasks the "Fetch child
   * tasks" setting asks for. Import and refresh both come through here, so a refresh sees the
   * same tasks the import did — otherwise every fetched child would be flagged as gone from the
   * query at the first refresh, and its hours would never be updated again.
   *
   * `auto` fetches children only when the URL returned nothing but Bugs and User Stories;
   * `always` does it for every container the URL returned, even alongside tasks; `never` takes
   * the result as it is.
   */
  async fetchSprintItems(mode: ChildQueryMode): Promise<WorkItem[]> {
    const items = await this.fetchWorkItems()
    if (mode === 'never' || items.length === 0) return items

    // Only containers the URL itself returned. `fetchWorkItems` also adds the parent of every
    // task, to head a group in the panel — fetching *their* children would pull in sibling
    // tasks the query deliberately left out.
    const queried = new Set(this.resolvedIds)
    const containers = items.filter((item) => isContainerType(item.type) && queried.has(item.id))
    if (containers.length === 0) return items
    if (mode === 'auto' && containers.length < items.length) return items

    const merged = new Map(items.map((item) => [item.id, item]))
    for (const child of await this.fetchChildTasks(containers)) merged.set(child.id, child)
    return [...merged.values()]
  }

  /**
   * The tasks under the given Bugs and User Stories that belong to the same sprint as their
   * parent — the same iteration path, not merely somewhere under it. A story carried over from
   * last sprint keeps last sprint's tasks out of this one, which is the point of a sprint view.
   *
   * WIQL cannot compare a task's field with its parent's, so the parents are grouped by their
   * iteration and asked about one iteration at a time. The answer is checked again on arrival.
   */
  private async fetchChildTasks(parents: WorkItem[]): Promise<WorkItem[]> {
    if (!this.apiVersion) await this.connect()
    const { projectBase, project } = this.target
    if (!project) return []

    const byIteration = new Map<string, WorkItem[]>()
    for (const parent of parents) {
      // Without the parent's iteration there is nothing to match a child against.
      if (!parent.iterationPath) continue
      const key = parent.iterationPath.toLowerCase()
      byIteration.set(key, [...(byIteration.get(key) ?? []), parent])
    }

    const children: WorkItem[] = []
    for (const group of byIteration.values()) {
      const iterationPath = group[0].iterationPath!
      const wiql =
        `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${escape(project)}' ` +
        `AND [System.Parent] IN (${group.map((parent) => parent.id).join(', ')}) ` +
        `AND [System.IterationPath] = '${escape(iterationPath)}'`
      const data = await this.request<QueryResult>(
        `${projectBase}/_apis/wit/wiql`,
        this.apiVersion!,
        JSON.stringify({ query: wiql })
      )
      const ids = idsFromQueryResult(data)
      if (ids.length === 0) continue

      const wanted = new Set(group.map((parent) => parent.id))
      for (const child of await this.fetchByIds(ids)) {
        const sameSprint = child.iterationPath?.toLowerCase() === iterationPath.toLowerCase()
        if (sameSprint && child.parentId !== undefined && wanted.has(child.parentId)) {
          children.push(child)
        }
      }
    }
    return children
  }

  /**
   * Creates Tasks under `parentId`, one request each, in order.
   *
   * TFS has no transactions, so a refusal part-way leaves the earlier tasks in place. That is
   * reported rather than hidden: the caller gets both what was created and what was not, and
   * why. The parent is read afresh first, so its tags, area and iteration are the server's
   * current ones rather than whatever the sprint file remembers.
   */
  async createTasks(parentId: number, drafts: TaskDraft[]): Promise<CreateTasksResult> {
    if (!this.apiVersion) await this.connect()
    const [parent] = await this.fetchRaw([parentId], true)
    if (!parent) throw new TfsError(`Work item ${parentId} could not be found in TFS.`)

    const result: CreateTasksResult = { created: [], failures: [] }
    for (const [index, draft] of drafts.entries()) {
      try {
        result.created.push(await this.createTask(parent, draft))
      } catch (error) {
        result.failures.push({
          index,
          title: draft.title,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    }
    return result
  }

  private async createTask(parent: RawWorkItem, draft: TaskDraft): Promise<WorkItem> {
    const fields = parent.fields ?? {}
    const patch: Array<{ op: 'add'; path: string; value: unknown }> = []
    const set = (field: string, value: unknown): void => {
      if (value !== undefined && value !== null && value !== '') {
        patch.push({ op: 'add', path: `/fields/${field}`, value })
      }
    }

    set('System.Title', draft.title)
    set('System.AssignedTo', draft.assignedTo)
    // Without these the task lands in the project's default area and iteration, and a sprint
    // imported by iteration would never see it again.
    set('System.AreaPath', fields['System.AreaPath'])
    set('System.IterationPath', fields['System.IterationPath'])
    set('System.Tags', draft.tags === undefined ? fields['System.Tags'] : draft.tags.join('; '))
    if (draft.estimate > 0) {
      set(ESTIMATE_FIELD, draft.estimate)
      set('Microsoft.VSTS.Scheduling.RemainingWork', draft.estimate)
    }
    patch.push({
      op: 'add',
      path: '/relations/-',
      value: {
        rel: 'System.LinkTypes.Hierarchy-Reverse',
        url: parent.url ?? `${this.target.collectionBase}/_apis/wit/workItems/${parent.id}`
      }
    })

    let raw: RawWorkItem
    try {
      raw = await this.postTask(patch)
    } catch (error) {
      // Process templates that do not track Original Estimate reject the whole request for
      // naming it. Remaining Work is the field every template has, so try again without it.
      const message = error instanceof Error ? error.message : ''
      if (!message.includes(ESTIMATE_FIELD)) throw error
      raw = await this.postTask(patch.filter((op) => op.path !== `/fields/${ESTIMATE_FIELD}`))
    }
    return { ...this.toWorkItem(raw), parentId: parent.id }
  }

  /**
   * Sends one create request. Servers from API 4.1 on create with POST; older TFS created
   * with PATCH against the same address and answers a POST with 404 or 405, so the other
   * method is tried when the first is refused that way.
   */
  private async postTask(patch: unknown[]): Promise<RawWorkItem> {
    const url = `${this.target.projectBase}/_apis/wit/workitems/$Task`
    const body = JSON.stringify(patch)
    const contentType = 'application/json-patch+json'
    const first: 'POST' | 'PATCH' = modernCreate(this.apiVersion!) ? 'POST' : 'PATCH'
    try {
      return await this.request<RawWorkItem>(url, this.apiVersion!, body, {
        method: first,
        contentType
      })
    } catch (error) {
      if (!(error instanceof MethodRefused)) throw error
      const other = first === 'POST' ? 'PATCH' : 'POST'
      return this.request<RawWorkItem>(url, this.apiVersion!, body, { method: other, contentType })
    }
  }

  /** The teams in the URL's project, by name. */
  async listTeams(): Promise<TfsTeam[]> {
    if (!this.apiVersion) await this.connect()
    const data = await this.request<{ value?: Array<{ id?: string; name?: string }> }>(
      `${this.teamsBase()}?$top=1000`,
      this.apiVersion!
    )
    return (data.value ?? [])
      .filter((team): team is TfsTeam => Boolean(team.id && team.name))
      .map((team) => ({ id: team.id, name: team.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * The people on a team.
   *
   * Servers before API 5.0 list identities directly; later ones wrap each in `{ identity }`
   * beside team-admin flags. Groups can be team members too, and are left out — a group is not
   * someone a task can be planned for.
   */
  async teamMembers(teamId: string): Promise<TfsPerson[]> {
    if (!this.apiVersion) await this.connect()
    const data = await this.request<{ value?: Array<RawIdentity & { identity?: RawIdentity }> }>(
      `${this.teamsBase()}/${encodeURIComponent(teamId)}/members?$top=1000`,
      this.apiVersion!
    )
    const people = new Map<string, TfsPerson>()
    for (const entry of data.value ?? []) {
      const identity = entry.identity ?? entry
      const name = identity.displayName?.trim()
      if (!identity.id || !name || isGroup(identity)) continue
      people.set(identity.id, {
        id: identity.id,
        displayName: name,
        uniqueName: identity.uniqueName?.trim() || undefined
      })
    }
    return [...people.values()].sort((a, b) => a.displayName.localeCompare(b.displayName))
  }

  private teamsBase(): string {
    const { collectionBase, project } = this.target
    if (!project) {
      throw new TfsError(
        'That URL does not name a project, so there are no teams to read. Use the address of ' +
          'a query or sprint in the project.'
      )
    }
    return `${collectionBase}/_apis/projects/${encodeURIComponent(project)}/teams`
  }

  private async fetchByIds(ids: number[]): Promise<WorkItem[]> {
    return (await this.fetchRaw(ids)).map((raw) => this.toWorkItem(raw))
  }

  private async fetchRaw(ids: number[], allFields = false): Promise<RawWorkItem[]> {
    const items: RawWorkItem[] = []
    for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
      items.push(...(await this.fetchBatch(ids.slice(offset, offset + BATCH_SIZE), allFields)))
    }
    return items
  }

  /**
   * One batch of work items. If the server rejects the optional fields it stops asking for
   * them, for this batch and every later one, rather than failing the whole import over a
   * field that only newer servers have.
   */
  private async fetchBatch(ids: number[], allFields = false): Promise<RawWorkItem[]> {
    const fields = this.optionalFieldsRejected
      ? REQUIRED_FIELDS
      : [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]
    const url =
      `${this.target.collectionBase}/_apis/wit/workitems?ids=${ids.join(',')}` +
      (allFields ? '' : `&fields=${fields.map(encodeURIComponent).join(',')}`)

    try {
      const data = await this.request<{ value: RawWorkItem[] }>(url, this.apiVersion!)
      return data.value ?? []
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      const blamesOptionalField = OPTIONAL_FIELDS.some((field) => message.includes(field))
      if (this.optionalFieldsRejected || !blamesOptionalField) throw error

      this.optionalFieldsRejected = true
      return this.fetchBatch(ids, allFields)
    }
  }

  private async resolveIds(): Promise<number[]> {
    const { source, projectBase, project } = this.target
    const version = this.apiVersion!

    if (source.kind === 'query') {
      const data = await this.request<QueryResult>(
        `${projectBase}/_apis/wit/wiql/${source.queryId}`,
        version
      )
      return idsFromQueryResult(data)
    }

    if (source.kind === 'iteration') {
      if (!project) throw new TfsError('That URL does not identify a project.')
      const wiql =
        `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${escape(project)}' ` +
        `AND [System.IterationPath] UNDER '${escape(source.iterationPath)}' ` +
        `AND [System.WorkItemType] IN ('Task', 'Bug')`
      const data = await this.request<QueryResult>(
        `${projectBase}/_apis/wit/wiql`,
        version,
        JSON.stringify({ query: wiql })
      )
      return idsFromQueryResult(data)
    }

    throw new TfsError(
      'That URL points at a project rather than a specific query or sprint. Open the query ' +
        'or the sprint taskboard in TFS and copy that address instead.'
    )
  }

  private toWorkItem(raw: RawWorkItem): WorkItem {
    const fields = raw.fields ?? {}
    return {
      id: raw.id,
      title: String(fields['System.Title'] ?? `Work item ${raw.id}`),
      type: String(fields['System.WorkItemType'] ?? 'Task'),
      state: String(fields['System.State'] ?? ''),
      assignedTo: identityName(fields['System.AssignedTo']),
      remainingWork: Number(fields['Microsoft.VSTS.Scheduling.RemainingWork'] ?? 0),
      originalEstimate: numberOrUndefined(fields['Microsoft.VSTS.Scheduling.OriginalEstimate']),
      completedWork: numberOrUndefined(fields['Microsoft.VSTS.Scheduling.CompletedWork']),
      parentId: typeof fields['System.Parent'] === 'number' ? fields['System.Parent'] : undefined,
      tfsTags: tagsOf(fields['System.Tags']),
      areaPath: stringOrUndefined(fields['System.AreaPath']),
      iterationPath: stringOrUndefined(fields['System.IterationPath']),
      businessOrder: this.orderField ? numberOrUndefined(fields[this.orderField]) : undefined,
      // The API's own `url` points back at the REST endpoint; this one opens the web UI.
      url: `${this.target.projectBase}/_workitems/edit/${raw.id}`
    }
  }

  /**
   * Issues one request, retrying once with `-preview` appended if the server asks for it.
   *
   * Older TFS marks some endpoints as preview-only at a given version and answers a plain
   * `api-version=3.0` with a 400 naming `3.0-preview`. Which endpoints those are varies by
   * install, so rather than guessing up front we take the server at its word when it tells us.
   */
  private async request<T>(
    url: string,
    version: string,
    body?: string,
    options: RequestOptions = {}
  ): Promise<T> {
    try {
      const result = await this.send<T>(url, version, body, options)
      this.lastWorkingVersion = version
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      const wantsPreview = message.includes('-preview') || message.includes('preview flag')
      if (!wantsPreview || version.includes('-preview')) throw error

      const previewVersion = `${version}-preview`
      const result = await this.send<T>(url, previewVersion, body, options)
      this.lastWorkingVersion = previewVersion
      return result
    }
  }

  /** The version that actually produced a response, which may carry a `-preview` suffix. */
  private lastWorkingVersion: string | undefined

  private async send<T>(
    url: string,
    version: string,
    body?: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const separator = url.includes('?') ? '&' : '?'
    const method = options.method ?? (body ? 'POST' : 'GET')
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body) headers['Content-Type'] = options.contentType ?? 'application/json'
    if (this.credentials.mode === 'pat') {
      if (!this.credentials.pat) {
        throw new TfsError('No personal access token is configured. Add one in Settings.')
      }
      headers['Authorization'] =
        'Basic ' + Buffer.from(`:${this.credentials.pat}`, 'utf8').toString('base64')
    }

    let response: Response
    try {
      response = await net.fetch(`${url}${separator}api-version=${version}`, {
        method,
        headers,
        body,
        credentials: 'include'
      })
    } catch (error) {
      throw new TfsError(
        `Could not reach ${this.target.host}. ${(error as Error).message}\n` +
          'Check the URL, your VPN, and whether the server uses a certificate this machine ' +
          'does not trust yet.'
      )
    }

    if (response.status === 401 || response.status === 403) {
      throw new TfsError(
        method !== 'GET' && response.status === 403
          ? 'TFS did not allow this change (403). Creating tasks needs a token with Work Items ' +
              '(Read & Write), and permission to add work items in this project.'
          : this.credentials.mode === 'pat'
            ? 'TFS rejected the personal access token (401). Check that it has not expired and ' +
              'that it grants Work Items (Read), or Read & Write to create tasks.'
            : 'TFS rejected your Windows credentials (401). Try a personal access token instead.'
      )
    }

    // Checked before the content type: a server that does not route this method may answer
    // with an HTML error page, and that is a reason to try the other method, not a sign-in page.
    if (method !== 'GET' && (response.status === 404 || response.status === 405)) {
      throw new MethodRefused(`${method} was refused with ${response.status}.`)
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      // A sign-in page comes back as HTML with a 200, which would otherwise parse as garbage.
      throw new TfsError(
        `${this.target.host} answered with a web page instead of data, which usually means ` +
          'the request was not authenticated. Check the token or switch the authentication mode.'
      )
    }

    if (!response.ok) {
      const detail = await response
        .json()
        .then((body) => (body as { message?: string }).message)
        .catch(() => undefined)
      if (response.status === 400 && detail?.includes('version')) {
        throw new TfsError(`API version ${version} not supported: ${detail}`)
      }
      throw new TfsError(detail ?? `TFS returned ${response.status} ${response.statusText}.`)
    }

    return (await response.json()) as T
  }
}

interface RawIdentity {
  id?: string
  displayName?: string
  uniqueName?: string
  isContainer?: boolean
}

/**
 * Whether an identity is a group. Newer servers say so; older ones only give it away in the
 * name, which for a group is `[Project]\Group` or a `vstfs:` address rather than an account.
 */
function isGroup(identity: RawIdentity): boolean {
  if (identity.isContainer) return true
  const name = identity.uniqueName?.trim() ?? ''
  return name.startsWith('[') || name.toLowerCase().startsWith('vstfs:')
}

/** A write method this server does not route, so the other one is worth trying. */
class MethodRefused extends TfsError {}

/** Whether this API version creates work items with POST, as 4.1 and later do. */
function modernCreate(version: string): boolean {
  const [major, minor] = version.split('-')[0].split('.').map(Number)
  return major > 4 || (major === 4 && (minor ?? 0) >= 1)
}

/** `System.Tags` is one string, `a; b; c`. */
function tagsOf(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  return value
    .split(';')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

interface QueryResult {
  workItems?: Array<{ id: number }>
  workItemRelations?: Array<{ target?: { id: number } }>
}

/** Flat queries return `workItems`; tree and one-hop queries return `workItemRelations`. */
function idsFromQueryResult(result: QueryResult): number[] {
  if (result.workItems?.length) return result.workItems.map((item) => item.id)
  const ids = (result.workItemRelations ?? [])
    .map((relation) => relation.target?.id)
    .filter((id): id is number => typeof id === 'number')
  return [...new Set(ids)]
}

/** `System.AssignedTo` is a string on older servers and an identity object on newer ones. */
/**
 * Finds the Business Order field among everything a work item carries.
 *
 * Its reference name varies by server, because it is a customisation rather than a field
 * Microsoft ships — `Custom.BusinessOrder` on one collection, `CMF.Business Order` on
 * another. Comparing on letters and digits alone catches every spelling of it.
 */
function detectBusinessOrder(items: RawWorkItem[]): string | undefined {
  for (const item of items) {
    for (const name of Object.keys(item.fields ?? {})) {
      if (compact(name).endsWith('businessorder')) return name
    }
  }
  return undefined
}

function compact(value: string): string {
  return value
    .normalize('NFD')
    .replace(new RegExp('[\u0300-\u036f]', 'g'), '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/** Absent and zero are different things here: absent means the server does not track it. */
function numberOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function identityName(value: unknown): string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') return value.replace(/\s*<[^>]*>\s*$/, '').trim()
  const identity = value as { displayName?: string; uniqueName?: string }
  return identity.displayName ?? identity.uniqueName
}

function escape(value: string): string {
  return value.replace(/'/g, "''")
}

/**
 * Pulls the highest version a server says it supports out of its rejection message, e.g.
 * "…is out of range for this collection. Supported versions: 1.0 to 3.2" yields "3.2".
 * The version we asked for appears in the same sentence, so it is excluded.
 */
function supportedCeiling(message: string): string | undefined {
  const asked = message.match(/API version (\d+(?:\.\d+)?)/)?.[1]
  const mentioned = [...message.matchAll(/(?:up to|between|to|and|is)\s+(\d+\.\d+)/gi)]
    .map((match) => match[1])
    .filter((version) => version !== asked)
  if (mentioned.length === 0) return undefined

  return mentioned.sort(compareVersions).pop()
}

function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor] = a.split('.').map(Number)
  const [bMajor, bMinor] = b.split('.').map(Number)
  return aMajor - bMajor || (aMinor ?? 0) - (bMinor ?? 0)
}

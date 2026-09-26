/**
 * Parses the URL a user copies out of the TFS web UI.
 *
 * On-prem installs sit under a virtual directory (`https://host/tfs/Collection/Project/…`)
 * while hosted ones do not (`https://dev.azure.com/org/Project/…`), so rather than assume a
 * fixed depth the parser splits on the first route segment — every TFS web route starts with
 * an underscore (`_queries`, `_boards`, `_sprints`, `_workitems`).
 */

export type TfsSource =
  | { kind: 'query'; queryId: string }
  | { kind: 'iteration'; iterationPath: string }
  | { kind: 'project' }

export interface ParsedTfsUrl {
  /** Origin plus virtual directory plus collection, e.g. `https://host/tfs/Collection`. */
  collectionBase: string
  /** Collection base plus project, e.g. `https://host/tfs/Collection/MyProject`. */
  projectBase: string
  collection: string
  project?: string
  team?: string
  host: string
  source: TfsSource
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class TfsUrlError extends Error {}

export function parseTfsUrl(input: string): ParsedTfsUrl {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new TfsUrlError('That is not a valid URL. Paste the address straight from TFS.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TfsUrlError('The URL must start with http:// or https://.')
  }

  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const routeIndex = segments.findIndex((segment) => segment.startsWith('_'))
  const before = routeIndex === -1 ? segments : segments.slice(0, routeIndex)
  const route = routeIndex === -1 ? [] : segments.slice(routeIndex)

  if (before.length === 0) {
    throw new TfsUrlError(
      'The URL is missing the collection and project. It should look like ' +
        'https://server/tfs/Collection/Project/_queries/query/<id>.'
    )
  }

  // With a project segment the last entry before the route is the project; without one the
  // URL only identifies a collection and we cannot scope a query to a project.
  const hasProject = before.length >= 2
  const project = hasProject ? before[before.length - 1] : undefined
  const collection = hasProject ? before[before.length - 2] : before[before.length - 1]
  const collectionSegments = hasProject ? before.slice(0, -1) : before

  const collectionBase = `${url.origin}/${collectionSegments.join('/')}`
  const projectBase = project ? `${collectionBase}/${encodeURIComponent(project)}` : collectionBase

  return {
    collectionBase,
    projectBase,
    collection,
    project,
    team: teamFrom(route),
    host: url.host,
    source: sourceFrom(route, url, project)
  }
}

function sourceFrom(route: string[], url: URL, project: string | undefined): TfsSource {
  const [head, ...rest] = route

  if (head === '_queries') {
    // .../_queries/query/<guid>, .../_queries/query-edit/<guid>, or ...?id=<guid>
    const fromPath = rest.find((segment) => GUID.test(segment))
    const fromSearch = url.searchParams.get('id')
    const queryId = fromPath ?? (fromSearch && GUID.test(fromSearch) ? fromSearch : undefined)
    if (!queryId) {
      throw new TfsUrlError(
        'That query URL has no query id in it. Open the query in TFS and copy the address ' +
          'while the query itself is selected.'
      )
    }
    return { kind: 'query', queryId }
  }

  if (head === '_sprints') {
    // .../_sprints/taskboard/<team>/<project>/<iteration...>
    const iteration = rest.slice(3)
    if (iteration.length > 0 && project) {
      return { kind: 'iteration', iterationPath: [project, ...iteration].join('\\') }
    }
  }

  if (head === '_backlogs' || head === '_boards' || head === '_workitems' || route.length === 0) {
    return { kind: 'project' }
  }

  return { kind: 'project' }
}

function teamFrom(route: string[]): string | undefined {
  // _boards/board/t/<team>/<backlog> and _sprints/taskboard/<team>/…
  if (route[0] === '_boards' && route[1] === 'board' && route[2] === 't') return route[3]
  if (route[0] === '_sprints') return route[2]
  if (route[0] === '_backlogs' && route[1] === 'backlog') return route[2]
  return undefined
}

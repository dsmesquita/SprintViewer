import type { TaskTemplate } from './taskCreation'
import type { Member } from './types'

/** How the app authenticates against TFS. */
export type AuthMode = 'pat' | 'windows'

/** When to fetch the child tasks of the User Stories and Bugs a query returns. */
export type ChildQueryMode = 'auto' | 'always' | 'never'

/**
 * Settings as the renderer sees them. The PAT itself is never in here — only whether one
 * is stored and the tail end of it, so the settings panel can show what is configured
 * without the secret ever crossing the IPC boundary.
 */
export interface AppSettings {
  authMode: AuthMode
  hasPat: boolean
  /** Masked form of the stored PAT, e.g. "••••••••a3f9". */
  patHint?: string
  /** Collection URL the last import used, prefilled into the Start sprint dialog. */
  lastQueryUrl?: string
  /** REST API version negotiated with the server, cached so later calls skip the probe. */
  apiVersion?: string
  /**
   * Hosts whose TLS certificate the user has explicitly chosen to trust. On-prem servers
   * often present an internal CA that Windows knows and Chromium does not.
   */
  trustedHosts: string[]
  /** The team roster: one calendar row per member, in order. */
  members: Member[]
  hoursPerDay: number
  activeSprintId?: string
  /**
   * Reference name of the Business Order field, which auto-assign sorts by. Detected from
   * the server on the first import and remembered; set by hand to point at a field named
   * something else, or cleared to skip that sorting step entirely.
   */
  businessOrderField?: string
  /**
   * When a TFS query returns only container types (Bugs/User Stories), whether to
   * automatically fetch their child tasks. `auto` does it silently when all results are
   * containers; `always` always fetches children; `never` skips it.
   */
  childQueryMode?: ChildQueryMode
  /**
   * Who DOC tasks made by the task-creation dialog go to: a team member's id, or a TFS
   * account (`DOMAIN\user`) for someone off the team. None leaves them unassigned.
   */
  docOwner?: string
  /** The same, for QA tasks. */
  qaOwner?: string
  /** Templates the task-creation dialog offers. Absent means the built-in ones. */
  taskTemplates?: TaskTemplate[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  authMode: 'pat',
  hasPat: false,
  trustedHosts: [],
  members: [],
  hoursPerDay: 8
}

/** Fields the renderer is allowed to write. Notably absent: anything to do with the PAT. */
export type WritableSettings = Partial<
  Pick<
    AppSettings,
    | 'authMode'
    | 'lastQueryUrl'
    | 'trustedHosts'
    | 'members'
    | 'hoursPerDay'
    | 'activeSprintId'
    | 'apiVersion'
    | 'businessOrderField'
    | 'childQueryMode'
    | 'docOwner'
    | 'qaOwner'
    | 'taskTemplates'
  >
>

export interface ConnectionResult {
  ok: boolean
  message: string
  /** Identity TFS reports for the credentials, so the user can confirm who they are. */
  user?: string
  apiVersion?: string
}

export interface StartSprintRequest {
  name: string
  startDate: string
  weeks: number
  includeWeekends: boolean
  queryUrl: string
}

export interface SprintSummary {
  id: string
  name: string
  startDate: string
  endDate: string
}

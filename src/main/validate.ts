import type { WritableSettings } from '@shared/settings'
import { parseTags, type TaskDraft } from '@shared/taskCreation'

/**
 * Checking what the renderer sends before the main process acts on it. The renderer is trusted
 * to be our own code, but a patch or a draft is still data crossing a boundary: only known
 * fields, in the types they should be, get through.
 */

/**
 * Whitelists the settings the renderer may write. Without this an `Object.assign` of the
 * incoming patch could overwrite the encrypted token with an attacker-chosen value.
 */
export function writable(patch: WritableSettings): WritableSettings {
  const allowed: WritableSettings = {}
  if (patch.authMode === 'pat' || patch.authMode === 'windows') allowed.authMode = patch.authMode
  if (typeof patch.lastQueryUrl === 'string') allowed.lastQueryUrl = patch.lastQueryUrl
  if (Array.isArray(patch.trustedHosts)) allowed.trustedHosts = patch.trustedHosts.map(String)
  if (Array.isArray(patch.members)) allowed.members = patch.members
  if (typeof patch.hoursPerDay === 'number') allowed.hoursPerDay = patch.hoursPerDay
  if (typeof patch.activeSprintId === 'string') allowed.activeSprintId = patch.activeSprintId
  // An empty string clears the pin and puts negotiation back in charge.
  if (typeof patch.apiVersion === 'string') allowed.apiVersion = patch.apiVersion || undefined
  if (typeof patch.businessOrderField === 'string') {
    allowed.businessOrderField = patch.businessOrderField || undefined
  }
  if (
    patch.childQueryMode === 'auto' ||
    patch.childQueryMode === 'always' ||
    patch.childQueryMode === 'never'
  ) {
    allowed.childQueryMode = patch.childQueryMode
  }
  // An empty string clears the owner, so the tasks are created unassigned.
  if (typeof patch.docOwner === 'string') allowed.docOwner = patch.docOwner || undefined
  if (typeof patch.qaOwner === 'string') allowed.qaOwner = patch.qaOwner || undefined
  if (Array.isArray(patch.taskTemplates)) {
    allowed.taskTemplates = patch.taskTemplates
      .filter((template) => template && typeof template.name === 'string')
      .map((template) => ({
        name: String(template.name),
        prefixes: Array.isArray(template.prefixes) ? template.prefixes.map(String) : []
      }))
  }
  return allowed
}

/**
 * Only the fields a draft may carry, in the types the client expects. Nothing is dropped:
 * failures are reported by position, so the list has to keep the renderer's order. A blank
 * title is refused by TFS and comes back as a failure like any other.
 */
export function sanitiseDrafts(drafts: TaskDraft[]): TaskDraft[] {
  if (!Array.isArray(drafts)) return []
  return drafts.map((draft) => ({
    title: String(draft?.title ?? '').trim(),
    assignedTo:
      typeof draft?.assignedTo === 'string' && draft.assignedTo.trim()
        ? draft.assignedTo.trim()
        : undefined,
    estimate: Number.isFinite(Number(draft?.estimate)) ? Math.max(0, Number(draft.estimate)) : 0,
    tags: Array.isArray(draft?.tags)
      ? parseTags(draft.tags.map((tag) => String(tag)).join(';'))
      : undefined
  }))
}

/** `value` as an `http:` or `https:` address, or `null` for anything else. */
export function webUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

import type { ChildQueryMode } from '@shared/settings'
import type { PlanSettings } from '@shared/sprintSettings'
import { isIdentity, normaliseIdentity, OTHER_OWNER } from '@shared/taskCreation'
import type { Member } from '@shared/types'

/**
 * The settings both tabs of the Settings dialog have — the app's defaults and the open sprint's
 * own copy — as they are edited: owners as the list's choice plus the typed account, and
 * template prefixes as the text typed, split only on save so a half-typed "DEV, " keeps its
 * comma under the cursor.
 */
export interface PlanForm {
  queryUrl: string
  hoursPerDay: number
  members: Member[]
  childQueryMode: ChildQueryMode
  docOwner: string
  docOther: string
  qaOwner: string
  qaOther: string
  templates: Array<{ name: string; prefixes: string }>
}

export function formOf(plan: PlanSettings): PlanForm {
  return {
    queryUrl: plan.queryUrl,
    hoursPerDay: plan.hoursPerDay,
    members: plan.members.map((member) => ({ ...member })),
    childQueryMode: plan.childQueryMode,
    docOwner: ownerChoice(plan.docOwner),
    docOther: isIdentity(plan.docOwner) ? plan.docOwner : '',
    qaOwner: ownerChoice(plan.qaOwner),
    qaOther: isIdentity(plan.qaOwner) ? plan.qaOwner : '',
    templates: plan.taskTemplates.map((template) => ({
      name: template.name,
      prefixes: template.prefixes.join(', ')
    }))
  }
}

/** A copy of a form, so filling one tab from the other never shares a list between them. */
export function copyForm(form: PlanForm): PlanForm {
  return {
    ...form,
    members: form.members.map((member) => ({ ...member })),
    templates: form.templates.map((template) => ({ ...template }))
  }
}

/** What a form saves as: unnamed people and templates dropped, owners resolved. */
export function planOf(form: PlanForm): PlanSettings {
  const members = form.members
    .filter((member) => member.name.trim().length > 0)
    .map((member, order) => ({ ...member, name: member.name.trim(), order }))
  // An owner who was just removed from the rows is nobody's owner any more.
  const owner = (choice: string, other: string): string =>
    choice === OTHER_OWNER
      ? (normaliseIdentity(other) ?? '')
      : members.some((member) => member.id === choice)
        ? choice
        : ''
  return {
    queryUrl: form.queryUrl.trim(),
    hoursPerDay: form.hoursPerDay,
    members,
    childQueryMode: form.childQueryMode,
    docOwner: owner(form.docOwner, form.docOther),
    qaOwner: owner(form.qaOwner, form.qaOther),
    taskTemplates: form.templates
      .map((template) => ({
        name: template.name.trim(),
        prefixes: template.prefixes
          .split(',')
          .map((prefix) => prefix.trim())
          .filter(Boolean)
      }))
      .filter((template) => template.name.length > 0 && template.prefixes.length > 0)
  }
}

/** Stable, readable id that survives a rename of the person. */
export function uniqueId(prefix: string, existing: Member[]): string {
  let index = existing.length + 1
  while (existing.some((member) => member.id === `${prefix}-${index}`)) index++
  return `${prefix}-${index}`
}

/** The owner list's value for a saved owner: a member id as it is, an account as "someone else". */
function ownerChoice(saved: string): string {
  if (!saved) return ''
  return isIdentity(saved) ? OTHER_OWNER : saved
}

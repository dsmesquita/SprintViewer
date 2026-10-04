/**
 * Filling the calendar in one pass.
 *
 * TFS already knows who owns each task and roughly how important it is, so the sweep through
 * the backlog is mostly mechanical: attribute, order, and pour into whatever room each person
 * has left. Two kinds of task get more care than that. Meetings are spread over the sprint
 * rather than landing in one lump, and validation starts the hour its development ends,
 * whoever is doing each.
 *
 * What it deliberately does not do is guess. A task TFS attributes to nobody stays in the
 * backlog, nobody is pushed past the hours they actually have, and anything already on a
 * calendar is only ever moved with the user's say-so — the plan reports what it would disturb.
 */

export { isChainedVal, isMeeting, isSpike } from './kinds'
export { meetingPieces, spreadDays } from './meetings'
export { compareForAssignment, ownerOf } from './ordering'
export { planAutoAssign } from './plan'
export type { AssignOptions, AssignPlan, AssignRule, AssignSummary, BaseChange } from './types'
export { valWarnings } from './valChain'

/**
 * The layout engine.
 *
 * Placements are stored as an *ordered queue of blocks per person*, never as fixed
 * (day, hour) coordinates. This module flows those queues across the sprint's working
 * days, which is what makes a refresh cheap: change a block's hours and re-flow, and
 * everything after it shifts right — across day boundaries — on its own.
 *
 * Days before the anchor (normally today) are not flowed. They show what was actually worked:
 * the recorded past (`sprint.pastRecord`), plus any hours TFS reports that are not on it yet,
 * placed in the oldest free space. Sprints never refreshed under that rule replay their older
 * plan snapshots (`sprint.history`) instead.
 *
 *   capacity.ts   hours a person has on a day
 *   intervals.ts  taken time and the gaps in a day
 *   layout.ts     one person's queue flowed across the sprint; the whole board
 *   reported.ts   hours reported as done, drawn before the anchor
 *   record.ts     the recorded past, as it should be drawn now
 *   freeze.ts     writing the past down at a refresh
 *   queries.ts    where a drop lands and what it lands on; small block helpers
 */

export { effectiveCapacity, isDayDisabledForAll } from './capacity'
export { freezeHistoryBefore, recordPast } from './freeze'
export { layoutMember, layoutSprint, type MemberLayout } from './layout'
export {
  anchorFor,
  landsInside,
  occupantAt,
  placedHours,
  splitBlock,
  type Occupant
} from './queries'
export { liveRecord } from './record'

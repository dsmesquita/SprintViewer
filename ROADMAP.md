# Roadmap

Everything asked for so far is built. See the table in [README.md](README.md).

Ideas raised but not asked for, kept so they are not lost:

- **Redo.** There is undo but no redo. A redo stack that quietly diverges from the undo stack
  is worse than not having one, so it needs thinking about rather than adding.
- **Tag filter on the calendar as well as the backlog.** The chips filter the backlog only.
  Hiding tags on the grid would leave gaps where work actually sits, which reads as a
  scheduling error rather than a filter, so it would want dimming rather than hiding.
- **Importing a snapshot from a file.** They can be exported, but not read back in — only the
  ones the app stored itself are listed.
- **A task with no hours anywhere.** No estimate, nothing reported, nothing remaining: it has
  no size, so it cannot be drawn or dragged. A manual time now gives it one, which covers most
  of this, but such a task still cannot be dragged until somebody sets that time.
- **Auto-assign across people.** It only places work TFS already attributes to somebody.
- **Spillover wording.** The tooltip reads `Spillover: 5h`; the original brief said
  "Spillover: X hours". Left short to match the rest of the UI.

## Found while writing the tests

Pinned down as they behave today, so the refactor cannot change them by accident. Each is a
decision for later, not a bug fix slipped in.

- **Name matching is loose.** `sameName` treats two people as the same when they share only a
  first _or_ a last name ("Diogo Mesquita" and "Diogo Silva"). Fine for a squad with distinct
  names; wrong for one with two Diogos. See `src/shared/__tests__/people.test.ts`.
- **A pin on a day that left the sprint keeps its hour.** Pinned at 17:00 on a day no longer
  in the sprint, a block lands at 17:00 on the next sprint day, not at its start.
- ~~`sizing.totalHours` unused~~ — removed in the refactor.
- ~~Three React hook-dependency warnings~~ — fixed or marked deliberate in the refactor; lint
  now fails on any warning.

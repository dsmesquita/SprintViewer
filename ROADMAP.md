# Roadmap

Everything asked for so far is built; what the app does is described in its Read me (Settings →
Read me).

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
- ~~Locking a day split blocks that never reached it~~ — found by the end-to-end drag tests,
  fixed after 1.3.1: only a block running into the locked day is cut, where that day starts.
- ~~`sizing.totalHours` unused~~ — removed in the refactor.
- ~~Three React hook-dependency warnings~~ — fixed or marked deliberate in the refactor; lint
  now fails on any warning.

## Gaps in the tests

Known and accepted for now; each says what closing it would take.

- **`MeasuringStrategy.Always` is not proven necessary.** It was the fix for drags sticking to
  the row they started on. With the rows memoised, switching back to `WhileDragging` breaks no
  test — including a mid-drag scroll tried on purpose. Keep it (it is harmless); if the old bug
  comes back, reproduce it in `e2e/drag.spec.ts` first.
- **Clicking a work item link.** Links open through `shell.openExternal` in the preload, which a
  test cannot replace, so a click would open the real browser. Only the main process's handler
  for new windows is tested (`e2e/window.spec.ts`). Routing links through an IPC call to main
  would make them testable.
- **The trusted-certificate setting.** `installCertificatePolicy` in `src/main/index.ts` has no
  test: it needs an HTTPS fake TFS with a certificate Windows does not trust.
- **Dates in the non-drag end-to-end tests** follow the real clock, so they check what is
  drawn, not where. Placement against fixed dates is covered by the unit tests and by
  `e2e/drag.spec.ts`, which fixes the clock.

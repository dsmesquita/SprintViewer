# AGENTS.md — working on Sprint Viewer

Context for coding agents (and people) picking this project up. Keep it short and true: if you
change something described here, update this file in the same commit.

## What the app is

A Windows desktop app (Electron + React + TypeScript) for planning a sprint as a calendar:
one row per team member, one column per working day cut into hours, and every TFS task a block
that can be dragged. Work items come from a TFS / Azure DevOps Server query. The app **reads**
TFS and writes to it in exactly **one** place: creating Tasks under a User Story or Bug.
Everything else (placements, notes, snapshots, settings) is plain JSON in
`%APPDATA%\SprintViewer` (`settings.json`, `sprints/<id>.json`, `snapshots/<sprintId>/`).
The PAT is encrypted with Windows DPAPI (`safeStorage`) and never sent back to the renderer.

User-facing documentation lives **in the app**: `src/renderer/src/components/HelpDialog.tsx`
(Settings → Read me). When you change a behaviour a user can see, update that too.

## Commands

- `npm install` — dependencies (Node 18+).
- `npm run dev` — the real Electron app, with hot reload.
- `npm run dev:web` — renderer only, in a browser at **http://localhost:5178**
  (`.claude/launch.json` → `sprint-viewer-web`). `window.api` is absent, so anything that needs
  TFS or disk is inert; click **Load sample data** for a full mid-sprint board
  (`src/shared/mock.ts`).
- `npm test` — all tests once (Vitest). `npm run test:watch` while working;
  `npm run coverage` writes `coverage/index.html`.
- `npm run lint` / `npm run format` (Prettier, writes) / `npm run format:check`.
- `npm run typecheck` — `tsc` over the main, renderer and test projects.
- **`npm run check`** — typecheck + lint + format check + tests. **Must be green before every
  commit.**
- `npm run build` — typecheck + `electron-vite build` into `out/`.
- `npm run dist` — `check`, build, then `electron-builder --win` →
  `release/Sprint Viewer <version> Setup.exe` (unsigned; SmartScreen warns).

A release is: bump `version` in `package.json`, then `npm run dist`. Version bumps are the
owner's call.

## Tests

- They live next to the code: `src/shared/__tests__/`, `src/main/__tests__/`, and later
  `src/renderer/src/**/__tests__/` (`*.test.tsx` runs in jsdom; everything else in Node).
- Electron is never loaded. `test/setup.ts` swaps it for `test/electron.ts`: a temp
  `userData` folder, captured IPC `handlers` (call a route with `invoke(channel, ...args)`),
  and a fake TFS server (`setServer((request) => json(200, {...}))`, requests recorded in
  `requests`). Import those helpers from `test/electron`, not from `'electron'`.
- Shared helpers: `test/fixtures.ts` (sprint/item/block builders, a two-week sprint from Mon
  14 Sep 2026, `drawn()` to read a person's calendar as strings), `test/fakeApi.ts`
  (`installFakeApi()` puts typed `vi.fn` mocks on `window.api` for store and component tests).
- Component tests (`*.test.tsx`) use Testing Library; wrap anything using dnd-kit hooks in a
  `DndContext`. Drags themselves are not simulated — test the drop logic as a function.
- Two styles. Standalone behaviour: plain `describe` / `it` / `expect`. Long step-by-step
  scenarios (refresh on Wednesday, then Thursday…): `checklist()` from `test/checklist.ts` —
  `check(name, ok, detail)` at each step, `report()` at the end turns each into a test. The
  suites that predate the runner use this form; don't rewrite their assertions.
- `test/**` and `__tests__` may use `any` for fake TFS JSON; nothing else may.

## Map

```
src/main/          Electron main process
  index.ts           windows (main + read-only snapshot windows)
  ipc.ts             every ipcMain.handle route, input sanitising, startSprint, notes export
  storage.ts         JSON files on disk, settings + encrypted PAT, snapshots, the auto baseline
  tfs/client.ts      TFS REST client: WIQL, work item batches, child tasks, createTasks, teams
  tfs/url.ts         parses a query / sprint URL into server, collection, project, team
src/preload/       the ONLY bridge: exposes `window.api` (typed in index.ts / index.d.ts)
src/shared/        pure domain logic — no React, no Electron, no DOM, no zustand
  types.ts           Sprint, Block, WorkItem, Segment, Member, Note… (start here)
  scheduling.ts      the layout engine: queues → segments, reported hours, past record
  mutations.ts       pure (Sprint) → Sprint transforms used by the store
  refresh.ts         reconciling a sprint with fresh TFS items
  sizing.ts          how big a task is (Remaining + Completed), off-track rule
  autoAssign.ts      auto-assign planner (ordering, meetings, VAL after DEV, late VAL)
  sprintSummary.ts   Markdown sprint summary for an AI write-up
  snapshots.ts, baseline.ts, notes.ts, squad.ts, taskCreation.ts, tags.ts, grouping.ts,
  nudge.ts, customHours.ts, pastFit.ts, assignment.ts, dates.ts, text.ts, settings.ts
  mock.ts            the sample sprint (also a handy test fixture)
src/renderer/src/  React UI
  App.tsx            composition root, toolbar, drag & drop (dnd-kit), context menus
  store.ts           zustand store `useApp`: sprint, undo stack, dialogs, panel, zoom
  components/        SprintGrid, SidePanel (Backlog/Person/Task tabs), dialogs, HelpDialog
  grid.ts            drag data types and hour-width zoom steps
  styles.css         all styles; colour tokens on :root with a dark-mode block
```

## Core concepts (read before touching scheduling)

- **Queue, not coordinates.** Each member has an ordered queue of `Block`s (`sprint.queues`).
  The engine flows the queue across working days from the **anchor**; nothing stores a
  (day, hour) except pins. Change a block's hours and everything after it re-flows.
- **Anchor** = the first sprint day at or after today (`anchorFor`). Unpinned work never goes
  before it.
- **Pin** (`block.pin`) = "start no earlier than this slot". Pinned blocks are placed first;
  unpinned ones flow around them. A drop on today or earlier pins; a drop later inserts into
  the queue.
- **Size of a task** = Remaining Work + Completed Work (`sizing.ts`). Original Estimate is
  only used by the summary for "off track" (completed > estimate × 1.25).
- **Remaining is drawn from today on; Completed is drawn behind today** (striped `isDone`
  segments). If the past is full, reported hours spill onto the start of today and push
  today's plan along. A task with nothing left has no block at all.
- **The past is a record** (`sprint.pastRecord`). Each refresh saves what the days behind
  today show; later refreshes never move it and only add new Completed hours into free space,
  **oldest gap first**. Lowered Completed trims the most recent recorded hours. Sprints
  without a record fall back to the legacy `history` snapshots.
- **Reported pins** (`sprint.reportedPins`) = the user dragged a task's done hours to where
  they were really worked; they overrule the record for that task.
- **Custom hours** (`sprint.customHours`) = a manual size overruling TFS; a refresh that
  disagrees stops and asks (`RefreshHoursDialog`).
- **Undo**: every board change goes through `mutate(transform, label)` in `store.ts`, which
  pushes onto a 50-deep undo stack and persists. Don't `set({ sprint })` directly for board
  changes.
- **Refresh** only fetches in main; reconciliation (`applyRefresh`) runs in the renderer.
  Child tasks are only imported when they share their parent's iteration.
- **Auto-assign** places backlog tasks on their TFS assignee's row: meetings spread over the
  sprint (never on the planning day), VAL starts when its sibling DEV ends, or as late as the
  sprint allows if that is too late. "Keep my calendar fixed" is a second plan that moves
  nothing already placed.

## Rules

- **Commits are the repo owner's.** Commit with the identity in `git config` (Diogo Mesquita).
  No `Co-Authored-By` or other AI attribution trailers, no `--author` overrides.
- Keep `src/shared` pure and framework-free; put new domain logic there so it can be tested
  in Node. Transforms return a new `Sprint` (return the **same object** for "no change" —
  the store treats that as a no-op).
- The renderer reaches disk/network only through `window.api` (preload). New IPC = a handler
  in `ipc.ts`, a method in `src/preload/index.ts`, and input sanitising in main.
- Never add a second TFS write path without the owner asking for it.
- Every behaviour change comes with a test; every user-visible one with a Read me update.
- Formatting is Prettier's (`npm run format`); lint is ESLint. ESLint also enforces the
  layering — `src/shared` importing React/Electron/Node, or the renderer importing Electron,
  is an error.
- Match the house style: TypeScript strict, no semicolons, single quotes, 2-space indent,
  ~100 columns. Comments explain **why**, in plain sentences; don't narrate the code.
- Colours come from CSS tokens on `:root` (with dark-mode values) — no hard-coded colours.

## Gotchas

- **dnd-kit**: spreading `{...listeners}` and then setting your own `onPointerDown` silently
  kills dragging — call `listeners.onPointerDown?.(event)` inside yours. Keep
  `MeasuringStrategy.Always` on the `DndContext` (WhileDragging caused a mis-measure bug).
- **Preview == drop**: the drag preview and the drop both go through `applyDrop` in `App.tsx`;
  change one, you change both. Keep it that way.
- **dev:web + HMR**: when poking the store from the browser console/tests, import the module
  URL the page actually loaded, or you get a second store instance.
- **Windows shells** mangle backslashes in heredocs (`CMF\bsrocha` → `CMFbsrocha`). Write files
  with an editor/tool, not `cat <<EOF`, when they contain backslashes.
- TFS identities look like `Display Name <DOMAIN\user>`; `taskCreation.normaliseIdentity`
  accepts `user`, `DOMAIN\user`, `<DOMAIN\user>` and the full form (default domain `CMF`).
- Old sprint files must keep loading: new `Sprint` fields are optional, and migrations run
  when a sprint is opened (`opened()` in `store.ts`).

## Verifying a change

1. `npm run check`.
2. UI: `npm run dev:web` → **Load sample data** → exercise the change → no console errors.
3. Anything behind `window.api` (TFS, files, snapshots windows): `npm run dev`.

## Planned refactor

A behaviour-preserving cleanup is under way. Done: git, Vitest with the old suites, ESLint +
Prettier, and tests for everything that was not covered (logic, main process, store,
components — ~500 tests; `src/shared` and `src/main` above 85% line coverage). Next: splitting
`scheduling.ts`, `autoAssign.ts`, `App.tsx`, `SidePanel.tsx`, `store.ts` and `styles.css` into
folders, de-duplicating helpers (`round`/`clamp`, block-list helpers), and retiring the legacy
`history` drawing path. Behaviour the tests pinned down but that may deserve a decision is
listed at the end of `ROADMAP.md`. If the folders above have already moved, trust the
tree over this file — and fix this file.

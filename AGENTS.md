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

| Command | What it does |
|---|---|
| `npm install` | Dependencies (Node 18+) |
| `npm run dev` | The real Electron app with hot reload |
| `npm run dev:web` | Renderer only, in a browser at **http://localhost:5178** (`.claude/launch.json` → `sprint-viewer-web`). `window.api` is absent, so anything that needs TFS or disk is inert — click **Load sample data** to get a full mid-sprint board (`src/shared/mock.ts`). |
| `npm run typecheck` | `tsc` over both projects (`tsconfig.node.json`, `tsconfig.web.json`) |
| `npm run build` | typecheck + `electron-vite build` into `out/` |
| `npm run dist` | build + `electron-builder --win` → `release/Sprint Viewer <version> Setup.exe` (unsigned; SmartScreen warns) |

A release is: bump `version` in `package.json`, `npm run dist`. Version bumps are the owner's call.

> **Tests.** An automated suite exists (≈230 checks) but is being moved into the repo as Vitest
> (`npm test`, `npm run check`) — see the refactor plan below. Until those scripts exist,
> `npm run typecheck` plus a `dev:web` check is the bar. Once they exist: **`npm run check` must
> be green before every commit.**

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

1. `npm run typecheck` (and `npm run check` once it exists).
2. UI: `npm run dev:web` → **Load sample data** → exercise the change → no console errors.
3. Anything behind `window.api` (TFS, files, snapshots windows): `npm run dev`.

## Planned refactor

A behaviour-preserving cleanup is planned: tests into the repo (Vitest + Testing Library),
ESLint/Prettier, then splitting `scheduling.ts`, `autoAssign.ts`, `App.tsx`, `SidePanel.tsx`,
`store.ts` and `styles.css` into folders, de-duplicating helpers (`round`/`clamp`, block-list
helpers), and retiring the legacy `history` drawing path. If the folders above have already
moved, trust the tree over this file — and fix this file.

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
- `npm run test:e2e` — builds, then runs the end-to-end tests (Playwright driving the real
  Electron app). Not part of `check`: it opens windows and takes longer.
- `npm run dist` — `check`, build, end-to-end tests, then `electron-builder --win` →
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
  `DndContext`. jsdom has no layout, so dnd-kit cannot be driven there: test what a drop does
  with `applyDrop` (`drop.test.ts`), and the drag state machine by calling `useSprintDnd`'s
  handlers with the events dnd-kit would send (`dnd/__tests__/useSprintDnd.test.tsx`).
- Two styles. Standalone behaviour: plain `describe` / `it` / `expect`. Long step-by-step
  scenarios (refresh on Wednesday, then Thursday…): `checklist()` from `test/checklist.ts` —
  `check(name, ok, detail)` at each step, `report()` at the end turns each into a test. The
  suites that predate the runner use this form; don't rewrite their assertions.
- `test/**` and `__tests__` may use `any` for fake TFS JSON; nothing else may.

### End-to-end tests (`e2e/`)

- Playwright launches the **built** app (`out/main/index.js`) — `npm run test:e2e` builds first;
  if you run `npx playwright test` directly, run `npx electron-vite build` after changing code.
- Fixtures from `e2e/app.ts` (import `test` and `expect` from there, not from Playwright):
  `dataDir` (a throwaway folder passed as `--user-data-dir`, so real sprints are never touched),
  `seed({ settings, sprints })` (write files there before launching), `tfs` (a fake TFS on
  localhost, `e2e/fakeTfs.ts`: set `tfs.add(...)` / `tfs.queried`, read `tfs.requests`),
  `launch()` (returns `{ app, page, close }`; launch again after `close()` for a restart).
- Any console error or uncaught exception in any window fails the test.
- `e2e/data.ts` has the shared TFS data (a story with DEV and VAL tasks) and `sprintFor(tfs)`, a
  saved sprint of it. Dates follow the real clock, so e2e tests don't assert which day a block
  lands on — the unit tests do that against fixed dates.
- A fixed date: seed **without** `activeSprintId` and call `launch({ today, open, hourWidth })` —
  the window loads empty, the clock is set, then the sprint opens and only ever sees that day.
  `drag.spec.ts` runs on Wednesday 16 Sep 2026 this way.
- Drags: real mouse down/move/up through dnd-kit (`drag.spec.ts` has `pickUp`, `moveTo`,
  `release`, `slot`). dnd-kit swallows clicks for 50ms after a drop, so `release` waits before
  the test clicks again — otherwise a click on the dialog a drop opened silently does nothing.
- Native things can't be clicked: replace them inside the main process with `app.evaluate`, e.g.
  `dialog.showSaveDialog` (see `files.spec.ts`) or `shell.openExternal` (`stubBrowser` in
  `window.spec.ts`). Every link goes through main (`handlers/links.ts`), so stubbing it there
  catches them all.
- Seed `authMode: 'windows'` to talk to the fake TFS without a token. `startFakeTfs({ https:
true })` serves HTTPS with a certificate nobody trusts (`e2e/certs/`, a test-only key), for
  the "Trust certificates from" setting.
- Use e2e for what needs the real window: real pointer drags, the preload bridge, files on disk,
  several windows. Everything else belongs in the Vitest suites, which are much faster.

## Map

```
src/main/            Electron main process
  index.ts             windows (main + read-only snapshot windows)
  ipc.ts               every ipcMain.handle route, one line each
  handlers/            what the routes do: tfs.ts (client with the user's credentials, fetch,
                       teams, createTasks), sprint.ts (start, switch), files.ts (Save dialogs),
                       links.ts (the only way a link is opened: web addresses only)
  validate.ts          checking what the renderer sends (settings patches, task drafts)
  result.ts            guard(): failures become a Result with a message for the user
  storage.ts           JSON files on disk, settings + sealed PAT, snapshots, the auto baseline
  tfs/client.ts        TFS REST client: WIQL, batches, child tasks, createTasks, teams, versions
  tfs/url.ts           a query / sprint URL → server, collection, project, team
src/preload/         the ONLY bridge: exposes `window.api` (typed in index.ts / index.d.ts)
src/shared/          pure domain logic — no React, no Electron, no DOM, no zustand (lint-enforced)
  types.ts             Sprint, Block, WorkItem, Segment, Member, Note… (start here)
  scheduling/          the layout engine — index.ts has the file map
  autoAssign/          the auto-assign planner — kinds, ordering, meetings, valChain, plan
  mutations.ts         pure (Sprint) → Sprint transforms the store runs
  blocks.ts            finding / replacing / removing / inserting blocks
  drop.ts              what a drop does (applyDrop), when it asks (questionFor), slotAt
  refresh.ts           reconciling a sprint with fresh TFS items
  sizing.ts            how big a task is (Remaining + Completed), the off-track rule
  math.ts              round (to the hundredth) and clamp — use these, not local copies
  sprintSummary.ts     Markdown sprint summary for an AI write-up
  snapshots.ts, baseline.ts, notes.ts, squad.ts, taskCreation.ts, tags.ts, grouping.ts,
  nudge.ts, customHours.ts, pastFit.ts, assignment.ts, dates.ts, text.ts, settings.ts
  mock.ts              the sample sprint (also a handy test fixture)
src/renderer/src/    React UI
  App.tsx              composition root: toolbar, grid, panel, dialogs
  store/               zustand `useApp`, in slices (index.ts has the map); persistence.ts has
                       mutate (undo + save), persistSprint, the baseline timer, opened()
  dnd/useSprintDnd.ts  dragging: sensors, live preview, drop, the two drop questions
  menus.ts             right-click menus; shortcuts.ts: Ctrl+Z, Shift+arrows, click-away
  components/          SprintGrid, Toolbar, dialogs, HelpDialog (the in-app Read me),
                       panel/ (the side panel, one component per file)
  grid.ts              drag data types and hour-width zoom steps
  styles/              the stylesheet in cascade order; tokens on :root with a dark block
test/                shared test helpers: electron fake, fakeApi, fixtures, checklist
e2e/                 end-to-end tests of the built app (Playwright): fixtures, fake TFS, specs
```

## Core concepts (read before touching scheduling)

- **Queue, not coordinates.** Each member has an ordered queue of `Block`s (`sprint.queues`).
  The engine flows the queue across working days from the **anchor**; nothing stores a
  (day, hour) except pins. Change a block's hours and everything after it re-flows.
- **Anchor** = the first sprint day at or after today (`anchorFor`). Unpinned work never goes
  before it.
- **Pin** (`block.pin`) = "start no earlier than this slot". Pinned blocks are placed first;
  unpinned ones flow around them. **Every drop on the calendar pins** — a task lands on the hour
  it is dropped on and stays there (`applyDrop` in `drop.ts`); Unpin hands it back to the flow.
  Tasks go on the anchor day or later, reported hours on past days or today, and nothing on a
  locked day, a day off or past the end of someone's day (`canDrop`).
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
- **Undo**: every board change goes through `mutate(store, transform, label)` in
  `store/persistence.ts` (slices call it via their actions), which
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
- **Preview == drop**: the drag preview and the drop both go through `applyDrop` in
  `src/shared/drop.ts`; change one, you change both. Keep it that way.
- **Where the pointer is** during a drag comes from our own `pointermove` listener in
  `useSprintDnd`, measured against the row's position _now_ (`data-member` on `.row-track`).
  dnd-kit's `delta` also counts scrolling, and its `over.rect` can predate it: with either, a
  drop after the calendar auto-scrolls lands late by the scrolled distance.
- **A dragged block is held where it was grabbed** (`hoursBefore` in `DragData`, `shiftBack`):
  moving the pointer one cell moves the task one hour. Backlog cards land at the pointer.
- **Auto-scroll** is limited to the outer 4% of the calendar (`autoScroll` on the
  `DndContext`). dnd-kit's default, a fifth of the width, scrolled away under a pointer
  hovering over the last visible day.
- **dev:web + HMR**: when poking the store from the browser console/tests, import the module
  URL the page actually loaded, or you get a second store instance.
- **dev:web after moving files**: when a file becomes a folder (`x.ts` → `x/index.ts`) or is
  deleted, the running Vite server keeps the old path and the page goes blank with a 404.
  Restart `npm run dev:web`; it is not a code problem.
- **Windows shells** mangle backslashes in heredocs (`CMF\bsrocha` → `CMFbsrocha`). Write files
  with an editor/tool, not `cat <<EOF`, when they contain backslashes.
- TFS identities look like `Display Name <DOMAIN\user>`; `taskCreation.normaliseIdentity`
  accepts `user`, `DOMAIN\user`, `<DOMAIN\user>` and the full form (default domain `CMF`).
- Old sprint files must keep loading: new `Sprint` fields are optional, and migrations run
  when a sprint is opened (`opened()` in `store/persistence.ts`).

## Verifying a change

1. `npm run check`.
2. UI: `npm run dev:web` → **Load sample data** → exercise the change → no console errors.
3. Anything behind `window.api` (TFS, files, snapshots windows): `npm run dev`, and
   `npm run test:e2e`.

## Structure rules

Kept by the 2026-09 refactor; keep them:

- One home per concept. Rounding is `math.round`, block-list edits are `blocks.ts`, what a drop
  does is `drop.ts` — reuse them rather than writing a local copy.
- A folder's `index.ts` is its public API and has a map of its files. Import from the folder
  (`@shared/scheduling`), not from a file inside it.
- No import cycles. Where two modules need each other, one of them only needs a type — use
  `import type`.
- Behaviour the tests pinned down but that may deserve a decision is listed at the end of
  `ROADMAP.md`. Change it on purpose, with its test, not as part of a refactor.

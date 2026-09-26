# Sprint Viewer

A Windows desktop app for planning a sprint as a calendar: one row per team member, each
working day cut into hours, and every TFS task a block you can drag. Work items come from a
TFS / Azure DevOps Server query; the app reads them and writes back in one place only —
creating Tasks under a User Story or Bug.

Everything else is local. Sprints, snapshots and settings live in `%APPDATA%\SprintViewer` as
plain JSON; the personal access token is encrypted with Windows DPAPI. The only network traffic
is to your TFS server.

**How to use it** is documented inside the app: _Settings → Read me_, or _Read me_ on the start
screen. Use **Load sample data** there to look around without connecting to TFS. Ideas raised
but not built are in [ROADMAP.md](ROADMAP.md).

## Working on it

You need [Node.js](https://nodejs.org) 18 or newer, only to build. The finished installer needs
nothing.

```
npm install
npm run dev          # the Electron app, with hot reload
npm run dev:web      # the UI alone in a browser at http://localhost:5178 (no TFS, no disk)
npm run check        # typecheck + lint + format check + tests — run before every commit
```

`npm test` runs the tests alone (`npm run test:watch` while working, `npm run coverage` for a
report in `coverage/`). `npm run format` applies Prettier.

`scripts\run.cmd` installs, builds and launches the app in one go, for someone who only wants to
run it from source.

Agents and new contributors: [AGENTS.md](AGENTS.md) has the map of the code, the core
scheduling concepts, the rules of the project and its known pitfalls.

## Building the installer

```
npm run dist
```

or `scripts\build-installer.cmd`, which also repairs a common electron-builder cache problem
(below). Both run `npm run check` first, so a build that fails its tests is never packaged.
The result is `release\Sprint Viewer <version> Setup.exe`, around 80 MB, which installs per
user and needs no administrator rights. The version is `version` in `package.json`.

The installer is unsigned, so Windows SmartScreen shows "Windows protected your PC" the first
time someone runs it — they click **More info**, then **Run anyway**. Signing it would need a
code-signing certificate.

If the build fails while extracting `winCodeSign`, complaining it cannot create a symbolic link
to a `.dylib`: that is electron-builder unpacking macOS files from its signing toolchain, which
Windows blocks without Developer Mode. `scripts\build-installer.cmd` detects this and repairs
the cache itself, so a second attempt succeeds.

## Sharing it

**The installer** — copy `release\Sprint Viewer <version> Setup.exe` to the other machine and
run it.

**The source** — clone the git repository, or run `scripts\package-source.cmd` to zip the
project to your Desktop without `node_modules` or build output.

Settings do not travel with either. The token is sealed for the Windows account and machine that
saved it, so whoever runs the app enters their own in Settings.

## Layout

```
src/main/        Electron main process
  ipc.ts           every route the renderer can call, one line each
  handlers/        what the routes do: TFS access, starting/switching sprints, file exports
  storage.ts       JSON on disk, the sealed token, snapshots
  tfs/             the TFS REST client and URL parsing
src/preload/     the bridge: window.api, the renderer's only way to the main process
src/shared/      the domain, framework-free and shared by both sides
  scheduling/      the layout engine: queues of blocks flowed across the working days
  autoAssign/      filling the calendar from the backlog
  refresh.ts       reconciling the sprint with fresh TFS figures
  drop.ts          what a drag-and-drop does
  …                sizing, mutations, notes, snapshots, summary, tags, dates
src/renderer/    the React UI
  App.tsx          the window: toolbar, calendar, panel and dialogs, composed
  store/           the zustand store, in slices; every board change is undoable and saved
  components/      the calendar grid, the side panel (panel/), dialogs, the Read me
  dnd/             dragging, with a live preview of where the drop will land
  styles/          the stylesheet, in cascade order
test/            the fakes and fixtures the tests share (Electron, window.api, sprints)
```

The layout engine is the centre of the design. Placements are stored as an ordered queue of
blocks per person, never as fixed day-and-hour coordinates; the engine flows those queues
across the working days from today. Change a block's hours and everything after it re-flows —
which is what lets a refresh update the whole calendar just by applying TFS's new figures.

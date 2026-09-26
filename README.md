# Sprint Viewer

A desktop calendar for planning a two-week sprint. One row per person, days subdivided into
hour columns, work items imported read-only from a TFS query.

Everything is local. Sprints and settings live in `%APPDATA%\SprintViewer`; the only network
traffic the app makes is the requests to your TFS server.

## Current state

| What it does |
| --- |
| Calendar grid with spillover warnings |
| A back button, undoing any change to the board |
| Manual hours for a task, overruling what TFS says |
| Snapshots of the board, to restore or compare against |
| Drag and drop, with a live preview of exactly where the task will land |
| Pinning: drop onto a day already past to record what was worked |
| Refresh: re-read remaining hours from TFS and re-flow the sprint |
| Backlog search by number, title or assignee, accent-insensitive |
| Tasks grouped under their parent User Story or Bug, expand and collapse all |
| Filter the backlog by the tag in a task's title |
| The TFS assignee shown on tasks, and a check before a contradicting drop |
| Tasks sized by estimate, with reported hours drawn before today |
| A warning when reported hours will not fit in the days that have passed |
| Auto-assign: fill the calendar from the backlog, by assignee and priority |
| Splitting a task, with the remainder returning to the backlog |
| Clear sprint: send everything back to the backlog and start again |
| Dropping into the middle of a task asks how to make room |
| Days off and half days, per person and team-wide |
| Notes on people and tasks: write, edit, link, delete |
| Settings: team roster, encrypted PAT, connection test |
| Start sprint: import work items from a TFS query |

**Going back.** Every change to the board can be undone, one step at a time, fifty deep: a
drag, a split, auto-assign, clear, a restored snapshot, a refresh. The button names what it
will undo rather than saying only "back", and Ctrl+Z does the same. The history lives in
memory, so closing the app starts a fresh one. The tag filter is deliberately not part of it —
it is a view preference stored with the sprint, and going back a step should not change what
you are looking at.

**Manual hours.** Right-click a task and *Set hours…* to overrule TFS about its size; the card
and its blocks are marked, with the real figure in the tooltip. The number is kept with the
sprint rather than with the work item, so a refresh cannot quietly wipe it. When a refresh does
bring a different figure, the whole refresh waits and asks, task by task: keep yours, take the
one from TFS, or type a fresh number having seen both — with a single click to apply either of
the first two to every task at once. Cancelling leaves the board exactly as it was.

**Snapshots.** Take one when the plan is agreed and it is stored with the sprint, named and
dated. Later, *Open* puts it in its own read-only window to sit beside the live board, *Restore*
puts the board back to it, and *Export* writes it to a file. The compare window has a toggle,
off by default, that marks every work item that has changed since — moved to somebody else,
slipped or pulled to a different day, grown, shrunk, gone, or added — and lists them. Comparison
is per work item, so a task split in two is still one task rather than two problems. Restoring
is undoable like anything else.

**Dragging.** While a task is dragged over the calendar the grid already shows the result —
the task in its landing slot, split around days off, with everything it displaces already
moved. Dropping changes nothing visually, because the preview and the drop apply the same
transformation to the same engine. Dropping on a day at or before today pins the task to that
exact hour; dropping later adds it to the person's queue, which flows forward with no gaps.

**Auto-assign.** One pass that fills the calendar from the backlog. Each task goes to whoever
TFS has it assigned to, matched by name the same way a drop is checked, and each person's pile
is ordered: tasks under an Active work item first, then tasks under a User Story, then those
whose parent's Business Order is 50 or lower, then the shortest first. It fills only the hours
each person actually has left, so **it never creates spillover**; a task too big for the room
left is skipped and a shorter one behind it still gets placed. Anything TFS attributes to
nobody on the team stays in the backlog — it will not guess. It says what it is about to do,
and what it is leaving behind and why, before it does any of it.

The Business Order field is a customisation, so its name differs between servers. The app finds
it by looking at everything a parent work item carries and picking the field whose name reads as
"business order", then remembers it. Settings can override the name, or clear it to skip that
sorting step. If no such field exists the other three keys still apply.

**Grouping.** The backlog nests tasks under the User Story or Bug they hang off, with a
collapsible heading per parent showing its type, task count and total hours, and a control to
fold or unfold every group at once. Stories and bugs are headings, never cards: the work lives
in the tasks beneath them. A bug with no tasks under it still appears, as an empty group —
work nobody has broken down yet is exactly what you want to notice, not to have hidden.

**Sizing.** A task is not sized by what is left of it, which would make it shrink as it gets
done and leave a busy sprint looking empty. Before anything is reported it takes the space of
its Original Estimate. Once hours are reported against it, those hours are drawn *before*
today, hatched and immovable, and Remaining Work is drawn after — so a task reported at ten
hours against an eight hour estimate visibly spans thirteen when three remain. Reported hours
never consume capacity ahead of today, and are not drawn at all where the same work has
already been pinned by hand or frozen by an earlier refresh.

A task that was **never estimated and has nothing left**, but has hours reported against it, is
sized by those reported hours — 15 estimated, 0 remaining, 9 done shows as 9h. They become the
block rather than the ribbon behind today, so there is one representation of them and not two,
and you can drag it onto the days it was actually worked. A refresh that changes the reported
figure resizes that block where it sits, pinned or not, rather than adding a second one beside
it; everything to its right shifts by exactly the difference.

**The past belongs to work that happened.** Completed Work is the only record of that, so it
decides what may hold a day that has already passed. Two consequences:

The snapshot a refresh takes of a past day is not the last word. Where it disagrees with TFS it
gives way — an entry for a task nobody reported an hour against did not happen, whatever the
plan said at the time, and it must not hold that space against work that did. An entry holding
more hours than were reported is trimmed to what was.

Blocks you pinned there yourself are a different matter: they are deliberate, and moving one
changes your plan. So when reported hours still have nowhere to go, the app says so in the
toolbar rather than quietly drawing less than the truth. Opening the warning names each task
holding space it has not earned and offers to move it forward — only the unearned part of it,
so hours that really were worked stay where they are. When even that would not be enough, it
says so plainly: more hours are reported against somebody than the days that have passed can
hold, which means the figures in TFS disagree with each other and no rearranging will help.

If your server has no Original Estimate or Completed Work field, the app falls back to sizing
by remaining work, draws nothing as done, and judges nothing about the past. Nothing else
changes.

**Tags.** A task titled `DEV:: Export refactor`, `[TEST] Smoke run` or `E2E :: Checkout`
carries a discipline tag, and a row of chips above the backlog switches each one on or off.
Only the first seven characters are read, so a bracket or a pair of colons in the middle of a
sentence is not mistaken for a tag; the space in `E2E ::` is ignored, and case is folded, so
one tag never appears twice in the row. Anything with no prefix is *Others*. What is hidden
is stored with the sprint rather than what is shown, so a tag arriving at a later refresh is
visible by default instead of being filtered out by a list written before it existed.

**Assignees.** Task cards show who the work item is assigned to in TFS. Dropping one on
somebody else asks first — names are compared with accents and case stripped, on the full
name, then the first, then the last, against both the roster name and the configured TFS
identity, so `Vítor Andrade` and `Vitor` are the same person. A task nobody is assigned to is
not a contradiction and never asks. Answering *yes* changes only this app: nothing is ever
written back to TFS.

**Dropping into the middle.** The first hour of a task plainly means "before this one" and the
last means "after it", so those place silently. Dropping anywhere strictly between the two is a
real question, so it asks: split the task there and go between the halves, or leave it whole and
go either side of it. The preview shows the split, which is the literal reading of where you let
go. A two hour task never asks; on a day already past a pin claims its hour and the work flows
around it, which parts the task anyway.

**Clear sprint.** Sends every task back to the backlog, pins included, and discards the frozen
record of past days — a completely empty calendar. Parts of a task that were split rejoin as
one card. It asks first, and says how many tasks and how many recorded days are going, because
it cannot be undone. Nothing is written to TFS.

**Notes.** Right-click a person's name or any task to write one, or use *Add note* in the
person panel. A note always belongs to a person, since that is where it is read, and may point
at any number of work items — or none, for a remark about someone's week rather than a task.
A note stays with the person it was written for even if a task it mentions is later given to
somebody else.

**Refresh.** Re-reads the scheduling fields for every item in the sprint's query. The rule it
rests on: a work item's *schedulable* blocks should add up to the hours it still needs. Blocks pinned to
a day that has already passed are hours already spent, so they are excluded from that sum and
never altered. A task that drops from eight hours to three keeps its place in the queue and
simply gets shorter, and everything behind it slides to suit. When a split task grows, the
extra joins the part that comes *first* on the calendar — the work grew where it is being
done; when it shrinks, the hours come off the last part backwards. Either way the parts always
sum to what one unsplit task would have been. Finished tasks leave the calendar but keep their
history, and items that vanish from the query are marked rather than deleted.

**Planned versus recorded work.** Dropping a task on a day at or *before* today pins it to
that exact hour — that is how a sprint already in progress gets its history entered. Dropping
it on a *later* day adds it to that person's queue, which flows forward with no gaps, so a
refresh can push everything right when hours change. Dragging a pinned task somewhere else, or
using *Unpin* on its right-click menu, hands it back to the queue.

Ideas raised but not asked for are in [ROADMAP.md](ROADMAP.md).

Use **Load sample data** on the start screen to see a populated sprint without connecting to
TFS.

## Running it

You need [Node.js](https://nodejs.org) 18 or newer — only to build. The finished installer
needs nothing.

```
scripts\run.cmd
```

Installs dependencies on first run, builds, and launches the app. Equivalent to
`npm install && npm run build && npx electron-vite preview`.

For development with hot reload, use `npm run dev`. For UI work alone, `npm run dev:web`
serves just the renderer in a browser at port 5178 — faster to iterate on, though anything
behind `window.api` is inert there.

## Building the installer

```
scripts\build-installer.cmd
```

Writes `release\Sprint Viewer <version> Setup.exe`, around 79 MB. It installs per user, so it
needs no administrator rights.

The installer is unsigned, so Windows SmartScreen shows "Windows protected your PC" the first
time someone runs it — they need to click **More info** then **Run anyway**. Signing it would
need a code-signing certificate.

If the build fails while extracting `winCodeSign`, complaining it cannot create a symbolic
link to a `.dylib`: that is electron-builder unpacking macOS files from its signing toolchain,
which Windows blocks without Developer Mode. The script detects this and repairs the cache
itself, so a second attempt succeeds. Nothing about it is specific to this project.

## Sending it to another machine

**The installer** — copy `release\Sprint Viewer <version> Setup.exe` and run it there. Nothing
else is needed.

**The source** — run `scripts\package-source.cmd`, which zips the project to your Desktop
without `node_modules` or build output. On the other machine, unzip and run `scripts\run.cmd`
or `scripts\build-installer.cmd`.

Settings do not travel with either. The PAT is encrypted with Windows DPAPI, scoped to the
account and machine that saved it, so whoever runs it enters their own token in Settings.

## Layout

```
src/main       Electron main process: TFS client, PAT, files on disk
src/preload    The IPC bridge — the renderer's only route to the main process
src/renderer   React UI
src/shared     Domain model and the scheduling engine, used by both sides
```

The scheduling engine in `src/shared/scheduling.ts` is the centre of the design. Placements
are stored as an ordered queue of blocks per person, never as fixed day and hour coordinates;
the engine flows those queues across the working days. That is what will let a refresh
re-flow the whole calendar just by changing a task's remaining hours.

import { useState, type ReactNode } from 'react'
import { NOTE_CATEGORIES } from '@shared/notes'
import { cx } from '../format'
import Dialog from './Dialog'

interface Props {
  onClose: () => void
}

interface Section {
  id: string
  title: string
  body: ReactNode
}

/**
 * The app's own documentation: what it does, how to use it, and enough of how it works that
 * nothing it does comes as a surprise. Written into the app rather than linked, so it is there
 * offline and always matches the version that is running.
 */
export default function HelpDialog({ onClose }: Props): JSX.Element {
  const [current, setCurrent] = useState(SECTIONS[0].id)
  const section = SECTIONS.find((s) => s.id === current) ?? SECTIONS[0]
  const index = SECTIONS.indexOf(section)

  return (
    <Dialog
      title="Read me — Sprint Viewer"
      onClose={onClose}
      wide
      className="is-help"
      footer={
        <>
          <button
            type="button"
            disabled={index === 0}
            onClick={() => setCurrent(SECTIONS[index - 1].id)}
          >
            ← {index > 0 ? SECTIONS[index - 1].title : 'Previous'}
          </button>
          <span className="spacer" />
          <button
            type="button"
            disabled={index === SECTIONS.length - 1}
            onClick={() => setCurrent(SECTIONS[index + 1].id)}
          >
            {index < SECTIONS.length - 1 ? SECTIONS[index + 1].title : 'Next'} →
          </button>
          <button type="button" className="primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="help">
        <nav className="help-toc" aria-label="Contents">
          {SECTIONS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={cx('help-toc-item', s.id === current && 'is-on')}
              aria-current={s.id === current ? 'page' : undefined}
              onClick={() => setCurrent(s.id)}
            >
              <span className="help-toc-num">{i + 1}</span>
              {s.title}
            </button>
          ))}
        </nav>
        <article className="help-body">
          <h3>{section.title}</h3>
          {section.body}
        </article>
      </div>
    </Dialog>
  )
}

function Keys({ children }: { children: ReactNode }): JSX.Element {
  return <kbd>{children}</kbd>
}

const SECTIONS: Section[] = [
  {
    id: 'intro',
    title: 'What this app is',
    body: (
      <>
        <p>
          Sprint Viewer turns a TFS query into a calendar for a sprint. Every person on the team
          gets a row, every working day is a column cut into hours, and every task is a block you
          can drag. It is where the team plans who does what and when, and afterwards sees what
          actually happened.
        </p>
        <p>
          TFS stays the source of truth for the tasks themselves — titles, assignees, Remaining and
          Completed Work. The app reads them, and writes back to TFS in exactly one place: creating
          new tasks. Everything else — where blocks sit, notes, snapshots — is saved on this
          computer.
        </p>
        <h4>First time here</h4>
        <ol>
          <li>
            Open <strong>Settings</strong>, add your team under <em>Team</em> (or use{' '}
            <em>Sync with TFS team…</em>), and check how you sign in to TFS.
          </li>
          <li>
            Press <strong>Start sprint</strong>, paste the TFS query (or sprint) URL, choose the
            first day and length.
          </li>
          <li>
            Press <strong>Auto-assign</strong> to pour the backlog onto the calendar, then drag
            things where they really belong.
          </li>
          <li>
            Each morning, press <strong>Refresh</strong> to pull the latest hours from TFS.
          </li>
        </ol>
        <p className="hint">
          Want to look around first? On the empty screen, <em>Load sample data</em> opens a made-up
          sprint with everything in use. Nothing you do there is saved.
        </p>
      </>
    )
  },
  {
    id: 'start',
    title: 'Starting a sprint',
    body: (
      <>
        <p>
          <strong>Start sprint</strong> asks for a name, the first day, the length in weeks and a
          TFS URL. The URL can be a saved query or a sprint (iteration) page. Weekends are left out
          unless you tick <em>Include weekends</em>.
        </p>
        <p>
          The app reads every work item the query returns. User Stories and Bugs are headings; the
          Tasks under them are the work. Only child tasks in the same iteration as their parent are
          brought in — this is a sprint viewer, so work planned for another sprint stays out.
        </p>
        <p>
          Everything starts in the <strong>Backlog</strong> on the right. Nothing is placed on the
          calendar until you drag it there or run Auto-assign.
        </p>
        <p>
          You can also right-click a day header and choose <em>Start sprint here…</em> to start the
          next sprint from that date.
        </p>
      </>
    )
  },
  {
    id: 'calendar',
    title: 'Reading the calendar',
    body: (
      <>
        <ul>
          <li>
            <strong>Rows</strong> are people; click a name to open their panel on the right.
          </li>
          <li>
            The <strong>ⓘ</strong> in the calendar&rsquo;s top-left corner lists the keyboard
            shortcuts and what the marks on the calendar mean — hover it for a reminder.
          </li>
          <li>
            Right-click a name and choose <strong>Export calendar…</strong> for a simple board of
            their sprint — a row per day, and the tasks on it, like{' '}
            <code>#15243 (DEV) / #12345 (VAL)</code> — saved as Markdown or as a PNG image. Meetings
            are left out unless you tick <em>Show meetings</em>.
          </li>
          <li>
            <Keys>Ctrl</Keys>+click names to pick several people, or <Keys>Shift</Keys>+click to
            pick everyone between two names; right-click one of them to export all their calendars
            at once, a file each, into a folder you choose.
          </li>
          <li>
            <strong>Columns</strong> are days, cut into the hours of a working day (8 by default).
          </li>
          <li>
            The <strong>orange line</strong> is today. Everything to its left has happened;
            everything to its right is the plan.
          </li>
          <li>
            Blocks left of today are hours reported in TFS as <strong>done</strong>. They look like
            the rest of their task — the orange line is what separates done from planned.
          </li>
          <li>
            Grey, shaded columns are days off. Right-click a day header to make a day off or a half
            day for everyone, or for one person from their row.
          </li>
          <li>
            The <strong>lock</strong> on a day header settles that day: nothing can go onto it and
            nothing on it can be moved — by dragging or with Shift+arrows — until it is unlocked.
            What is on it when you lock it stays exactly where it is. Tasks you move, and work that
            flows, jump a locked day as they would a day off.
          </li>
          <li>
            A ⚠ next to a name means the person has more work than hours left in the sprint — hover
            it to see by how much.
          </li>
          <li>
            A ⚠ on a block means something about where it sits is wrong — for example a VAL task
            that starts before its DEV work ends. Hover it to see why.
          </li>
        </ul>
        <h4>Zoom</h4>
        <p>
          Use <strong>−</strong> / <strong>+</strong> / <strong>Reset</strong> in the top-left
          corner of the calendar, or hold <Keys>Ctrl</Keys> and scroll over it. The zoom is
          remembered on this computer.
        </p>
      </>
    )
  },
  {
    id: 'panel',
    title: 'Backlog, person and task panels',
    body: (
      <>
        <p>The right-hand panel has three tabs.</p>
        <h4>Backlog</h4>
        <p>
          Everything not yet on someone's calendar, grouped under its User Story or Bug. Use the
          search box and the tag chips (DEV, VAL, QA…) to filter. A card with an{' '}
          <span className="help-swatch is-outsider">amber background</span> is assigned in TFS to
          nobody on this squad — either nobody at all, or someone outside the team. Auto-assign
          leaves those alone.
        </p>
        <h4>Person</h4>
        <p>Click someone's name: their capacity, hours planned against it, and their notes.</p>
        <h4>Task</h4>
        <p>
          Click a block on the calendar: its hours (estimate, completed, remaining), where it is,
          the notes about it, and buttons for everything you can do with it. Clicking anywhere else
          clears the selection.
        </p>
      </>
    )
  },
  {
    id: 'planning',
    title: 'Planning by hand',
    body: (
      <>
        <ul>
          <li>
            <strong>Drag</strong> a card from the backlog onto a row and hour. Dropping on someone
            other than the TFS assignee asks first.
          </li>
          <li>
            A block you drop on a particular hour is <strong>pinned</strong> there — it stays on
            that hour, and work that is not pinned flows around it. Blocks that are not pinned flow
            one after another from today, with no gaps; <em>Unpin</em> puts a block back in that
            flow.
          </li>
          <li>
            Pick a block up anywhere along it: it moves with the pointer, so one cell to the right
            is one hour later, one day to the right is a day later.
          </li>
          <li>
            Tasks can go on today or any later day. Nothing can go on a locked day, someone's day
            off, or past the end of their day — the block under the pointer gets a red outline
            there, and letting go changes nothing.
          </li>
          <li>
            <strong>Done hours</strong> (left of today) can be dragged to any past day, or to today,
            to say when the work was really done. Dropped on the backlog, they wait there as a card
            with a red dot until you place them again.
          </li>
          <li>
            Dropping into the middle of another task asks whether to go before it, after it, or
            split it around the new one.
          </li>
          <li>
            <strong>Right-click a block</strong>: Split…, Set hours…, Add note…, Unpin, Return to
            backlog.
          </li>
          <li>
            <strong>Select</strong> a block and press <Keys>Shift</Keys>+<Keys>←</Keys> /{' '}
            <Keys>→</Keys> to nudge it an hour at a time. It skips nights, days off and locked days,
            swaps places with the task next to it, and never goes before today. Done hours nudge
            through the past, and onto today.
          </li>
          <li>
            <Keys>Ctrl</Keys>+<Keys>Z</Keys> or <strong>Back</strong> undoes the last change.
          </li>
          <li>
            <strong>Clear</strong> sends every task back to the backlog (locked days keep theirs).
          </li>
        </ul>
        <h4>Set hours</h4>
        <p>
          Overrides the size TFS gives a task. The block shows a ✎ while a manual time is set, and a
          refresh that disagrees with it asks you which to keep.
        </p>
      </>
    )
  },
  {
    id: 'time',
    title: 'How time is drawn',
    body: (
      <>
        <p>
          A task is worth its Remaining Work plus its Completed Work, and the two are drawn apart:
        </p>
        <ul>
          <li>
            <strong>Remaining</strong> is drawn from today on — it is what is still to do.
          </li>
          <li>
            <strong>Completed</strong> is drawn behind today, on the days it was worked. If the days
            behind today are full, it spills onto the start of today and today's plan moves along to
            make room.
          </li>
          <li>A task that is half done is drawn as two pieces, one either side of today.</li>
          <li>A closed task has no block ahead of today at all; its hours are all behind it.</li>
        </ul>
        <h4>The past is a record</h4>
        <p>
          Once a refresh has drawn the days behind today, what is on them stays put. Later refreshes
          only add the hours TFS reports on top, filling the <em>oldest</em> free space first. If
          you refreshed on Wednesday and Tuesday showed 6 of 8 hours, then on Thursday Tuesday keeps
          its 6 hours, the next new hours fill Tuesday's last 2, and the rest go on Wednesday.
        </p>
        <p>
          If Completed Work goes <em>down</em> in TFS, the most recent recorded hours of that task
          are taken off. Nothing else moves.
        </p>
        <h4>Saying when work happened</h4>
        <p>
          Drag a task's done hours to the day and hour they were really worked. Right-click them and
          choose <em>Reset to automatic</em> to undo that. Work still to do cannot go on a day that
          has passed.
        </p>
        <p>
          Original Estimate is not drawn anywhere. It is only used in the sprint summary to spot
          tasks that went off track (more than 25% over).
        </p>
      </>
    )
  },
  {
    id: 'refresh',
    title: 'Refresh',
    body: (
      <>
        <p>
          <strong>Refresh</strong> reads the query again and brings the calendar in line with TFS:
        </p>
        <ul>
          <li>
            A task's blocks are resized to its new Remaining Work. Extra hours join the part that
            comes first; hours taken away come off the part that comes last. Everything behind it
            slides along.
          </li>
          <li>A task with nothing left leaves the days ahead; its hours are drawn behind today.</li>
          <li>New tasks arrive in the backlog.</li>
          <li>
            If tasks in the backlog have hours <strong>already done</strong> by someone on the team,
            you are asked once where those go: <em>Place on the calendar</em> draws them on that
            person's row, where they were worked; <em>Keep in the backlog</em> leaves them as a card
            with a red dot, to drag onto the right day yourself. Auto-assign places any that are
            still waiting. A task's remaining hours stay a card of their own either way.
          </li>
          <li>
            Tasks the query no longer returns are marked <em>not in query</em>, not deleted.
          </li>
          <li>
            If a task has a manual time and TFS now says something different, the refresh stops and
            asks you, task by task, which to keep.
          </li>
        </ul>
        <p>
          The toolbar says what changed, and <strong>Back</strong> undoes a refresh.
        </p>
      </>
    )
  },
  {
    id: 'auto',
    title: 'Auto-assign',
    body: (
      <>
        <p>
          <strong>Auto-assign</strong> puts every backlog task on its TFS assignee's calendar, in
          one go. It shows what it is about to do before anything moves.
        </p>
        <h4>Order</h4>
        <ol>
          <li>Tasks whose parent is Active first,</li>
          <li>then tasks under User Stories,</li>
          <li>then tasks whose parent's Business Order is 50 or lower,</li>
          <li>then the shortest first.</li>
        </ol>
        <h4>Rules</h4>
        <ul>
          <li>Nobody is put over their capacity. What does not fit stays in the backlog.</li>
          <li>Tasks assigned to nobody on the team stay in the backlog.</li>
          <li>
            <strong>Meetings</strong> (a task titled just "Meeting" or "Meetings", or starting with
            it and a colon, like "Meetings:: Tech talk + Others") are split into 2–5 pieces and
            spread over the sprint, never on the first day.
          </li>
          <li>
            A <strong>VAL</strong> task starts the hour its DEV task (under the same parent) ends,
            whoever is doing each. If the DEV is still in the backlog, the VAL waits.
          </li>
          <li>
            If the DEV ends too close to the end of the sprint for the VAL to follow it, the VAL
            goes as late as its owner's calendar allows, and is flagged ⚠.
          </li>
        </ul>
        <h4>Keep my calendar fixed</h4>
        <p>
          If following those rules would move or cut work already on a calendar, the dialog lists
          what and why, and offers a second plan that moves nothing: VALs go after the owner's
          existing work, and meetings only on days after it.
        </p>
      </>
    )
  },
  {
    id: 'create',
    title: 'Creating tasks in TFS',
    body: (
      <>
        <p>
          In the backlog, right-click a User Story or Bug heading and choose{' '}
          <strong>Create tasks…</strong> to create Tasks under it, directly in TFS. The new tasks
          land in the backlog straight away.
        </p>
        <ul>
          <li>
            <strong>Single task</strong>, <strong>Multiple tasks</strong>, or{' '}
            <strong>Same task for the whole team</strong> (tick who gets one).
          </li>
          <li>
            <strong>Templates</strong> add one task per prefix, titled like{' '}
            <code>DEV:: Story title</code>. Set your own in Settings.
          </li>
          <li>
            <strong>+ DOC task</strong> and <strong>+ QA task</strong> fill in the owner chosen in
            Settings.
          </li>
          <li>
            <strong>Tags</strong>: keep the parent's, or choose <em>Custom tags</em> and type your
            own, separated by commas. Area and iteration always come from the parent.
          </li>
          <li>
            <strong>Owner</strong>: anyone on the team, or <em>Someone else…</em> and their TFS
            login — <code>bsrocha</code> and <code>CMF\bsrocha</code> both work; the domain is added
            if you leave it out.
          </li>
        </ul>
        <p>
          If TFS refuses some of the tasks, the ones that went through are kept and only the refused
          ones are offered again, with TFS's reason.
        </p>
      </>
    )
  },
  {
    id: 'team',
    title: 'The team and TFS sync',
    body: (
      <>
        <p>
          The team lives in <strong>Settings → Team</strong>. Each person has a name and, ideally,
          their TFS identity — that is how tasks are matched to rows. A full name always matches; a
          first or last name alone only when nobody else on the team shares it, so with two Diogos,
          fill in each one's TFS identity.
        </p>
        <p>
          <strong>Sync with TFS team…</strong> reads a team from TFS and proposes changes:
        </p>
        <ul>
          <li>link existing people to their TFS accounts,</li>
          <li>add people who are on the TFS team but not on the roster,</li>
          <li>
            remove people who are on the roster but not on the team — untick them, or use{' '}
            <em>Unselect all</em> on that section.
          </li>
        </ul>
        <p>
          Every section has <em>Select all</em> / <em>Unselect all</em>. Nothing changes until you
          press <em>Apply to roster</em> and then Save. You can also choose to update the open
          sprint's rows.
        </p>
      </>
    )
  },
  {
    id: 'notes',
    title: 'Notes',
    body: (
      <>
        <p>
          Right-click a name or a block and choose <em>Add note…</em>. A note belongs to a person,
          can mention tasks, and can have one category:
        </p>
        <p>
          {NOTE_CATEGORIES.map((category) => (
            <span className="tag-chip" key={category} style={{ marginRight: 4 }}>
              {category}
            </span>
          ))}
        </p>
        <p>
          Notes show in the person's panel and in the task panel. The <strong>Notes</strong> button
          in the toolbar exports them all to a Markdown file.
        </p>
      </>
    )
  },
  {
    id: 'snapshots',
    title: 'Snapshots and the summary',
    body: (
      <>
        <h4>Snapshots</h4>
        <p>
          <strong>Snapshot</strong> keeps a copy of the board as it stands, to open later in its own
          read-only window. A <em>Sprint start</em> snapshot is taken automatically on the sprint's
          first day and kept up to date until the day ends, so there is always a record of the plan
          as it began.
        </p>
        <h4>Sprint summary</h4>
        <p>
          <strong>Summary</strong> saves a Markdown file meant for an AI agent to write the sprint
          up from: the board at the start and at the end, planned against actual hours per person,
          every work item with flags (off track, added mid-sprint, reassigned, not finished,
          slipped, removed), and the notes by category. Pick which snapshot counts as the start.
        </p>
      </>
    )
  },
  {
    id: 'settings',
    title: 'Settings reference',
    body: (
      <>
        <ul>
          <li>
            <strong>Authentication</strong> — a Personal Access Token (stored encrypted, never shown
            again) or your Windows sign-in. <em>Test</em> checks it against a URL.
          </li>
          <li>
            <strong>Hours in a working day</strong> — also rescales the open sprint; days off and
            half days stay off and half.
          </li>
          <li>
            <strong>Team</strong> — the roster, and the TFS sync.
          </li>
          <li>
            <strong>Creating tasks</strong> — who DOC and QA tasks go to (a team member or any TFS
            login), and your templates.
          </li>
          <li>
            <strong>Import</strong> — how child tasks are found for a query, and the TFS API version
            if your server needs a specific one.
          </li>
        </ul>
        <p className="hint">
          Sprints and settings are saved in the folder shown at the bottom of Settings.
        </p>
      </>
    )
  },
  {
    id: 'how',
    title: 'How it works',
    body: (
      <>
        <p>For the curious — and for when something looks odd.</p>
        <ul>
          <li>
            Each person has a <strong>queue</strong>: an ordered list of blocks. The calendar is
            that queue flowed across the days from today, skipping days off, so changing one block's
            hours moves everything after it.
          </li>
          <li>
            A <strong>pinned</strong> block is placed first, at its hour; the rest flow around it.
          </li>
          <li>
            <strong>Today</strong> is the anchor: the first working day of the sprint at or after
            the date. Nothing that is still to do is placed before it.
          </li>
          <li>
            The <strong>past record</strong> is a copy of what each day behind today showed at the
            last refresh. It is only ever added to (or trimmed if TFS lowers Completed Work).
          </li>
          <li>
            A block holds hours; the task it belongs to lives in TFS. That is why renaming a task in
            TFS shows up after a refresh, and why deleting a block never touches TFS.
          </li>
          <li>
            The app talks to TFS through its REST API, with the same permissions you have. It only
            ever writes when you create tasks.
          </li>
        </ul>
      </>
    )
  }
]

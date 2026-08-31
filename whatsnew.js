'use strict';

/* ── WHAT'S NEW ───────────────────────────────────────────────────────────────
 * A release-notes modal that opens once per person per release, right after
 * sign-in. Shared by index / team / ops / dash as a classic script, the same
 * way people.js is.
 *
 * It hangs off auth.js's `prepro:auth-ready` event rather than DOMContentLoaded,
 * so it can never appear over the sign-in card or the awaiting-approval screen —
 * "when a person logs in" means exactly that.
 *
 * Adding a release: put a new entry at the TOP of RELEASES. Everything else
 * (which notes a given person still owes, the badge, the seen marker) keys off
 * `id`, so that is the only edit needed. Keep ids sortable and unique; the
 * date-with-suffix shape leaves room for two releases in a day.
 * ─────────────────────────────────────────────────────────────────────────── */

var WHATSNEW_RELEASES = [
  {
    id: '2026-08-31j',
    title: 'Fixes to reading a thread',
    dateLabel: 'Aug 31, 2026',
    groups: [
      {
        area: 'Team · Plan tab',
        items: [
          { tag: 'fix', text: 'Answering “Which Liz?” threw the loop away. Choosing a person marked the question answered but left the row unticked, so saving skipped it — the one thing the feature exists to ask you was also the thing that lost your work. Picking a name now accepts the row.' },
          { tag: 'fix', text: 'It could quietly answer its own question. Given a thread saying only “Liz” it would sometimes reply with a full name that appears nowhere in the text, so no question was asked and the loop was filed against a coin-flip person. A name is now checked against the thread itself, and anything the text does not actually say is put back to you.' },
          { tag: 'fix', text: 'On a thread nobody signed, it would name a plausible sender from the project and file the note under them — crediting a colleague with something they never wrote. The sender is now an editable field, is flagged when it is a guess, and a guessed name is never used as the author.' },
          { tag: 'fix', text: 'A thread on a project with no open loops was invisible: the Plan tab stopped before reaching it and the Notes tab filters threads out, so it could not be read or deleted even though it still fed the dossier and the project review.' },
          { tag: 'fix', text: '“I owe Marcus the estimate” was being filed as waiting on Marcus, the exact opposite of what it says. Where the text turns on an “I” whose owner cannot be known, it now asks instead of guessing.' },
          { tag: 'fix', text: 'Reworded duplicates of a loop you are already chasing are caught more often — though two loops that differ in a real way are still kept apart, because a wrongly merged pair silently loses one and a duplicate is just a row you untick.' }
        ]
      }
    ]
  },
  {
    id: '2026-08-31i',
    title: 'Reading a thread keeps the thread',
    dateLabel: 'Aug 31, 2026',
    groups: [
      {
        area: 'Team · Plan tab',
        items: [
          { tag: 'new', text: 'Reading a thread now files the thread itself, not just the things owed in it. You get a short summary of what it says, sorted into the right kind of note — blocker, feedback, change of direction, decision — and the full original is kept underneath, one click away.' },
          { tag: 'new', text: 'Filed threads live in a Threads read section in the Plan tab, alongside the open loops that came out of them, so you can see what a thread actually produced. The Notes tab stays exactly as it was: what your team wrote by hand.' },
          { tag: 'new', text: 'Loops created from a thread point back at it, the same way a loop left from a note does — so “the blocker raised six days ago is still open” works on a pasted email too.' },
          { tag: 'new', text: 'A thread with nothing owed in it is still worth filing. “Confirming we settled on the shorter version” produces no loops and a decision note, where before it produced nothing at all.' }
        ]
      },
      {
        area: 'Team · reviewing what it found',
        items: [
          { tag: 'new', text: 'It now asks when it genuinely cannot tell, instead of guessing. Two people called Liz on the project and a thread that just says “Liz will send it” gets you a “Which Liz?” picker rather than a coin flip — a wrong owner produces a loop that looks fine and never reaches the person who owes it.' },
          { tag: 'new', text: 'It also flags what it could not work out from the wording itself — “who is ‘we’ here?”, “which Thursday?” — right next to the field in question.' },
          { tag: 'new', text: 'Anything it is unsure about arrives unticked, and a row waiting on a name choice cannot be ticked until you make it. Everything it is confident about still arrives ticked, so the normal case is still one click.' },
          { tag: 'fix', text: 'A first name that matches exactly one person on the project is filled in silently — “Priya” becomes “Priya Nair” — so the questions stay rare enough to be worth reading.' }
        ]
      }
    ]
  },
  {
    id: '2026-08-31h',
    title: 'Fixes from a proper test pass',
    dateLabel: 'Aug 31, 2026',
    groups: [
      {
        area: 'AI · reliability',
        items: [
          { tag: 'fix', text: 'The AI features could fail permanently for anyone who had just set up a key. The default model has been returning “temporarily unavailable” from Google, and prepro kept retrying that one model instead of moving to the next — so it never reached a working one. It now falls through the list on an outage, exactly as it already did when a model ran out of requests.' },
          { tag: 'fix', text: 'One busy moment could switch AI off for the rest of the day and blame you for it. A model in the fallback list no longer exists for newly created keys, and once prepro landed on it, it kept going back to it and telling you to pick a different model in Settings. That model is out of the list, and any model that turns out to be unreachable is now skipped for the day.' },
          { tag: 'fix', text: '“Out of requests for today” and “cannot reach any model” now say different things, because waiting until midnight only fixes one of them.' }
        ]
      },
      {
        area: 'AI · what it writes',
        items: [
          { tag: 'fix', text: 'Project review was returning no suggested actions at all on most projects. The fault was in how prepro asked, not in the model — it now returns them, and they can be added as open loops in one click.' },
          { tag: 'fix', text: 'A proposal could be saved as “you are waiting on yourself”, which then never appeared in your own list and never triggered a follow-up reminder. Who owes something and which way it points are now worked out together, the same way the manual add box has always done it.' },
          { tag: 'fix', text: 'Proposals read on one project could be added to a different one if you switched projects with the review list still open. The list now belongs to the project it came from.' },
          { tag: 'fix', text: 'An impossible date such as 2026-13-45 used to be accepted, producing a loop that counted as overdue but never actually reminded you. Dates are checked against a real calendar now.' },
          { tag: 'fix', text: 'The “do not suggest something already being tracked” check only caught exact matches, so a reworded version of a loop you were already chasing slipped through — sometimes pointing the opposite way. It now recognises rephrasings.' },
          { tag: 'fix', text: 'Only the people on the project are sent to Google when reading a thread, rather than the whole staff list.' },
          { tag: 'fix', text: 'Completed and cancelled projects are no longer offered a review — the old one rated a finished project “at risk” because its past work sat after its scheduled dates.' },
          { tag: 'fix', text: 'A very large paste is now refused up front rather than spending one of your daily requests on something that cannot fit in a reply.' }
        ]
      },
      {
        area: 'Everywhere',
        items: [
          { tag: 'fix', text: 'The project dossier can finally tell finished work from late work: it reads the ticks from your dashboard, so “tasks past their scheduled date” means what it says, and completed work shows a ✓ on the timeline.' }
        ]
      }
    ]
  },
  {
    id: '2026-08-31g',
    title: 'Paste a thread, get open loops',
    dateLabel: 'Aug 31, 2026',
    groups: [
      {
        area: 'Team · Plan tab',
        items: [
          { tag: 'new', text: 'Paste an email thread, a Teams conversation or your notes from a call, and prepro proposes the open loops in it — who owes what, and by when. Every row is editable and quotes the sentence it came from, so you can check it before you accept. Nothing is saved until you tick it.' },
          { tag: 'new', text: 'It is told who is on the project and what is already tracked, so it uses real names rather than inventing “the design team”, and does not propose a loop you are already chasing.' },
          { tag: 'new', text: 'Project review reads the whole dossier and says where things stand: a one-line summary, a health marker, the things worth a look with the evidence for each, and suggested loops you can add with one click.' },
          { tag: 'new', text: 'A review is cached and shared with the team, so one person running it covers everyone — including people who never set a key up. It only re-runs when the project has actually changed, and says “from Aug 29, before the latest changes” when what you are reading has been overtaken.' }
        ]
      },
      {
        area: 'Everywhere',
        items: [
          { tag: 'fix', text: 'Still entirely optional. Without a key none of this appears — no buttons, no prompts, no nagging — and every nudge, open loop and dossier goes on being worked out on your own machine.' }
        ]
      }
    ]
  },
  {
    id: '2026-08-31f',
    title: 'Optional AI — bring your own key, or don’t',
    dateLabel: 'Aug 31, 2026',
    groups: [
      {
        area: 'Team · Settings → AI',
        items: [
          { tag: 'new', text: 'A new AI tab in Settings where you can paste your own Google Gemini key. Nothing in prepro needs it: every nudge, every open loop and the whole dossier are worked out on your own machine with no model involved. A key only unlocks turning pasted text — an email thread, meeting notes — into open loops you review before they land. That part arrives next.' },
          { tag: 'new', text: 'Everyone brings their own key rather than sharing one. Free-tier limits are counted per key, so separate keys actually go further across a team than a shared one would — and a shared key in a public repo would be a published key.' },
          { tag: 'new', text: 'Your key is stored in your browser only. It never goes into the shared database, never into the repo, and nobody else on the team can see it.' },
          { tag: 'new', text: 'Test connection does a real round trip and tells you in plain words what happened. If a key has no free-tier quota at all — usually because it came from a project with billing switched on — it says exactly that, and how to make one that works.' },
          { tag: 'new', text: 'Settings shows how much of today’s free allowance you have used. When a model runs out, prepro moves to the next one by itself; when they are all spent it says so and carries on working normally, because nothing depends on it.' }
        ]
      }
    ]
  },
  {
    id: '2026-08-31e',
    title: 'The dossier — a whole project on one page',
    dateLabel: 'Aug 31, 2026',
    groups: [
      {
        area: 'Team · Text export',
        items: [
          { tag: 'new', text: 'The Text tab now offers two documents rather than one. Schedule is what was always there — what is happening when. Dossier is new: the brief, the team, the whole arc past and future, every open loop, the notes, and the numbers that fall out of them, on a single page you can copy anywhere.' },
          { tag: 'new', text: 'The timeline reads as one list rather than two tables, with a tick against finished work, an arrow at whatever is in flight, and a marker on today — so where a project has got to is visible at a glance.' },
          { tag: 'new', text: 'Empty sections say so out loud instead of quietly disappearing. A project with no brief now reads “empty — no brief imported and no goal typed”, which is usually the most useful thing on the page.' },
          { tag: 'new', text: 'The derived line does the counting for you: days since anything happened, tasks past their date, how long until due, open loops, the oldest thing waiting on somebody else, and whether the project has fallen past its own cadence.' }
        ]
      },
      {
        area: 'Dash · Nudges',
        items: [
          { tag: 'fix', text: 'A project being actively worked on could be mistaken for a silent one. A task running across today was not counted as activity at all, so a multi-day edit in progress could trigger a “nothing has happened in N days” nudge on a project somebody was working on right then. Both the nudge and the dossier now share one definition of quiet.' }
        ]
      }
    ]
  },
  {
    id: '2026-08-31d',
    title: 'The dashboard starts chasing things for you',
    dateLabel: 'Aug 31, 2026',
    groups: [
      {
        area: 'Dash · Open Loops panel',
        items: [
          { tag: 'new', text: 'A new Open Loops panel, on by default, answering the one question no other panel could: what am I forgetting, across everything. It is ordered by how long something has been sitting rather than by project or by day, because that is the only ordering that surfaces the thing you have stopped noticing.' },
          { tag: 'new', text: 'Split into what you are waiting on other people for and what is on you. Anything waiting five days turns amber, ten days red, and overdue items carry the number of days late.' },
          { tag: 'new', text: 'Chased somebody? The ↻ button restarts the clock, so the count answers “how long since I last pushed” rather than “how long has this existed”. Each loop links straight through to its project in Team.' }
        ]
      },
      {
        area: 'Dash · Nudges',
        items: [
          { tag: 'new', text: 'Nudges now read open loops. “Waiting on Sarah for the VO approval since Tuesday — worth a chase?” Past a fortnight it switches to a day count and suggests escalating instead.' },
          { tag: 'new', text: 'A nudge for what you owe, whether it is already late or lands in the next couple of days. Commitments are not scheduled work, so they appear on no timeline and nothing could previously surface them.' },
          { tag: 'new', text: 'Blocker nudges know whether the blocker is still open and who is holding it, rather than only that one was flagged at some point.' },
          { tag: 'new', text: 'Set a rhythm on a project in the Team Plan tab and the dashboard notices when it lapses — “nothing on Brand Refresh in 9 days, and it is a weekly project”.' },
          { tag: 'fix', text: 'Coming back to a project after a few weeks now tells you what was actually left open, and who has it, instead of generically suggesting a resync.' }
        ]
      }
    ]
  },
  {
    id: '2026-08-31c',
    title: 'Capture: leave an open loop where the thought already is',
    dateLabel: 'Aug 31, 2026',
    groups: [
      {
        area: 'Team · Notes',
        items: [
          { tag: 'new', text: 'The note composer now has two optional fields — who it is on, and by when. Fill either and the note leaves behind an open loop that can actually be chased. Naming somebody other than yourself records that you are waiting on them, and starts the clock from the note’s date.' },
          { tag: 'new', text: 'The loop keeps a link back to the note it came from, so the one-line version stays readable while the full note stays on the project.' }
        ]
      },
      {
        area: 'Team · Plan tab',
        items: [
          { tag: 'new', text: 'A new Plan tab (📌) in the tools rail, sitting beside Info because that is where notes are written. It lists every open loop on the project, split into what you are waiting on other people for and what is on you, with recently closed ones underneath.' },
          { tag: 'new', text: 'Add a loop directly with a line of text, optionally a person and a date. Click any loop to edit it, tick it off, hand it to somebody, or drop it — dropped loops stay on the project rather than vanishing.' },
          { tag: 'new', text: 'Loops waiting five days or more turn amber, and overdue ones go red with the number of days late, so a list you have stopped reading still tells you where to look.' },
          { tag: 'new', text: 'You can also set how often a project is meant to be touched — weekly, fortnightly, monthly. Nothing acts on it yet; the nudges that use it come next.' }
        ]
      },
      {
        area: 'Dash · Nudges',
        items: [
          { tag: 'new', text: 'Nudges now come with three replies: Handled, Later, and Waiting on… Handled dismisses that specific suggestion for a month, Later brings it back in three days, and both are per-suggestion, so silencing one does not silence the others on the same task.' },
          { tag: 'new', text: 'Waiting on… opens a small form right under the nudge and records a real open loop, pre-filled from the task so the usual case is a name and a keypress. Answering the question is what files the answer — nothing has to be written down twice.' },
          { tag: 'fix', text: 'Open loops are now included in backups, and restoring one adds anything missing without overwriting what is already there.' }
        ]
      }
    ]
  },
  {
    id: '2026-08-31b',
    title: 'Open loops — the thing the app could never keep track of',
    dateLabel: 'Aug 31, 2026',
    groups: [
      {
        area: 'Under the hood',
        items: [
          { tag: 'new', text: 'A project can now hold open loops: something owed, by someone, ideally by a date — and, crucially, a note of whose court the ball is in. Until now the app could only describe scheduled work, which is why nothing could ever remind you that you had been waiting on somebody since Tuesday.' },
          { tag: 'new', text: 'Subtasks become open loops. A subtask used to be text and a tick stored against a task id, with no owner, no date and no project, and it vanished silently whenever the task it hung off was deleted in Team. As an open loop it gains all of that, and there is now a way to see which ones had been orphaned.' },
          { tag: 'new', text: 'Dash → Settings → Data offers the move when you have subtasks to migrate. It shows exactly what will happen first, leaves your existing subtasks untouched as a fallback, and running it twice does not duplicate anything.' },
          { tag: 'fix', text: 'Open loops live in their own store rather than alongside the projects, so ticking one off no longer rewrites every project at once — two people working at the same time cannot overwrite each other the way they could.' }
        ]
      }
    ]
  },
  {
    id: '2026-08-31',
    title: 'The dashboard can finally read the brief',
    dateLabel: 'Aug 31, 2026',
    groups: [
      {
        area: 'Team · Project Info',
        items: [
          { tag: 'new', text: 'A new Brief section on the Info tab, with Function, Budget, Tangible Goal 1 and 2, Completion Issues and Additional Notes. These six fields have existed on every project since the beginning, but no Pega column fills them and no screen ever offered a way to type one, so they have sat permanently empty. You can now edit them in place — they save when you click away.' },
          { tag: 'new', text: 'Unlike the ticket rows above them, the brief fields stay visible when empty, because otherwise there would be nowhere to fill them in.' }
        ]
      },
      {
        area: 'Dash · Nudges',
        items: [
          { tag: 'new', text: 'Nudges can now read the project brief, not just its calendar. Until now every suggestion was worked out purely from what sat next to what on the timeline — the dashboard had never once looked at what a project was actually for.' },
          { tag: 'new', text: 'A new nudge notices when someone logs a change in direction while the brief still states the original goal, and asks whether the goal needs updating. Nothing could spot this before: the goal and the note live in different halves of the project and one of them was unreadable.' },
          { tag: 'fix', text: 'The milestone nudge now names the tangible goal where a project has one — “does today’s work get you to X?” instead of the generic “is today’s work on the critical path?”. Projects without a goal keep the old wording.' }
        ]
      }
    ]
  },
  {
    id: '2026-08-28',
    title: 'Company holidays on the PNG export',
    dateLabel: 'Aug 28, 2026',
    groups: [
      {
        area: 'Team · PNG Export',
        items: [
          { tag: 'new', text: 'A new Overlay company holidays option puts every holiday from the shared Holidays project onto the exported calendar, as an amber banner across the top of the day. Until now the PNG only drew the project’s own tasks, so a company shutdown was invisible on every other project’s export.' },
          { tag: 'new', text: 'A holiday tagged to specific offices only appears if somebody on the project is actually based in one of them, so a US-only export is not littered with holidays nobody on it takes. Untagged holidays read as company-wide and always show.' },
          { tag: 'new', text: 'The banner carries the country codes the same way the on-screen overlay does — “US·IN”, “ALL” when every office is off, and nothing at all when no office is picked.' },
          { tag: 'fix', text: 'The Include roles checkbox is gone — a task’s role is now always on the PNG. It was the one export option nobody turned off, and dropping it makes the export match what the calendar shows.' },
          { tag: 'fix', text: 'Turning it on makes the day cells taller rather than squeezing the banners in, so a busy day cannot quietly drop a task off the bottom of the export.' }
        ]
      }
    ]
  },
  {
    id: '2026-08-26',
    title: 'Gantt colours, the Look Back window, and one lead producer',
    // Human range, not a commit range: this covers the work from the afternoon
    // of Mon Aug 25 through the morning of Tue Aug 26, US Eastern.
    dateLabel: 'Aug 25–26, 2026',
    groups: [
      {
        area: 'Ops · Gantt Chart',
        items: [
          { tag: 'new', text: 'A Legend button in the header spells out what every bar colour actually means — including that a producer task’s colour is decided by keywords in its name, which is the least obvious rule in the app.' },
          { tag: 'new', text: 'The legend is also a filter: click a colour to narrow the Gantt to it. Animator only and Studio only are one-click shortcuts. Rows with no matching work drop out; PTO stays put so you can still see why a lane is empty.' },
          { tag: 'fix', text: 'Studio bookings with nobody assigned never drew anywhere. They now appear read-only on a single Studio row, so a booked studio is visible even before crew is attached.' },
          { tag: 'fix', text: 'PTO bars were the same blue as real work. They are now a neutral gray hatch.' },
          { tag: 'new', text: 'Every week now starts with a divider line, so you can count weeks without counting columns.' }
        ]
      },
      {
        area: 'Ops · Metrics',
        items: [
          { tag: 'new', text: 'Team Workload moved out of the bottom bar and into a Metrics panel, so it hides, reorders and drags like the others. The numbers are unchanged.' },
          { tag: 'new', text: 'That gave the calendar and the Gantt back about 200px. The bottom bar now holds Filter Team only, at half the height.' }
        ]
      },
      {
        area: 'Dashboard',
        items: [
          { tag: 'fix', text: 'Look Back was hardwired to Jan–Jun, so from July onward it clipped recent work down to almost nothing and the effort numbers looked far too small. It now opens on the half-year you are actually in.' },
          { tag: 'new', text: 'Each project row in Look Back says how many days it counted, badges a project whose work runs outside the selected period, and shows the arithmetic on hover. The copy-summary text carries the same facts.' },
          { tag: 'fix', text: '“(you)” in the Project Grid followed whoever you clicked in the sidebar. It now follows your star, which is what actually marks you.' }
        ]
      },
      {
        area: 'Everywhere',
        items: [
          { tag: 'fix', text: 'Ops, the Dashboard and the Pega import disagreed about who a project’s lead producer is, so after a handoff the outgoing name stayed on screen. All three now read the same field. A changed producer also shows up as a real update in the import instead of being silently skipped.' }
        ]
      }
    ]
  }
];

(function () {
  var SEEN_PREFIX = 'prepro_whatsnew_seen';
  var TAG_LABEL = { 'new': 'New', 'fix': 'Fixed' };

  function latestId() {
    return WHATSNEW_RELEASES.length ? WHATSNEW_RELEASES[0].id : '';
  }

  // Keyed by uid so a shared machine does not let one person's dismissal
  // swallow the notes for the next person to sign in on it.
  function seenKey(uid) { return uid ? SEEN_PREFIX + '_' + uid : SEEN_PREFIX; }
  function getSeen(uid) {
    try { return localStorage.getItem(seenKey(uid)) || ''; } catch (_) { return ''; }
  }
  function setSeen(uid, id) {
    try { localStorage.setItem(seenKey(uid), id); } catch (_) {}
  }

  // Releases newer than what this person has already dismissed. Ids sort
  // lexicographically by construction, so a plain string compare is enough and
  // there is no date parsing to get wrong.
  function unseenReleases(uid) {
    var seen = getSeen(uid);
    if (!seen) return WHATSNEW_RELEASES.slice(0, 1); // first run: just the current one
    return WHATSNEW_RELEASES.filter(function (r) { return r.id > seen; });
  }

  var styleEl = null;
  function injectStyles() {
    if (styleEl) return;
    styleEl = document.createElement('style');
    styleEl.textContent = [
      /* Falls back to literal colours so this works on any page whether or not
         it defines the app's theme variables. */
      '#pp-wn-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.72); z-index: 9600; display: none; align-items: center; justify-content: center; font-family: system-ui,-apple-system,sans-serif; padding: 20px; }',
      '#pp-wn-overlay.show { display: flex; }',
      '.pp-wn-card { background: var(--panel,#16161e); border: 1px solid var(--border,#2c2c3e); border-radius: 10px; width: 100%; max-width: 560px; max-height: 82vh; display: flex; flex-direction: column; color: var(--text,#e0e0ec); box-shadow: 0 14px 40px rgba(0,0,0,.5); }',
      '.pp-wn-head { padding: 16px 20px 14px; border-bottom: 1px solid var(--border,#2c2c3e); display: flex; align-items: flex-start; gap: 12px; }',
      '.pp-wn-head-txt { flex: 1; min-width: 0; }',
      '.pp-wn-kicker { font-size: 9px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--accent,#6c63ff); }',
      '.pp-wn-title { font-size: 16px; font-weight: 700; line-height: 1.3; margin-top: 3px; }',
      '.pp-wn-date { font-size: 11px; color: var(--dim,#8080a0); margin-top: 3px; }',
      '.pp-wn-close { background: none; border: none; color: var(--dim,#8080a0); font-size: 24px; line-height: 1; cursor: pointer; padding: 0 2px; flex-shrink: 0; }',
      '.pp-wn-close:hover { color: var(--text,#e0e0ec); }',
      '.pp-wn-body { overflow-y: auto; padding: 6px 20px 4px; }',
      '.pp-wn-rel + .pp-wn-rel { border-top: 1px solid var(--border,#2c2c3e); margin-top: 14px; padding-top: 12px; }',
      '.pp-wn-rel-head { font-size: 11px; font-weight: 700; color: var(--text,#e0e0ec); margin: 12px 0 2px; }',
      '.pp-wn-rel-date { font-size: 10px; color: var(--dim,#8080a0); margin-bottom: 4px; }',
      '.pp-wn-area { font-size: 9px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--dim,#8080a0); margin: 14px 0 7px; }',
      '.pp-wn-item { display: flex; align-items: flex-start; gap: 9px; padding: 5px 0; }',
      '.pp-wn-tag { font-size: 8px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; border-radius: 3px; padding: 2px 5px; flex-shrink: 0; margin-top: 2px; min-width: 34px; text-align: center; }',
      '.pp-wn-tag.new { background: rgba(108,99,255,.18); color: var(--accent,#6c63ff); }',
      '.pp-wn-tag.fix { background: rgba(76,186,106,.16); color: #4cba6a; }',
      '.pp-wn-text { font-size: 12px; line-height: 1.5; color: var(--text,#e0e0ec); }',
      '.pp-wn-foot { padding: 12px 20px 16px; border-top: 1px solid var(--border,#2c2c3e); display: flex; align-items: center; gap: 10px; }',
      '.pp-wn-foot-note { font-size: 10px; color: var(--dim,#8080a0); flex: 1; }',
      '.pp-wn-ok { background: var(--accent,#6c63ff); color: #fff; border: none; border-radius: 6px; padding: 8px 20px; font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit; }',
      '.pp-wn-ok:hover { opacity: .92; }',
      '#pp-wn-nav-btn .pp-wn-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #e05555; margin-right: 5px; vertical-align: middle; }'
    ].join('\n');
    document.head.appendChild(styleEl);
  }

  var overlay = null;
  var activeUid = '';

  function buildOverlay() {
    if (overlay) return overlay;
    injectStyles();
    overlay = document.createElement('div');
    overlay.id = 'pp-wn-overlay';
    overlay.innerHTML =
      '<div class="pp-wn-card" role="dialog" aria-modal="true" aria-labelledby="pp-wn-title">' +
        '<div class="pp-wn-head">' +
          '<div class="pp-wn-head-txt">' +
            '<div class="pp-wn-kicker">What’s New</div>' +
            '<div class="pp-wn-title" id="pp-wn-title"></div>' +
            '<div class="pp-wn-date" id="pp-wn-date"></div>' +
          '</div>' +
          '<button class="pp-wn-close" id="pp-wn-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="pp-wn-body" id="pp-wn-body"></div>' +
        '<div class="pp-wn-foot">' +
          '<span class="pp-wn-foot-note" id="pp-wn-note"></span>' +
          '<button class="pp-wn-ok" id="pp-wn-ok">Got it</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.querySelector('#pp-wn-close').onclick = close;
    overlay.querySelector('#pp-wn-ok').onclick = close;
    // Backdrop click closes; a click inside the card must not.
    overlay.onclick = function (e) { if (e.target === overlay) close(); };
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('show')) close();
    });
    return overlay;
  }

  function renderRelease(rel, withHeading) {
    var wrap = document.createElement('div');
    wrap.className = 'pp-wn-rel';
    if (withHeading) {
      var h = document.createElement('div');
      h.className = 'pp-wn-rel-head';
      h.textContent = rel.title;
      wrap.appendChild(h);
      var d = document.createElement('div');
      d.className = 'pp-wn-rel-date';
      d.textContent = rel.dateLabel;
      wrap.appendChild(d);
    }
    (rel.groups || []).forEach(function (g) {
      var a = document.createElement('div');
      a.className = 'pp-wn-area';
      a.textContent = g.area;
      wrap.appendChild(a);
      (g.items || []).forEach(function (it) {
        var row = document.createElement('div');
        row.className = 'pp-wn-item';
        var tag = document.createElement('span');
        tag.className = 'pp-wn-tag ' + (it.tag === 'fix' ? 'fix' : 'new');
        tag.textContent = TAG_LABEL[it.tag] || 'New';
        row.appendChild(tag);
        var txt = document.createElement('span');
        txt.className = 'pp-wn-text';
        txt.textContent = it.text;
        row.appendChild(txt);
        wrap.appendChild(row);
      });
    });
    return wrap;
  }

  // `list` is what to show. Opened from the nav button it is every release, so
  // the notes stay readable after they have been dismissed.
  function open(list) {
    var rels = (list && list.length) ? list : WHATSNEW_RELEASES;
    if (!rels.length) return;
    buildOverlay();
    var multi = rels.length > 1;
    overlay.querySelector('#pp-wn-title').textContent = multi
      ? rels.length + ' updates since you were last here'
      : rels[0].title;
    overlay.querySelector('#pp-wn-date').textContent = multi
      ? rels[rels.length - 1].dateLabel + ' → ' + rels[0].dateLabel
      : rels[0].dateLabel;
    var body = overlay.querySelector('#pp-wn-body');
    body.innerHTML = '';
    rels.forEach(function (r) { body.appendChild(renderRelease(r, multi)); });
    body.scrollTop = 0;
    overlay.querySelector('#pp-wn-note').textContent = 'Reopen any time from What’s New in the menu.';
    overlay.classList.add('show');
  }

  // Closing IS the acknowledgement — there is no way to dismiss without marking
  // seen, so the modal cannot reappear on the next page you open.
  function close() {
    if (!overlay) return;
    overlay.classList.remove('show');
    setSeen(activeUid, latestId());
    syncNavBtn();
  }

  // ── Nav button ──
  // Self-mounts next to the existing nav links rather than making every page
  // add markup. Without it, dismissing the modal would hide the notes forever.
  function mountNavBtn() {
    if (document.getElementById('pp-wn-nav-btn')) return;
    var sibling = document.querySelector('.data-mig-btn');
    if (!sibling || !sibling.parentNode) return;
    var btn = document.createElement('button');
    btn.id = 'pp-wn-nav-btn';
    btn.className = sibling.className;
    btn.title = 'What’s new in PRE-PRO';
    btn.onclick = function () { open(WHATSNEW_RELEASES); };
    sibling.parentNode.insertBefore(btn, sibling);
    syncNavBtn();
  }

  function syncNavBtn() {
    var btn = document.getElementById('pp-wn-nav-btn');
    if (!btn) return;
    var pending = unseenReleases(activeUid).length > 0;
    btn.innerHTML = (pending ? '<span class="pp-wn-dot"></span>' : '') + '🆕 What’s New';
  }

  function onAuthReady(detail) {
    activeUid = (detail && detail.user && detail.user.uid) || '';
    mountNavBtn();
    var unseen = unseenReleases(activeUid);
    if (unseen.length) open(unseen);
    else syncNavBtn();
  }

  window.addEventListener('prepro:auth-ready', function (e) {
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', function () { onAuthReady(e.detail); });
    } else {
      onAuthReady(e.detail);
    }
  });

  window.preproWhatsNew = {
    open: function () { open(WHATSNEW_RELEASES); },
    // Escape hatch for testing the modal without clearing site data by hand.
    reset: function () { setSeen(activeUid, ''); syncNavBtn(); }
  };
})();

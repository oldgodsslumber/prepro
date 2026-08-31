# PRE-PRO — Project Intelligence Plan

Turning the nudge engine from a calendar-adjacency guesser into something that
reasons over what a project actually *is*, and giving subtasks a real job.

Written 2026-08-30. Branch `testing`. Nothing here is built yet.

---

## The problem, precisely

`prepro/state` can only represent **scheduled work**: a task is
`{person, role, date, endDate, loe}`. Every nudge pattern in `dash.html` is
therefore forced to infer intent from calendar adjacency — "there's a review in
3 days, so say something about drafts."

The things that actually get dropped are not on the calendar:

- "Email Sarah back about the voiceover" — no representation at all
- "Waiting on legal since Tuesday" — the ball's court is unrepresentable
- "Vendor quote was due Friday" — an expectation with an owner and a date

Three concrete gaps, all verified in the source:

1. **Notes are write-only.** Eight typed note kinds (`blocker`, `delay`,
   `direction`, `feedback`, `decision`, `team`, `update`, `system`) and exactly
   one reader — `patternRecentNote`, which looks back 7 days and can only say
   *"someone flagged a blocker — does today's task still fit?"* It cannot know
   what the blocker was, who owns it, or whether it is still open. A blocker
   logged three weeks ago is invisible to the entire app.

2. **Subtasks are orphans.** `{id, text, done}` in `prepro/dash`, keyed by
   `taskId`. No owner, no date, no project link. They cannot be overdue, cannot
   be assigned, cannot be nudged, and they silently orphan when the parent task
   is deleted in `team.html`.

3. **The brief is unread — and half of it was unwritable.** Corrected
   2026-08-31 while building Phase 1; the first draft of this plan got it
   partly wrong.

   Two separate problems, not one:

   - `synopsis`, `targetAudience`, `audienceDescription`, `scopeLevel`,
     `videoType`, `internalExternal`, `region`, `caseStatus`, `createDate` *are*
     populated from Pega and *are* displayed in team.html's Info tab — but grep
     count in `dash.html` and `ops.html` is **zero**. Carried, shown, never
     reasoned over.
   - `tangibleGoal1`, `tangibleGoal2`, `budget`, `function`, `completionIssues`,
     `additionalNotes` were **never populated by anything**. There is no column
     for them in `XL_COLUMN_MAP`, `buildProjectFromRow` hard-codes them to
     `null`, and no screen offered a way to type one. They existed in the
     project schema and in `computeMergeFieldPlan`'s conflict list, and were
     permanently empty. The Info tab hid them because a read-only row with no
     value renders as nothing.

   This matters because **"Tangible Goal" is the only field in the app that
   states what done looks like**, and it was unreachable. The original plan
   assumed requesters were filling it in.

---

## Settled design decisions

### 1. The missing primitive is a commitment, not a subtask

```js
{
  id,                 // genId()
  projectId,          // required — the project it belongs to
  text,               // "Send the vendor the revised scope"
  owner,              // person name (people.js resolved), or ''
  direction,          // 'mine' | 'theirs'   <- the ball's court
  due,                // 'YYYY-MM-DD' | null
  state,              // 'open' | 'waiting' | 'done' | 'dropped'
  waitingOn,          // person name, when direction === 'theirs'
  waitingSince,       // 'YYYY-MM-DD', set when it enters 'waiting'
  source,             // 'manual' | 'note:<noteId>' | 'nudge' | 'llm:extract'
  parentTaskId,       // optional — a subtask is a commitment with a parent
  createdBy, createdAt, closedAt
}
```

A subtask is just a commitment with a `parentTaskId`. That collapses two
concepts into one and gets checklists out of `prepro/dash`.

`direction: 'theirs'` is the field that unlocks the nudges we actually want,
and it needs no LLM to work.

### 2. Commitments live in their own Firebase node — NOT in `prepro/state`

This reverses an earlier instinct, for a reason found by reading the write path.

All three pages persist state with a **whole-node `set()`**:

- `team.html:3183` — `_pushStateToFirebase()`
- `ops.html:801` — `saveState()` (guards echoes with `_lastWrittenSig`)
- `dash.html:1230` — `saveState()`

That is last-write-wins over the entire project graph. Today it is tolerable
because `dash.html` almost never writes `state` — it writes `prepro/dash`.
Commitments would be **high-frequency writes originating mostly from dash**
(ticking things off, marking waiting). Putting them in `state` means every tick
rewrites all 30 projects and can clobber someone mid-edit in `team.html`.

So: **`prepro/commitments`**, a flat map `id -> commitment`, written with
`update()` at the individual-key path rather than `set()` on the whole node.
`prepro/dash` already exists for exactly this reason; this follows the
precedent and improves on it.

Trade-off accepted: commitments do not get `team.html`'s undo/history for free.
Mitigate with soft-delete (`state: 'dropped'`) rather than hard removal.

### 3. Two more fields, on the project itself

These are low-frequency, producer-maintained, and belong in `state`:

- `healthLine` — one sentence: what "done" looks like right now
- `openBlocker` — the single thing in the way, or null
- `cadenceDays` — expected contact rhythm (7 = weekly). Powers the cheapest
  possible fix for "I forgot to email them back."

### 4. The LLM does capture, not reasoning

The rules engine stays the thing that generates nudges: instant, free,
deterministic, auditable, and already genuinely smart (`findHeavyReviewer`
checks a reviewer's workload before saying "send early"). Nudges must be
trustworthy or people stop reading them.

Gemini's job is **turning unstructured text into structured commitments**.
Its output is always *proposed* and reviewed before it lands. That keeps the
model out of the trust path — downstream, the nudge engine only ever reads
clean structured data.

### 5. One Gemini key per person, free tier — decided 2026-08-30

Each person pastes their own AI Studio key into Settings, held in localStorage.
Same as storybible / vesta / storyboarder. Nobody is paying for this, so the
free tier's per-key daily limits are the operating constraint, not a footnote.

**No shared key in the repo, and no key written to `prepro/`.** This app is
multi-user off a public Pages repo against a wildcard-readable Firebase node —
a key there is a key published.

Three consequences that are requirements, not nice-to-haves:

- **The app must be fully functional with no key at all.** Everything through
  Phase 5 is deterministic; phases 6–8 are strictly additive. A person without
  a key sees no LLM affordances and loses nothing else. No dead buttons, no
  errors, no nagging.
- **Quota handling is load-bearing.** storybible2's client already tracks
  per-day usage per model, marks a model exhausted, and falls down the chain
  (`GEMINI_FALLBACK_CHAIN`, `getDailyUsage`, `markModelExhausted`,
  `pickActiveGeminiModel`). Port that part intact — on a free tier it *will*
  fire, routinely. When the whole chain is exhausted, say so plainly and fall
  back to the deterministic nudges rather than surfacing an API error.
- **The Phase 8 cache carries the team.** Since limits are per-key, one person
  running a sweep populates `prepro/advisory` for everyone — including people
  who never set up a key. That is the main reason the cache is shared rather
  than per-person.

### 6. No retrieval, no embeddings

A project dossier is ~1–3k tokens. Send the whole thing. Even the cross-project
question is answered by a thin one-line-per-project dossier, not a vector store.

---

## Phases

Each phase is independently shippable and useful on its own. Stop after any of
them and the app is still better than it was.

### Phase 0 — Guardrails (every phase, not once)

- Bump the cache-bust stamp in **all three pages**: `window.PREPRO_BUILD`, every
  `?v=` token on `auth.js` / `people.js` / `whatsnew.js` / `xlsx.full.min.js`,
  and `version.json`. All three carry the poll now (`index.html` does not).
- Add a `WHATSNEW_RELEASES` entry at the top of `whatsnew.js` for anything
  user-visible.
- Any new shared module is a **classic script** with `var` globals, loaded
  before each page's inline script — the `people.js` pattern. **Never redeclare
  a shared global with `let` in a page's inline script**; that is a
  redeclaration SyntaxError that kills the whole page.
- Commit and push to `testing`.

### Phase 1 — Read the brief — SHIPPED 2026-08-31, build `20260831a`

**No schema change. No LLM.**

Scope changed once the code was read (see gap 3 above): the goal fields could
not be "surfaced," because nothing had ever been able to write one. So Phase 1
had to give them an entry point before anything could read them.

- **`team.html`** — a new **Brief** section on the Info tab making `function`,
  `budget`, `tangibleGoal1`, `tangibleGoal2`, `completionIssues` and
  `additionalNotes` editable in place. Commit on blur, not per keystroke, since
  `saveState()` takes an undo snapshot and pushes the whole state to Firebase.
  Empty values are written as `null`, never `undefined`. Unlike the read-only
  ticket rows these stay visible when empty, or there would be no way to fill
  them.
- **`dash.html`** — `projectBrief(proj)` and `briefGoalShort(goal, max)`;
  `buildTaskContext` now returns `brief` and `scopeChange` (a `direction` note
  within 14 days — a wider window than `recentNotes`' 7, because a change of
  direction keeps mattering after it stops being news).
- **`patternGoalDrift`** — fires when a scope change has landed and the brief
  still states the original goal. Placed **above** `patternRecentNote` in the
  chain: that one also matches `direction` notes and, being earlier, would
  otherwise always win and ask the vaguer question.
- **`patternKeyDateApproaching`** now names the goal where one exists
  ("does today's work get you to X?") and keeps the old generic wording where
  none does.

*Verified:* 20 unit tests over the extracted functions — truncation on word
boundaries, whitespace-only goals, goal 2 without goal 1, missing `ctx.brief`,
day-count phrasing, and the no-goal fallback path.

**Known limitation:** the goal fields are producer-typed, so Phase 1's value is
gated on someone filling them in. Watch whether that actually happens — it is
the same capture-fatigue risk that makes Phase 3 the go/no-go gate, arriving
two phases early. If nobody fills them in, that is a real signal about Phase 3.

**Consequence for Phase 2:** `healthLine` as designed overlaps `tangibleGoal1`.
Do not add a second "what does done look like" field — decide whether
`healthLine` means something genuinely different (current state vs original
intent) or whether it should be dropped in favour of the goal fields now that
they are reachable.

### Phase 2 — The commitment data layer — SHIPPED 2026-08-31, build `20260831b`

- **`commitments.js`** — classic script, 40 globals, no collisions with any page
  (checked mechanically). Store, `prepro/commitments` sync, the full state
  machine, queries, prune and orphan detection, and the subtask migration
  planner. Written **one key at a time**: `set(ref(db, 'prepro/commitments/<id>'))`.
  A per-key `set()` does update()'s job and `set(path, null)` does remove()'s,
  which matters because `auth.js` exposes only `set/get/onValue` on `window._fb`.
- All three pages subscribe and repaint on genuine remote change; echoes of our
  own writes compare equal after normalisation and are ignored.
- **Migration** lives in dash Settings → Data, previewed, idempotent by
  `(parentTaskId, text)`, leaving `dashData.subtasks` untouched as a fallback.

**Two decisions taken while building:**

- **`healthLine` and `openBlocker` were dropped, not built.** `healthLine` is a
  second field answering "what does done look like" — that is `tangibleGoal1`,
  now that Phase 1 made it writable. `openBlocker` duplicates a commitment in
  the `waiting` state. Only `cadenceDays` survives onto the project, because
  nothing else can express it.
- **The migration resolver does not use `buildTaskLookup()`.** That map carries
  no project id and filters through `isActiveProject`, so every subtask on a
  completed or on-hold project would have been reported as an orphan and
  silently dropped. `subtaskParentIndex()` walks all projects instead.

*Verified:* 57 unit tests on the module (state machine clock semantics,
overdue, sort, stale detection, echo comparison, prune dry-run, idempotent
migration) plus 13 integration tests on the dash resolver, including the
completed-project case above.

### Phase 2 — original scope, for reference

- New classic script **`commitments.js`**: the store, Firebase sync against
  `prepro/commitments`, per-key `update()` writes, and the state machine
  (`open <-> waiting -> done | dropped`).
- Subscribe all three pages to the node.
- **Migration**: an explicit button (mirroring `renderPeopleMigration`) that
  converts every `dashData.subtasks[taskId]` entry into a commitment with
  `parentTaskId`, resolving `projectId` via `buildTaskLookup()`. Preview first
  — "N subtasks will move" — never silent. Leave `dashData.subtasks` in place,
  unread, for one release as a rollback.
- Add `healthLine`, `openBlocker`, `cadenceDays` to `createProject`
  (`team.html:3279`) with null defaults.

*Acceptance:* commitments round-trip across all three pages; two browsers
editing different commitments do not clobber each other; existing subtasks
appear as commitments after migration and the old checklist still renders.

### Phase 3 — Capture surfaces — SHIPPED 2026-08-31, build `20260831c`

All three funnels built as specified, plus one gap found while building.

- **Note promotion.** Two optional fields in the compose box — owner (datalist
  of every known person, departed excluded) and due date. `addNote` now returns
  the note so the commitment can carry `sourceId`. `promoteNoteToCommitment`
  infers the rest: naming somebody other than yourself means `direction:
  'theirs'`, `state: 'waiting'`, clock started at the note's date. That
  inference is what keeps capture at two fields instead of four.
- **Structured nudge replies.** `getTaskSuggestion` now returns
  `{text, pattern, key, task, project, ctx}` rather than a bare string, so a
  dismissal can be scoped to one pattern on one task. Handled = 30 days, Later
  = 3, both in `dashData.nudgeSnooze`. **Waiting on…** opens an inline form
  (not a `prompt()` — it needs the person datalist) and writes a real
  commitment, pre-seeded from the task by `defaultWaitText`, then snoozes the
  question it just answered.
- **Plan tab** (📌) in the tools rail: cadence selector, add row, and the loops
  split into waiting / mine / recently closed. Amber past 5 days waiting, red
  and day-counted when overdue.

**Gap found and closed:** commitments were in no backup at all. `prepro/state`
and `prepro/dash` are exported by all three pages, but the new node was not, so
the only copy of every commitment was whatever Firebase happened to hold. All
three exports now carry `prepro_commitments` (payload `version: 4`) and all
three imports merge it through one shared `mergeCommitmentsFromBackup` —
additive by id, so restoring an old backup can never undo newer work.

**Deliberately not `getAllPeople()`** for the waiting-on datalist: it filters
through `hasDashboard`, which excludes exactly the stakeholders, clients and
vendors most likely to be sitting on something. `dashPeopleNames()` reads the
person records instead.

*Verified:* 25 new tests (backup merge idempotence and normalisation, promotion
direction/clock inference, snooze expiry and per-pattern scoping, later-expiry-
wins merge) plus all 90 earlier tests re-run green against the changed files.

**Still true:** this is the go/no-go gate. The capture paths exist now; whether
they get used is the thing to watch before Phase 4 leans on them.

### Phase 3 — original scope, for reference

Everything above dies if entering data is work. Three funnels, no new habits:

1. **Note promotion.** The note editor in `renderNotesTab` gains two optional
   inline fields: *who's this on?* and *by when?* Filling either creates a
   commitment with `source: 'note:<id>'`. Two clicks turns a dead log entry
   into a live open loop, at the moment you were already typing.
2. **Nudge replies are structured.** Every nudge grows `Done` / `Snooze` /
   `Waiting on…`. Clicking `Waiting on Sarah` writes a commitment with
   `direction: 'theirs'`. The system asks a question and files your answer.
3. **A `Plan` tab in the `team.html` tools rail** (`data-tab="plan"`, added to
   `TAB_TITLES` at line 1539 and to the `exportTabActive` if/else chain in
   `renderExportPanel`). Holds project health, the open-loop list, and cadence.
   It sits beside the Notes tab that feeds it — which is why this is a tab and
   not a new page.

*Acceptance:* a blocker note can become an owned, dated commitment without
leaving the notes tab.

### Phase 4 — Nudge engine v2 — SHIPPED 2026-08-31, build `20260831d`

All five patterns built, plus the panel.

- `buildTaskContext` now carries `loops`, `staleWait`, `owed`, `blockerNote`,
  `blockerLoop`, `projectQuiet` and `cadence`. **`staleWait` and `owed` are
  scoped to the viewing person** — `staleWait` by `createdBy` (whoever is doing
  the chasing), `owed` by `owner`. Being told to chase somebody else's loop is
  noise, and there is a test pinning both.
- `sameName()` routes through people.js's `normalizePersonKey`, so a Pega-format
  "Walsh, Ryan" still matches "Ryan Walsh".
- `projectQuietDays()` is deliberately distinct from the existing `lastTouched`:
  that one is about this person, this one is about the project.
- **Chain order** encodes priority: unmovable dated things first, then the
  commitment-driven ones (concrete facts, and they will not resolve themselves
  by a date arriving), then the softer observations. `patternOpenBlocker` and
  `patternGoalDrift` both sit above `patternRecentNote`, which matches the same
  note types and would otherwise always win with vaguer wording.
- **Open Loops panel**, default-visible. Ordered by how long something has sat.
  The `↻` action restarts `waitingSince`, so the count means "since I last
  pushed" rather than "since this existed" — the more useful question once you
  have actually chased someone.

*Verified:* 42 pattern tests + 18 context-integration tests, and all 115 earlier
tests re-run green — 175 total across six suites.

**The loop is now closed end to end:** a blocker note in Team can be promoted to
an open loop, that loop drives a nudge in Dash, answering the nudge updates the
loop, and the panel ranks it against everything else you are waiting on. That
was the whole point of phases 1–4.

### Phase 4 — original scope, for reference

New patterns in the `getTaskSuggestion` chain, plus a cross-project **Open
Loops** panel added to `DASH_PANELS`:

- `patternWaitingStale` — *"Waiting on Sarah for the VO approval since Tuesday
  — 6 days. Follow up?"*
- `patternOwedByMe` — *"You owe Marcus a reply on vendor scope; review is
  Thursday."*
- `patternCadenceLapsed` — *"9 days since anything on Brand Refresh, and it's a
  weekly-cadence project."*
- `patternOpenBlocker` — replaces the blind `patternRecentNote` with one that
  knows the blocker is still open and who owns it.
- Upgrade `patternDrought` to name the last known open blocker instead of
  generically suggesting a resync.

*Acceptance:* the panel answers "what am I forgetting" across all projects,
ordered by how long the ball has been in someone else's court.

### Phase 5 — `buildProjectDossier()` — SHIPPED 2026-08-31, build `20260831e`

- **`dossier.js`** — pure, deterministic, no network and no page state beyond
  the project handed in. Sections: header, BRIEF, TEAM, TIMELINE, OPEN LOOPS,
  NOTES, DERIVED. Uses page helpers (`milestoneLabel`, `roleVerb`, `personTeam`)
  where they exist so wording cannot drift from what is on screen, and falls
  back where they do not — it is loaded by all three pages.
- Shipped as a **Text tab format switch** (Schedule / Dossier) in team.html,
  persisted like the active tab. Useful today with no LLM anywhere near it.
- `dossierThin()` and `buildDossierBundle()` for the cross-project case.
- **Empty sections announce themselves** rather than vanishing. "(empty — no
  brief imported and no goal typed in the Info tab)" is usually the most useful
  line on the page, and vanishing would have hidden it.

**Bug found by writing this, present since Phase 4:** a task spanning today was
counted as no activity at all. `endDate || date` tested against today drops an
in-flight multi-day task entirely, so a project someone was actively editing
could read as silent and fire `patternCadenceLapsed`. Both the nudge and the
DERIVED line now go through one `dsProjectQuietDays()`, and an in-flight task
resolves to "active today". This is exactly the class of bug the plan's phase-5
rationale predicted — *it forces the question "what do we actually know about a
project?"*

*Verified:* 56 dossier tests, and 231 total across seven suites.

### Phase 5 — original scope, for reference

A **pure, deterministic** serializer in a new `dossier.js`. No LLM. Renders one
project as compact text: identity, brief fields, roster, timeline
(past/today/future with done state), typed note history, open commitments, and
derived facts (days since last note, count past scheduled date, next
milestone).

Ship it as a **new Text export format** first. That makes it independently
useful, testable without an API key, and it forces the question the whole
redesign is really about: *what do we actually know about a project?*

Add `dossierThin(proj)` — one line per project — for cross-project calls later.

*Acceptance:* a live project renders as a dossier a person could brief
themselves from.

### Phase 6 — `prepro-llm.js`

Port, do not rewrite. `d:\claudecode\storybible2\js\llm.js` is the mature
client: fallback chain, per-day usage tracking with exhaustion marking, retry
with backoff on transient errors, per-attempt timeouts, abort signals,
`parseJsonLoose` (fences + brace balancing), and a JSON-repair second pass.

Two grafts:

- **`responseSchema`** from `d:\claudecode\storyboarder\js\providers.js`
  (~line 59). storybible2 sends only `responseMimeType`; a real schema is the
  difference between "usually valid JSON" and "conforms to our commitment
  shape."
- **`gemini-registry/models.json`** as the model source of truth rather than a
  hardcoded chain. Its README documents two silent failures worth inheriting:
  Gemma *accepts then ignores* `responseMimeType`, and `thinkingBudget` is
  rejected by `gemini-3.5-flash-lite` while `thinkingLevel` works everywhere.

Convert from ES module to classic script per Phase 0.

*Acceptance:* a Settings "test connection" button round-trips a schema-
constrained JSON call.

### Phase 7 — Extraction (the paste box)

One box in the Plan tab: paste an email thread, Teams thread, or meeting
bullets. Input is the *new text*; the dossier rides along as context only, so
the model can resolve "Marcus" to a real person and "the review" to a real
task. Flash-tier model, `responseSchema`-constrained.

Output is a **proposed** list of commitments rendered as a review checklist —
the same pattern the Excel import review modal (`excelReviewModal`) already
uses. Nothing is written until you tick and confirm.

*Acceptance:* pasting a real thread yields commitments you would actually keep,
and a hallucinated one is visibly rejectable before it lands.

### Phase 8 — Advisory + the dossier hash cache

"Read this whole project and tell me what's slipping." Input *is* the dossier.
Output is structured — a health line, proposed commitments, stale-note flags —
never free prose.

**Cost discipline is the design here.** 30 projects × 5 people × every page load
is a runaway. So:

- `dossierHash = hash(buildProjectDossier(proj))`
- Store the advisory result **with its hash** in a shared node
  (`prepro/advisory`) so everyone reads one cached analysis
- Re-run only when the hash changes, and only on explicit request or a
  deliberate sweep — never on render
- Free feature that falls out: *"this analysis predates Marcus's feedback
  note."*

*Acceptance:* opening dash 20 times costs zero API calls.

---

## Open decisions

### Does `direction: 'theirs'` match reality?

The whole commitment model leans on the ball's-court field. Worth a sanity
check against a week of real dropped balls before Phase 2 hardens the schema.

---

## Risks

- **Whole-node `set()` on `prepro/state`** is a pre-existing last-write-wins
  risk. This plan avoids *adding* to it (decision 2) but does not fix it.
- **Capture fatigue** is the real failure mode, not anything technical. If
  Phase 3 does not land well, Phases 4–8 have nothing to reason over.
- **`prepro/commitments` grows unbounded.** Add an archive/prune path for
  `done` + `dropped` older than ~90 days before it becomes a problem.
- **Two-tier team.** With per-person free-tier keys, some people will have LLM
  capture and some will not, and the ones who do will hit daily limits. Design
  every LLM surface as an accelerator on a path that already works without it —
  never the only way to enter a commitment.
- **System-note noise.** `addSystemNote` already fires on project create; if
  commitments also write system notes, the notes tab becomes unreadable and
  `patternRecentNote` gets noisier. Keep commitments out of the note log.

---

## Suggested order of attack

1. **Phase 1** — a day's work, no schema change, immediately smarter nudges
2. **Phase 5** — pure function, testable, better Text export whether or not
   Gemini is ever wired in
3. **Phase 2 → 3 → 4** — the deterministic core; this is where drowning stops
4. **Phase 6 → 7 → 8** — the LLM layer, once there is a schema worth filling

Phases 1–5 need no API key and no Gemini decision. Phases 1–4 are what make the
app stop guessing; 6–8 are what make it sustainable when you are too busy to
type.

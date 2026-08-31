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

3. **The imported brief is unread.** `buildProjectFromRow` already writes
   `synopsis`, `tangibleGoal1`, `tangibleGoal2`, `targetAudience`, `videoType`,
   `scopeLevel`, `budget`, `internalExternal`, `audienceDescription`,
   `completionIssues`, `region` onto every imported project. Grep count for any
   of those in `dash.html` and `ops.html`: **zero**. We are already carrying a
   project brief that no nudge has ever looked at.

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

### 5. No retrieval, no embeddings

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

### Phase 1 — Read the brief we already import

**No schema change. No LLM. Highest value per hour in the plan.**

- Surface the Pega fields in the `team.html` Info tab (stored today, several
  never shown).
- Feed them to `buildTaskContext` in `dash.html` so patterns can reference
  `tangibleGoal1/2` — literally "what does done look like," already filled in
  by the requester.
- New pattern `patternGoalDrift`: on a project whose brief names a tangible
  goal, when a `direction` (scope change) note has landed since the brief,
  surface both together.

*Acceptance:* opening a Pega-imported project shows its synopsis and goals; at
least one nudge quotes a brief field.

### Phase 2 — The commitment data layer

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

### Phase 3 — Capture surfaces (the go/no-go gate)

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

### Phase 4 — Nudge engine v2

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

### Phase 5 — `buildProjectDossier()`

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

### Whose API key (needs a call before Phase 6)

`prepro` is not like the other Gemini apps. They are single-user; this is
multi-user, deployed from a public GitHub Pages repo, against a Firebase node
that is wildcard-readable. **No shared key in the repo, and no key in
`prepro/`.**

- **(a) Per-person key in Settings**, localStorage — matches storybible /
  vesta / storyboarder, zero new infrastructure, and free-tier limits are
  per-key so it scales *better* across the team. Cost: everyone makes a key
  once, and nudge quality depends on whether they bothered. The Phase 8 cache
  softens this — one person with a key populates analysis everyone reads.
- **(b) A proxy** — Cloud Function, or Apps Script (there is already an
  `apps-script/` folder doing Pega ingest) holding one key server-side. Cleaner
  and centrally controlled, but real infrastructure plus a rate-limiting
  problem.

**Recommendation: (a), trialled with two people. Build (b) only if it earns it.**

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

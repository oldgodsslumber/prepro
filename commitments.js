/* ── PRE-PRO · SHARED COMMITMENTS MODULE ─────────────────────────────────────
 *
 * A commitment is an **open loop**: something that is owed, by someone, ideally
 * by a date. It is the noun the app was missing.
 *
 * `prepro/state` models *scheduled work* — a task is a person, a role and a
 * date range. That is why every nudge in dash.html could only ever reason from
 * calendar adjacency. The things that actually get dropped are not on the
 * calendar: "email Sarah back", "waiting on legal since Tuesday", "the vendor
 * quote was due Friday". None of those are tasks, and none of them had anywhere
 * to live.
 *
 * `direction` is the field that earns this module its keep. Knowing whose court
 * the ball is in is what turns a to-do list into something that can say "you
 * have been waiting on Sarah for six days".
 *
 * A SUBTASK IS JUST A COMMITMENT WITH A PARENT. dash.html used to keep subtasks
 * in `prepro/dash` as {id, text, done} — no owner, no date, no project, unable
 * to be overdue or nudged, and silently orphaned whenever team.html deleted the
 * parent task. They migrate into here and gain all of that.
 *
 * ── Why its own Firebase node ──
 * All three pages persist `prepro/state` with a WHOLE-NODE set(). That is
 * last-write-wins across every project, and it is survivable today only because
 * dash.html almost never writes state. Commitments are high-frequency writes
 * originating mostly from dash — ticking things off, marking waiting — so
 * putting them in `state` would rewrite all thirty projects on every tick and
 * clobber anyone mid-edit in team.html.
 *
 * So commitments live in `prepro/commitments` and are written ONE KEY AT A
 * TIME: set(ref(db, 'prepro/commitments/<id>'), obj). In Firebase RTDB a write
 * to a child path leaves its siblings untouched, so two people editing
 * different commitments cannot clobber each other. (auth.js exposes set/get/
 * onValue on window._fb but not update/remove — a per-key set() does the job of
 * update(), and set(path, null) does the job of remove().)
 *
 * Loaded as a CLASSIC script before each page's inline script, the same way
 * people.js is, so these globals exist by the time that script runs. Do NOT
 * redeclare any of them with let/const in a page — that is a redeclaration
 * SyntaxError and it kills the whole page.
 * ─────────────────────────────────────────────────────────────────────────── */
'use strict';

// ── VOCABULARY ──
// open    — owed, nobody is blocking it
// waiting — the ball is in someone else's court; `waitingSince` is set
// done    — closed out
// dropped — deliberately abandoned. A soft delete: commitments are never hard
//           removed in normal use, because this node has no undo history the
//           way team.html's state does.
var COMMITMENT_STATES = ['open', 'waiting', 'done', 'dropped'];
var COMMITMENT_OPEN_STATES = ['open', 'waiting'];

var COMMITMENT_STATE_DISPLAY = {
  open:    { label: 'Open',    emoji: '○' },
  waiting: { label: 'Waiting', emoji: '⏳' },
  done:    { label: 'Done',    emoji: '✓' },
  dropped: { label: 'Dropped', emoji: '—' }
};

// 'mine'   — I owe this to someone
// 'theirs' — someone owes it to me. The whole point of the module.
var COMMITMENT_DIRECTIONS = ['mine', 'theirs'];

var COMMITMENT_SOURCES = ['manual', 'note', 'nudge', 'subtask', 'llm'];

// ── STORE ──
var commitments = {}; // id -> commitment

function cmTodayStr() {
  var d = new Date();
  return d.getFullYear() + '-' +
         String(d.getMonth() + 1).padStart(2, '0') + '-' +
         String(d.getDate()).padStart(2, '0');
}

// Own id generator: each page has its own genId() and this module loads before
// all of them.
function genCommitmentId() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function cmClean(v) {
  var s = (v == null ? '' : String(v)).trim();
  return s;
}

// Firebase strips nulls and empty strings, so a raw echo of our own write never
// comes back byte-identical to what we sent. Normalising both sides before
// comparing is what stops our own write from reading as a teammate's edit and
// repainting the world on every keystroke — the same trick people.js uses.
function normalizeCommitment(c) {
  c = c || {};
  var state = COMMITMENT_STATES.indexOf(c.state) >= 0 ? c.state : 'open';
  var direction = COMMITMENT_DIRECTIONS.indexOf(c.direction) >= 0 ? c.direction : 'mine';
  return {
    id:           cmClean(c.id),
    projectId:    cmClean(c.projectId),
    text:         cmClean(c.text),
    owner:        cmClean(c.owner),
    direction:    direction,
    due:          cmClean(c.due) || null,
    state:        state,
    waitingOn:    cmClean(c.waitingOn),
    waitingSince: cmClean(c.waitingSince) || null,
    source:       cmClean(c.source) || 'manual',
    sourceId:     cmClean(c.sourceId) || null,
    parentTaskId: cmClean(c.parentTaskId) || null,
    createdBy:    cmClean(c.createdBy),
    createdAt:    cmClean(c.createdAt) || null,
    closedAt:     cmClean(c.closedAt) || null
  };
}

function normalizeCommitments(src) {
  var out = {};
  Object.keys(src || {}).sort().forEach(function (id) {
    var c = normalizeCommitment(src[id]);
    c.id = c.id || id;
    out[id] = c;
  });
  return out;
}

// Returns true when the incoming snapshot genuinely differs from what we hold.
function applyRemoteCommitments(data) {
  var incoming = normalizeCommitments(data || {});
  if (JSON.stringify(incoming) === JSON.stringify(normalizeCommitments(commitments))) return false;
  commitments = incoming;
  return true;
}

function hasCommitments() { return Object.keys(commitments || {}).length > 0; }

// ── WRITES ──
// One key at a time. See the header for why this is not a whole-node set().
function _writeCommitment(id) {
  if (!window._fb) return;
  var fb = window._fb;
  var c = commitments[id];
  fb.set(fb.ref(fb.db, 'prepro/commitments/' + id), c == null ? null : c)
    .catch(function (err) { console.error('writeCommitment:', err); });
}

function getCommitment(id) { return (commitments && commitments[id]) || null; }

// `patch.text` and `patch.projectId` are the only things really required; the
// rest have sane defaults so a caller can create one from a single typed line.
function createCommitment(patch) {
  patch = patch || {};
  var id = genCommitmentId();
  var c = normalizeCommitment(patch);
  c.id = id;
  if (!c.createdAt) c.createdAt = cmTodayStr();
  // Creating something already marked waiting still needs its clock started.
  if (c.state === 'waiting' && !c.waitingSince) c.waitingSince = c.createdAt;
  if (c.direction === 'theirs' && !c.waitingOn) c.waitingOn = c.owner;
  commitments[id] = c;
  _writeCommitment(id);
  return c;
}

function updateCommitment(id, patch) {
  var cur = commitments[id];
  if (!cur) return null;
  var merged = {};
  Object.keys(cur).forEach(function (k) { merged[k] = cur[k]; });
  Object.keys(patch || {}).forEach(function (k) {
    // Never let undefined reach synced state: one undefined makes the Firebase
    // set() throw and silently kills every later save.
    merged[k] = patch[k] === undefined ? cur[k] : patch[k];
  });
  var next = normalizeCommitment(merged);
  next.id = id;
  if (JSON.stringify(next) === JSON.stringify(cur)) return cur;
  commitments[id] = next;
  _writeCommitment(id);
  return next;
}

// The state machine. Kept in one place so 'waiting' can never be entered
// without starting its clock, and so re-opening something clears the clock
// rather than leaving a stale "waiting 40 days" behind.
function setCommitmentState(id, next, opts) {
  var c = commitments[id];
  if (!c) return null;
  if (COMMITMENT_STATES.indexOf(next) < 0) return c;
  opts = opts || {};
  var today = opts.today || cmTodayStr();
  var patch = { state: next };

  if (next === 'waiting') {
    // Only start the clock on entry, so repeated saves don't keep resetting it.
    if (c.state !== 'waiting' || !c.waitingSince) patch.waitingSince = today;
    if (opts.waitingOn) patch.waitingOn = opts.waitingOn;
    patch.direction = 'theirs';
    patch.closedAt = null;
  } else if (next === 'open') {
    patch.waitingSince = null;
    patch.closedAt = null;
  } else {
    // done | dropped
    patch.closedAt = today;
  }
  return updateCommitment(id, patch);
}

function completeCommitment(id, opts) { return setCommitmentState(id, 'done', opts); }
function dropCommitment(id, opts)     { return setCommitmentState(id, 'dropped', opts); }
function reopenCommitment(id, opts)   { return setCommitmentState(id, 'open', opts); }
function waitOnCommitment(id, person, opts) {
  opts = opts || {};
  opts.waitingOn = person;
  return setCommitmentState(id, 'waiting', opts);
}

// Hard delete. Only for the prune path and for cleaning up a mistake — normal
// closing is done/dropped, because there is no undo on this node.
function purgeCommitment(id) {
  if (!commitments[id]) return false;
  delete commitments[id];
  if (window._fb) {
    var fb = window._fb;
    fb.set(fb.ref(fb.db, 'prepro/commitments/' + id), null)
      .catch(function (err) { console.error('purgeCommitment:', err); });
  }
  return true;
}

// ── QUERIES ──
function allCommitments() {
  return Object.keys(commitments || {}).map(function (id) { return commitments[id]; });
}

function commitmentIsOpen(c) { return !!c && COMMITMENT_OPEN_STATES.indexOf(c.state) >= 0; }

function commitmentsForProject(projectId, opts) {
  opts = opts || {};
  return allCommitments().filter(function (c) {
    if (c.projectId !== projectId) return false;
    if (opts.openOnly && !commitmentIsOpen(c)) return false;
    return true;
  }).sort(cmSort);
}

function commitmentsForTask(taskId, opts) {
  opts = opts || {};
  return allCommitments().filter(function (c) {
    if (c.parentTaskId !== taskId) return false;
    if (opts.openOnly && !commitmentIsOpen(c)) return false;
    return true;
  }).sort(cmSort);
}

// Things this person owes.
function commitmentsOwedBy(name, opts) {
  opts = opts || {};
  var key = typeof normalizePersonKey === 'function' ? normalizePersonKey(name) : String(name || '').toLowerCase();
  return allCommitments().filter(function (c) {
    if (c.direction !== 'mine') return false;
    if (opts.openOnly !== false && !commitmentIsOpen(c)) return false;
    var owner = typeof normalizePersonKey === 'function' ? normalizePersonKey(c.owner) : String(c.owner || '').toLowerCase();
    return owner && owner === key;
  }).sort(cmSort);
}

// Things this person is waiting on somebody else for.
function commitmentsAwaitedBy(name, opts) {
  opts = opts || {};
  var key = typeof normalizePersonKey === 'function' ? normalizePersonKey(name) : String(name || '').toLowerCase();
  return allCommitments().filter(function (c) {
    if (c.direction !== 'theirs') return false;
    if (opts.openOnly !== false && !commitmentIsOpen(c)) return false;
    var by = typeof normalizePersonKey === 'function' ? normalizePersonKey(c.createdBy) : String(c.createdBy || '').toLowerCase();
    return by && by === key;
  }).sort(cmSort);
}

// Everything waiting on a given person, whoever is chasing them.
function commitmentsWaitingOn(name, opts) {
  opts = opts || {};
  var key = typeof normalizePersonKey === 'function' ? normalizePersonKey(name) : String(name || '').toLowerCase();
  return allCommitments().filter(function (c) {
    if (c.state !== 'waiting') return false;
    var w = typeof normalizePersonKey === 'function' ? normalizePersonKey(c.waitingOn) : String(c.waitingOn || '').toLowerCase();
    return w && w === key;
  }).sort(cmSort);
}

function cmDaysBetween(a, b) {
  if (!a || !b) return null;
  var d1 = new Date(a + 'T00:00:00'), d2 = new Date(b + 'T00:00:00');
  if (isNaN(d1) || isNaN(d2)) return null;
  return Math.round((d2 - d1) / 86400000);
}

// How long the ball has been in their court.
function commitmentWaitingDays(c, today) {
  if (!c || c.state !== 'waiting' || !c.waitingSince) return null;
  return cmDaysBetween(c.waitingSince, today || cmTodayStr());
}

function commitmentIsOverdue(c, today) {
  if (!commitmentIsOpen(c) || !c.due) return false;
  return c.due < (today || cmTodayStr());
}

function commitmentOverdueDays(c, today) {
  if (!commitmentIsOverdue(c, today)) return null;
  return cmDaysBetween(c.due, today || cmTodayStr());
}

// Overdue first, then soonest due, then undated, then oldest-created. Stable
// enough that a list does not reshuffle as things are ticked off.
function cmSort(a, b) {
  var ao = a.due ? 0 : 1, bo = b.due ? 0 : 1;
  if (ao !== bo) return ao - bo;
  if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
  var ac = a.createdAt || '', bc = b.createdAt || '';
  if (ac !== bc) return ac.localeCompare(bc);
  return String(a.id).localeCompare(String(b.id));
}

// Open loops that have gone quiet. `minDays` defaults to a working week, which
// is roughly when "I'll get to it" stops being true.
function staleWaitingCommitments(minDays, today) {
  var t = today || cmTodayStr();
  var min = minDays == null ? 5 : minDays;
  return allCommitments().filter(function (c) {
    var d = commitmentWaitingDays(c, t);
    return d != null && d >= min;
  }).sort(function (a, b) {
    return (commitmentWaitingDays(b, t) || 0) - (commitmentWaitingDays(a, t) || 0);
  });
}

// ── HOUSEKEEPING ──
// Closed commitments accumulate forever otherwise. Returns the ids it would
// remove; pass {apply:true} to actually remove them.
function pruneClosedCommitments(olderThanDays, opts) {
  opts = opts || {};
  var cutDays = olderThanDays == null ? 90 : olderThanDays;
  var today = opts.today || cmTodayStr();
  var ids = allCommitments().filter(function (c) {
    if (commitmentIsOpen(c)) return false;
    if (!c.closedAt) return false;
    var age = cmDaysBetween(c.closedAt, today);
    return age != null && age > cutDays;
  }).map(function (c) { return c.id; });
  if (opts.apply) ids.forEach(purgeCommitment);
  return ids;
}

// Commitments whose project no longer exists. The old subtasks orphaned exactly
// this way and nothing ever noticed, so this time there is a way to look.
function orphanedCommitments(projectIds) {
  var live = {};
  (projectIds || []).forEach(function (id) { live[id] = true; });
  return allCommitments().filter(function (c) { return !c.projectId || !live[c.projectId]; });
}

// ── SUBTASK MIGRATION ──
// `subtasks` is dashData.subtasks: taskId -> [{id, text, done}].
// `resolve` is supplied by the page (only dash.html can walk its own lookup)
// and returns {projectId, projectName, taskName, person} or null for a subtask
// whose parent task has since been deleted.
//
// Returns a PLAN, not a result. Nothing is written until runSubtaskMigration is
// called with it — the same explicit-preview shape the people migration uses,
// because a silent bulk write into a shared node is not something to spring on
// a team.
function planSubtaskMigration(subtasks, resolve, opts) {
  opts = opts || {};
  var today = opts.today || cmTodayStr();
  var plan = { move: [], orphans: [], alreadyDone: 0, total: 0 };

  Object.keys(subtasks || {}).forEach(function (taskId) {
    var subs = subtasks[taskId];
    if (!Array.isArray(subs)) return;
    subs.forEach(function (sub) {
      if (!sub || !cmClean(sub.text)) return;
      plan.total++;
      var info = null;
      try { info = resolve ? resolve(taskId) : null; } catch (_) { info = null; }
      if (!info || !info.projectId) {
        plan.orphans.push({ taskId: taskId, text: cmClean(sub.text), done: !!sub.done });
        return;
      }
      if (sub.done) plan.alreadyDone++;
      plan.move.push({
        taskId: taskId,
        projectId: info.projectId,
        projectName: info.projectName || '',
        taskName: info.taskName || '',
        text: cmClean(sub.text),
        owner: cmClean(info.person),
        done: !!sub.done,
        today: today
      });
    });
  });
  return plan;
}

// Writes the plan. Idempotent by (parentTaskId, text): running it twice does not
// duplicate, so a half-finished migration can simply be re-run.
function runSubtaskMigration(plan, opts) {
  opts = opts || {};
  var createdBy = cmClean(opts.createdBy);
  var made = 0, skipped = 0;

  (plan && plan.move || []).forEach(function (m) {
    var dup = allCommitments().some(function (c) {
      return c.parentTaskId === m.taskId && c.text === m.text;
    });
    if (dup) { skipped++; return; }
    createCommitment({
      projectId:    m.projectId,
      text:         m.text,
      owner:        m.owner,
      direction:    'mine',
      state:        m.done ? 'done' : 'open',
      source:       'subtask',
      sourceId:     m.taskId,
      parentTaskId: m.taskId,
      createdBy:    createdBy,
      createdAt:    m.today,
      closedAt:     m.done ? m.today : null
    });
    made++;
  });
  return { created: made, skipped: skipped, orphans: (plan && plan.orphans || []).length };
}

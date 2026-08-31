/* ── PRE-PRO · PROJECT DOSSIER ───────────────────────────────────────────────
 *
 * Renders one project as a compact text document: what it is for, who is on it,
 * what has happened, what is still open, and what that adds up to.
 *
 * PURE AND DETERMINISTIC. No network, no model, no page state beyond the
 * project handed in. That is the point — this ships as a text export that is
 * useful on its own, it can be tested without an API key, and if an LLM layer
 * is ever built on top, this is the reference document it reads. Getting the
 * serializer right is most of that work; the prompt is the easy half.
 *
 * It answers the question the whole redesign turned on: *what do we actually
 * know about a project?* Everything here already existed in the data. Until
 * Phase 1 nothing outside team.html read the brief, and until Phase 2 there was
 * nowhere to record an open loop at all.
 *
 * Loaded as a CLASSIC script after commitments.js, whose globals it uses when
 * they are present and does without when they are not.
 * ─────────────────────────────────────────────────────────────────────────── */
'use strict';

var DOSSIER_LINE = '────────────────────────────────────────────────────────';

function dsToday() {
  if (typeof cmTodayStr === 'function') return cmTodayStr();
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function dsClean(v) { return (v == null ? '' : String(v)).trim(); }

function dsDays(a, b) {
  if (!a || !b) return null;
  var d1 = new Date(a + 'T00:00:00'), d2 = new Date(b + 'T00:00:00');
  if (isNaN(d1) || isNaN(d2)) return null;
  return Math.round((d2 - d1) / 86400000);
}

// "2026-09-15" → "Sep 15". Kept short because the timeline is the widest part
// of the document and full ISO dates on every row drown the content.
function dsShort(iso) {
  if (!iso) return '';
  var d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  var M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return M[d.getMonth()] + ' ' + d.getDate();
}

function dsPad(s, n) {
  s = String(s == null ? '' : s);
  return s.length >= n ? s : s + new Array(n - s.length + 1).join(' ');
}

// Days since anything happened on this project — any task, any note.
//
// The subtlety that makes this worth its own function: a task that STARTED in
// the past and has not finished yet is activity happening right now, so it
// counts as today. Taking `endDate || date` and testing it against today drops
// such a task entirely, which makes a project somebody is actively editing
// look silent — and fires a cadence nudge at exactly the wrong moment.
// dash.html's nudges and the DERIVED section both read this one implementation
// so they cannot drift apart.
function dsProjectQuietDays(proj, today) {
  if (!proj) return null;
  var latest = '';
  var bump = function (d) { if (d && d <= today && d > latest) latest = d; };

  (proj.tasks || []).forEach(function (t) {
    if (!t || !t.date) return;
    if (t.date > today) return;                  // hasn't started
    var end = t.endDate || t.date;
    bump(end > today ? today : end);             // in flight → today
  });
  (proj.notes || []).forEach(function (n) { if (n) bump(n.date); });

  if (!latest) return null;
  return dsDays(latest, today);
}

// Status re-derived from the flags rather than imported: projStatus() lives in
// team.html and this file is loaded by pages that do not have it.
function dossierStatus(proj) {
  if (!proj) return 'active';
  if (proj.completed) return 'completed';
  if (proj.onHold)    return 'on hold';
  if (proj.cancelled) return 'cancelled';
  if (proj.draft)     return 'draft';
  return 'active';
}

// Uses the page's own helpers where they exist so wording cannot drift from
// what is on screen, and falls back to something sane where they do not.
function dsTaskName(task) {
  if (!task) return 'Task';
  if (task.taskName) return dsClean(task.taskName);
  if (task.isReview) return dsClean(task.reviewLabel) || 'Review';
  if (task.isDueDate) {
    if (typeof milestoneLabel === 'function') return milestoneLabel(task.milestoneType);
    return dsClean(task.milestoneType) || 'Milestone';
  }
  if (typeof roleVerb === 'function') return roleVerb(task.role);
  return dsClean(task.role) || 'Task';
}

// ── SECTIONS ──

function dsHeader(proj, out) {
  var name = dsClean(proj.name) || 'Untitled';
  out.push('PROJECT  ' + name);
  out.push(DOSSIER_LINE);

  var line1 = ['Status: ' + dossierStatus(proj)];
  if (dsClean(proj.leadProducer)) line1.push('Lead: ' + dsClean(proj.leadProducer));
  var due = dsProjectDue(proj);
  if (due) line1.push('Due: ' + due);
  if (proj.cadenceDays) line1.push('Cadence: every ' + proj.cadenceDays + 'd');
  out.push(line1.join('  ·  '));
}

// The due date a human means: the explicit dueDate field, else the earliest
// task flagged as a due date that is not PTO or a holiday.
function dsProjectDue(proj) {
  if (dsClean(proj.dueDate)) return dsClean(proj.dueDate);
  var dues = (proj.tasks || []).filter(function (t) {
    return t && t.isDueDate && t.milestoneType !== 'pto' && t.milestoneType !== 'holiday' && t.date;
  }).map(function (t) { return t.date; }).sort();
  return dues[0] || '';
}

function dsBrief(proj, out) {
  var goals = [dsClean(proj.tangibleGoal1), dsClean(proj.tangibleGoal2)].filter(Boolean);
  var rows = [
    ['Brief',      dsClean(proj.synopsis)],
    ['Done means', goals.join('  /  ')],
    ['Audience',   dsClean(proj.targetAudience)],
    ['Audience+',  dsClean(proj.audienceDescription)],
    ['Type',       dsClean(proj.videoType)],
    ['Scope',      dsClean(proj.scopeLevel)],
    ['Int/Ext',    dsClean(proj.internalExternal)],
    ['Region',     dsClean(proj.region)],
    ['Function',   dsClean(proj.function)],
    ['Budget',     dsClean(proj.budget)],
    ['Known risk', dsClean(proj.completionIssues)],
    ['Also',       dsClean(proj.additionalNotes)]
  ].filter(function (r) { return !!r[1]; });

  out.push('');
  out.push('BRIEF');
  if (!rows.length) {
    // Said plainly rather than omitted: an empty brief is itself the finding,
    // and the most common reason a nudge has nothing useful to say.
    out.push('  (empty — no brief imported and no goal typed in the Info tab)');
    return;
  }
  rows.forEach(function (r) { out.push('  ' + dsPad(r[0], 11) + ' ' + r[1]); });
}

function dsTeam(proj, out) {
  var seen = {}, rows = [];
  var add = function (name, role) {
    name = dsClean(name);
    if (!name) return;
    if (!seen[name]) { seen[name] = { roles: {} }; rows.push(name); }
    if (role) seen[name].roles[dsClean(role)] = true;
  };
  Object.keys(proj.roster || {}).forEach(function (role) {
    (proj.roster[role] || []).forEach(function (n) { add(n, role); });
  });
  (proj.tasks || []).forEach(function (t) {
    if (t.person) add(t.person, t.role);
    (t.attendees || []).forEach(function (a) { if (a && a.person) add(a.person, a.role); });
  });

  out.push('');
  out.push('TEAM');
  if (!rows.length) { out.push('  (nobody assigned)'); return; }
  rows.sort().forEach(function (name) {
    var roles = Object.keys(seen[name].roles).sort().join(', ');
    var team = typeof personTeam === 'function' ? personTeam(name) : '';
    var label = team && typeof teamLabel === 'function' ? teamLabel(team) : '';
    var lead = dsClean(proj.leadProducer) === name ? '  ← lead' : '';
    out.push('  ' + dsPad(name, 22) + (roles ? roles : '—') + (label ? ' (' + label + ')' : '') + lead);
  });
}

// Past / today / future in one list, because the useful reading of a project is
// where it is in its own arc — not two separate tables.
function dsTimeline(proj, out, opts) {
  var today = opts.today;
  var isDone = typeof opts.isTaskDone === 'function' ? opts.isTaskDone : function () { return false; };

  var rows = (proj.tasks || []).filter(function (t) { return t && t.date; })
    .slice()
    .sort(function (a, b) {
      var c = String(a.date).localeCompare(String(b.date));
      return c !== 0 ? c : String(dsTaskName(a)).localeCompare(String(dsTaskName(b)));
    });

  out.push('');
  out.push('TIMELINE');
  if (!rows.length) { out.push('  (nothing scheduled)'); return; }

  var markedToday = false;
  rows.forEach(function (t) {
    var end = t.endDate || t.date;
    var span = t.endDate && t.endDate !== t.date
      ? dsShort(t.date) + '–' + dsShort(t.endDate)
      : dsShort(t.date);

    var mark = '  ';
    if (end < today) mark = isDone(t.id) ? '✓ ' : '· ';
    else if (t.date <= today && end >= today) mark = '▸ ';

    var who = dsClean(t.person);
    var name = dsTaskName(t);
    var bits = [dsPad(span, 15), (who ? dsPad(who, 18) : dsPad('—', 18)), name];
    if (t.isDueDate) bits[2] = name.toUpperCase();

    var line = '  ' + mark + bits.join(' ');
    if (!markedToday && t.date <= today && end >= today) { line += '   ← today'; markedToday = true; }
    out.push(line);
  });

  // If nothing spans today, say where today falls in the arc anyway — an empty
  // present is exactly the state a drowning producer needs pointed out.
  if (!markedToday) {
    var next = rows.filter(function (t) { return t.date > today; })[0];
    out.push('  ' + (next
      ? '(nothing scheduled today — next is ' + dsShort(next.date) + ')'
      : '(nothing scheduled today, and nothing ahead)'));
  }
}

function dsLoops(proj, out, opts) {
  if (typeof commitmentsForProject !== 'function') return;
  var today = opts.today;
  var all = commitmentsForProject(proj.id) || [];
  var open = all.filter(function (c) { return c.state === 'open' || c.state === 'waiting'; });

  out.push('');
  out.push('OPEN LOOPS');
  if (!open.length) {
    out.push(all.length ? '  (none open — ' + all.length + ' closed)' : '  (none recorded)');
    return;
  }
  open.forEach(function (c) {
    var bits = [];
    if (c.state === 'waiting') {
      var d = typeof commitmentWaitingDays === 'function' ? commitmentWaitingDays(c, today) : null;
      bits.push('waiting on ' + (dsClean(c.waitingOn) || '?') + (d != null ? ' · ' + d + 'd' : ''));
    } else if (dsClean(c.owner)) {
      bits.push(dsClean(c.owner));
    }
    if (c.due) {
      var late = typeof commitmentOverdueDays === 'function' ? commitmentOverdueDays(c, today) : null;
      bits.push(late ? 'DUE ' + dsShort(c.due) + ' · ' + late + 'd LATE' : 'due ' + dsShort(c.due));
    }
    var mark = c.state === 'waiting' ? '⏳' : '○';
    out.push('  ' + mark + ' ' + c.text + (bits.length ? '  [' + bits.join(' · ') + ']' : ''));
  });
}

function dsNotes(proj, out, opts) {
  var max = opts.maxNotes == null ? 15 : opts.maxNotes;
  var notes = (proj.notes || []).filter(function (n) { return n && n.date && n.type !== 'system'; })
    .slice()
    .sort(function (a, b) {
      var c = String(b.date).localeCompare(String(a.date));
      return c !== 0 ? c : String(b.time || '').localeCompare(String(a.time || ''));
    });

  out.push('');
  out.push('NOTES' + (notes.length > max ? '  (' + max + ' most recent of ' + notes.length + ')' : ''));
  if (!notes.length) { out.push('  (none)'); return; }

  notes.slice(0, max).forEach(function (n) {
    var body = dsClean(n.body).replace(/\s*\n\s*/g, ' ');
    out.push('  ' + dsPad(dsShort(n.date), 8) + dsPad(dsClean(n.type), 10) + dsPad(dsClean(n.person) || '—', 16) + body);
  });
}

// The facts a reader would otherwise have to count by hand. This is the section
// an advisory pass would lean on hardest, and every line of it is computed.
function dsDerived(proj, out, opts) {
  var today = opts.today;
  var isDone = typeof opts.isTaskDone === 'function' ? opts.isTaskDone : function () { return false; };
  var bits = [];

  var quiet = dsProjectQuietDays(proj, today);
  if (quiet != null) {
    bits.push(quiet === 0 ? 'active today' : quiet + 'd since any activity');
    if (proj.cadenceDays && quiet > proj.cadenceDays) {
      bits.push('PAST its ' + proj.cadenceDays + 'd cadence');
    }
  }

  var overdueTasks = (proj.tasks || []).filter(function (t) {
    if (!t || t.isDueDate || !t.date) return false;
    var end = t.endDate || t.date;
    return end < today && !isDone(t.id);
  }).length;
  if (overdueTasks) bits.push(overdueTasks + ' task' + (overdueTasks === 1 ? '' : 's') + ' past scheduled date');

  var due = dsProjectDue(proj);
  if (due) {
    var n = dsDays(today, due);
    if (n != null) bits.push(n < 0 ? 'DUE DATE PASSED ' + (-n) + 'd ago' : n === 0 ? 'DUE TODAY' : 'due in ' + n + 'd');
  }

  if (typeof commitmentsForProject === 'function') {
    var open = (commitmentsForProject(proj.id, { openOnly: true }) || []);
    var waiting = open.filter(function (c) { return c.state === 'waiting'; });
    if (open.length) bits.push(open.length + ' open loop' + (open.length === 1 ? '' : 's'));
    if (waiting.length) {
      var oldest = waiting.map(function (c) {
        return typeof commitmentWaitingDays === 'function' ? (commitmentWaitingDays(c, today) || 0) : 0;
      }).sort(function (a, b) { return b - a; })[0];
      bits.push(waiting.length + ' waiting on others (oldest ' + oldest + 'd)');
    }
  }

  var openBlocker = (proj.notes || []).filter(function (n) { return n && n.type === 'blocker'; }).length;
  if (openBlocker) bits.push(openBlocker + ' blocker note' + (openBlocker === 1 ? '' : 's') + ' logged');

  out.push('');
  out.push('DERIVED');
  out.push('  ' + (bits.length ? bits.join('  ·  ') : 'nothing notable'));
}

// ── ENTRY POINTS ──

function buildProjectDossier(proj, opts) {
  opts = opts || {};
  if (!opts.today) opts = Object.assign({}, opts, { today: dsToday() });
  if (!proj) return '';

  var out = [];
  dsHeader(proj, out);
  dsBrief(proj, out);
  dsTeam(proj, out);
  dsTimeline(proj, out, opts);
  dsLoops(proj, out, opts);
  dsNotes(proj, out, opts);
  dsDerived(proj, out, opts);
  return out.join('\n');
}

// One line per project. For the cross-project question ("which projects are
// waiting on somebody outside the team?") a thin dossier of all thirty beats
// building a vector store, and beats sending thirty full ones.
function dossierThin(proj, opts) {
  opts = opts || {};
  var today = opts.today || dsToday();
  if (!proj) return '';

  var bits = [dsClean(proj.name) || 'Untitled'];
  bits.push(dossierStatus(proj));
  if (dsClean(proj.leadProducer)) bits.push('lead ' + dsClean(proj.leadProducer));
  var due = dsProjectDue(proj);
  if (due) {
    var n = dsDays(today, due);
    bits.push(n != null && n < 0 ? 'OVERDUE ' + (-n) + 'd' : 'due ' + dsShort(due));
  }
  if (typeof commitmentsForProject === 'function') {
    var open = commitmentsForProject(proj.id, { openOnly: true }) || [];
    if (open.length) bits.push(open.length + ' open');
    var waiting = open.filter(function (c) { return c.state === 'waiting'; });
    if (waiting.length) bits.push(waiting.length + ' waiting');
  }
  return bits.join(' · ');
}

function buildDossierBundle(projects, opts) {
  opts = opts || {};
  var today = opts.today || dsToday();
  var lines = ['ALL PROJECTS  (' + (projects || []).length + ')', DOSSIER_LINE];
  (projects || []).forEach(function (p) { lines.push('  ' + dossierThin(p, { today: today })); });
  return lines.join('\n');
}

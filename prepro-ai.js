/* ── PRE-PRO · AI FEATURES ───────────────────────────────────────────────────
 *
 * The two jobs a model is actually good at here. Both are strictly additive:
 * `ppLlmConfigured()` gates every entry point, and with no key the app behaves
 * exactly as it did before this file existed.
 *
 * ── 1. EXTRACTION (phase 7) ──
 * Paste an email thread or meeting notes; get back *proposed* open loops with
 * owners and dates. Input is the new text; the project rides along only as
 * context, so "Marcus" resolves to a real person and an existing loop is not
 * proposed twice.
 *
 * This is the job the model earns its keep on. The nudge engine stays entirely
 * deterministic — it must be trustworthy or people stop reading it — and the
 * model only does the thing no amount of JavaScript can: turn prose into
 * structure. Nothing it returns is written anywhere. A person ticks rows.
 *
 * ── 2. ADVISORY (phase 8) ──
 * Read a whole project dossier and say what is slipping. Bigger, slower, rarer,
 * and cached hard against a hash of the dossier so it runs only when something
 * has actually changed. The cache is SHARED (prepro/advisory) rather than
 * per-person, which is what lets one person with a key cover teammates who
 * never set one up — the deciding argument for per-person keys in the first
 * place.
 *
 * Output is structured in both cases, never free prose that has to be re-read.
 * ─────────────────────────────────────────────────────────────────────────── */
'use strict';

// ── SHARED ──

// FNV-1a. Deterministic, dependency-free, and good enough to answer "has this
// dossier changed since we last looked at it?" — not a security hash.
function ppHash(str) {
  var h = 0x811c9dc5;
  var s = String(str == null ? '' : str);
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

// Shape-checking a date is not validating it. `2026-13-45` matches the regex,
// and the commitment it produces is worse than one with no date at all:
// commitmentIsOverdue() says true, commitmentOverdueDays() says null, and dash's
// daysBetween() yields NaN — so the "you owe this and it is late" nudge silently
// never fires. An invisible loop is worse than a rejected one.
function ppValidIsoDate(v) {
  var s = String(v == null ? '' : v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  var d = new Date(s + 'T00:00:00');
  if (isNaN(d)) return '';
  // Round-trip guard: Date rolls 2026-02-31 forward to March rather than failing.
  var back = d.getFullYear() + '-' +
             String(d.getMonth() + 1).padStart(2, '0') + '-' +
             String(d.getDate()).padStart(2, '0');
  return back === s ? s : '';
}

function ppAiToday() {
  return (typeof cmTodayStr === 'function') ? cmTodayStr() : new Date().toISOString().slice(0, 10);
}

// Names the model is allowed to use. Giving it the real roster is what stops it
// inventing "the design team" as an owner.
function ppKnownNames(proj) {
  var set = {};
  Object.keys((proj && proj.roster) || {}).forEach(function (role) {
    ((proj.roster[role]) || []).forEach(function (n) { if (n) set[n] = true; });
  });
  ((proj && proj.tasks) || []).forEach(function (t) {
    if (t && t.person) set[t.person] = true;
    ((t && t.attendees) || []).forEach(function (a) { if (a && a.person) set[a.person] = true; });
  });
  // Deliberately NOT every person record. This list is sent to Google on every
  // paste, and the whole staff directory is both a privacy cost with no upside
  // and worse at the actual job — the names that disambiguate "Marcus" are the
  // ones on this project, and a hundred unrelated names only invite a wrong match.
  Object.keys(set).forEach(function (n) {
    if (typeof personGoneEntirely === 'function' && personGoneEntirely(n)) delete set[n];
  });
  return Object.keys(set).sort();
}

// ── 1. EXTRACTION ──

// Roughly 8k tokens: comfortably more than any real email thread, far below
// the point where the reply gets truncated.
var PP_PASTE_MAX = 30000;

// How much of the thread is KEPT once it has been read. Separate from the input
// cap on purpose: a 30KB thread is fine to send once, but it is stored on the
// project, and prepro/state is written whole by every page — twenty maxed
// threads on one project would put well over half a megabyte into every save.
// The summary is the record; this is the receipt behind it.
var PP_SOURCE_KEEP = 6000;

var PP_EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    commitments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text:      { type: 'string', description: 'The action, as a short imperative line.' },
          owner:     { type: 'string', description: 'Person who owes it. Empty string if genuinely unclear.' },
          direction: { type: 'string', enum: ['mine', 'theirs'], description: '"theirs" when somebody else owes it to us.' },
          due:       { type: 'string', description: 'YYYY-MM-DD, or empty string if no date was stated.' },
          dateOptions: { type: 'array', items: { type: 'string' }, description: 'Only when the due date could genuinely mean two days: both, as YYYY-MM-DD. Otherwise empty.' },
          quote:     { type: 'string', description: 'The sentence from the text this came from.' },
          uncertain: { type: 'string', description: 'If something here could not be worked out from the text, one short question asking the reader. Empty string when everything was clear.' }
        },
        required: ['text', 'direction']
      }
    },
    schedule: {
      type: 'array',
      description: 'Things that belong on the project calendar.',
      items: {
        type: 'object',
        properties: {
          kind:        { type: 'string', enum: ['work', 'meeting', 'studio-shoot', 'location-shoot', 'studio-work', 'delivery', 'milestone', 'due-date', 'offline-review', 'pto'] },
          title:       { type: 'string', description: 'A short name for it, under about 6 words. Empty string if the kind says it all.' },
          role:        { type: 'string', description: 'kind "work" only: Producer, Editor, Animator, Copywriter, Designer, External Vendor or Other. Empty if not stated.' },
          people:      { type: 'array', items: { type: 'string' }, description: 'Who is on it, written exactly as the text gives them.' },
          start:       { type: 'string', description: 'YYYY-MM-DD.' },
          end:         { type: 'string', description: 'YYYY-MM-DD for something spanning several days, else empty.' },
          dateOptions: { type: 'array', items: { type: 'string' }, description: 'Only when the date could genuinely mean two days: both, as YYYY-MM-DD. Otherwise empty.' },
          replaces:    { type: 'string', description: 'The id (like S3) of the calendar item this moves or reschedules, else empty.' },
          quote:       { type: 'string', description: 'The sentence from the text this came from.' },
          uncertain:   { type: 'string', description: 'One short question for the reader if something could not be worked out, else empty.' }
        },
        required: ['kind', 'start']
      }
    },
    note: {
      type: 'object',
      description: 'The thread itself, as a project note.',
      properties: {
        type:    { type: 'string', enum: ['update', 'delay', 'direction', 'feedback', 'blocker', 'decision', 'team'],
                   description: 'Which kind of project note this thread amounts to.' },
        summary: { type: 'string', description: 'What the thread says, in two or three sentences, for someone who did not read it.' },
        from:    { type: 'string', description: 'Who the thread is from, if identifiable. Empty string otherwise.' }
      },
      required: ['type', 'summary']
    }
  },
  // schedule is required for the same reason the advisory's lists are: left
  // optional, a model simply omits it. An empty array is a fine answer.
  required: ['commitments', 'note', 'schedule']
};

var PP_EXTRACT_SYSTEM = [
  'You read work correspondence and pull out open loops: things somebody now owes somebody else.',
  '',
  'Rules:',
  '- Only extract what the text actually says. Never infer a task that would be sensible but is not stated.',
  '- One loop per distinct action. Do not merge two actions into one line.',
  '- text: a short imperative line, under about 12 words. No names in it — the owner field carries that.',
  '- owner: WHO MUST DO THE THING. Not who asked for it, not who is waiting for it, not who benefits. "I owe Marcus the estimate" means the owner is the speaker, not Marcus.',
  '- Write the owner with exactly as much of the name as the text itself gives. If it says "Liz", write "Liz" — do NOT complete it to a full name from the known-people list, even when only one person there could match. The list is for spelling and for telling people apart, never for filling in what the text left out.',
  '- Use the known-people spelling only when the text already gives the whole name. Somebody not on the list: use the name as written. Genuinely unclear: empty string.',
  '- direction: "mine" when our side owes it, "theirs" when we are waiting on somebody else.',
  '- due: only when a date is actually stated or clearly implied ("by Friday"). Resolve relative dates against the stated today. Otherwise empty string.',
  '- quote: the sentence you took it from, verbatim, so a human can check you.',
  '- uncertain: leave empty when the text was clear. When it was not, ask one short question instead of guessing — "who is \'we\' here?", "which Thursday?", "is this ours or theirs?". Do not use it to hedge on something the text plainly states.',
  '- Skip anything already listed as an existing open loop.',
  '- Pleasantries, FYIs and things already done are not open loops. Returning an empty array is a correct answer.',
  '',
  'You also file the thread itself as a project note:',
  '- note.summary: two or three sentences saying what happened, for a producer who did not read the thread. Not a list of the actions — those are the loops. Say what changed, what was decided, what the state of things now is.',
  '- note.type: the kind of note this amounts to.',
  '    blocker   — something is stopping progress',
  '    delay     — something is behind schedule',
  '    direction — scope, creative or strategy has shifted',
  '    feedback  — a stakeholder is reacting to the work',
  '    decision  — something was settled',
  '    team      — staffing or availability',
  '    update    — general progress, and the right answer when none of the others clearly fit',
  '- note.from: who the thread is from, if the text makes it obvious. Empty string if not.',
  '',
  'You also pull out anything that belongs on the project calendar (schedule):',
  '- Only things that occupy a date: a meeting or call, a shoot, a block of work ("Kevin edits the week of the 10th"), a delivery or due date, an offline review, or someone being out (pto).',
  '- Something owed with a deadline ("send the cut by Friday") is an open loop, not a calendar item — unless the text calls it a delivery or due date.',
  '- kind: work = a block of someone\'s production time; meeting = any call, review or check-in held together; studio-shoot / location-shoot = filming; studio-work = set build, strike, studio maintenance; delivery, milestone, due-date = key dates; offline-review = someone reviewing on their own time; pto = someone out.',
  '- start and end: YYYY-MM-DD, resolved against the stated today. "Thursday" means the next Thursday after today unless the text says otherwise. "The week of the 10th" is that Monday to Friday. end only for something spanning several days.',
  '- dateOptions: only when a date genuinely could mean two days ("next Friday" said on a Wednesday). Give both, and put the likelier one in start.',
  '- people: same name rule as owner — exactly as much of the name as the text gives.',
  '- replaces: when the text moves or reschedules something already on the calendar (listed with ids like S3), give that id. A reschedule is a replaces, never a second item.',
  '- Skip anything already on the calendar for the same date.',
  '- uncertain: one short question, only when the answer changes what would be saved. At most one per item.',
  '- Returning an empty schedule is a correct answer.'
].join('\n');

// ── CALENDAR KINDS ──
// What a schedule proposal can become, and the task shape each one maps onto.
// `review` = an isReview chip with that label; `milestone` = an isDueDate key
// date of that type; neither = a role chip. `range` = may span several days.
var PP_SCHED_KINDS = {
  'work':           { label: 'Work',              range: true },
  'meeting':        { label: 'Meeting',           review: 'Meeting' },
  'studio-shoot':   { label: 'Studio Shoot',      review: 'Studio Shoot',      range: true },
  'location-shoot': { label: 'On-Location Shoot', review: 'On-Location Shoot', range: true },
  'studio-work':    { label: 'Studio Work',       review: 'Studio Work',       range: true },
  'delivery':       { label: 'Delivery',          milestone: 'delivery' },
  'milestone':      { label: 'Milestone',         milestone: 'milestone' },
  'due-date':       { label: 'Project Due Date',  milestone: 'due-date' },
  'offline-review': { label: 'Offline Review',    milestone: 'offline-review' },
  'pto':            { label: 'PTO',               milestone: 'pto', range: true }
};
var PP_WORK_ROLES = ['Producer', 'Editor', 'Animator', 'Copywriter', 'Designer', 'External Vendor', 'Administrative', 'Other'];
// A project has one due date and usually one delivery. A second one arriving
// from a thread is almost always the first one moving, so these always ask.
var PP_SINGLETON_KINDS = { 'due-date': true, 'delivery': true };

// Which kind an existing task is, so the calendar context and the duplicate /
// move checks speak the same vocabulary as the proposals.
function ppTaskKind(t) {
  if (!t) return '';
  if (t.isReview) {
    var lbl = t.reviewLabel || 'Review';
    var k = Object.keys(PP_SCHED_KINDS).filter(function (key) { return PP_SCHED_KINDS[key].review === lbl; })[0];
    return k || 'meeting';            // the retired Review chip was a meeting
  }
  if (t.isDueDate) {
    var m = Object.keys(PP_SCHED_KINDS).filter(function (key) { return PP_SCHED_KINDS[key].milestone === t.milestoneType; })[0];
    return m || '';                   // holidays and unknown types are not ours to move
  }
  return 'work';
}
function ppTaskPeople(t) {
  var seen = {}, out = [];
  [t && t.person].concat(((t && t.attendees) || []).map(function (a) { return a && a.person; }))
    .forEach(function (n) { if (n && !seen[n]) { seen[n] = true; out.push(n); } });
  return out;
}

// ── DATES ──
var PP_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var PP_DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var PP_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function ppIsoDow(iso) { return new Date(iso + 'T00:00:00').getDay(); }
function ppShiftIso(iso, n) {
  var d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function ppDaysApart(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5); }
// "Thu Nov 6" — every date in a question is written like this, so the weekday
// is always on screen when someone is deciding which Thursday was meant.
function ppFmtDay(iso) {
  if (!ppValidIsoDate(iso)) return iso || '';
  var d = new Date(iso + 'T00:00:00');
  return PP_DOW[d.getDay()] + ' ' + PP_MON[d.getMonth()] + ' ' + d.getDate();
}
function ppFmtSpan(start, end) { return ppFmtDay(start) + (end && end !== start ? ' – ' + ppFmtDay(end) : ''); }

// ── QUESTIONS ──
// Anything the review cannot settle on its own becomes a question with real
// answers to click, never a free-text box. Each option is a patch applied to
// the proposal row, so answering costs no second model request — that budget
// is about twenty a day.
//
//   { text, about, options: [{ label, patch?, swapPerson?: [from, to],
//                              dropPerson?, skip? }], answer: null | index }
//
// `about` names the field the question is about, so editing that field by hand
// answers it: a reviewer who just types the right date has answered "which
// Thursday?".
function ppQuestion(text, about, options) {
  return { text: text, about: about || 'general', options: options, answer: null };
}
function ppGeneralQuestion(text) {
  return ppQuestion(text, 'general', [{ label: 'Looks right' }, { label: 'Leave it out', skip: true }]);
}
function ppOpenQuestions(row) {
  return ((row && row.questions) || []).filter(function (q) { return q.answer == null; });
}
// Applies one answer to its row. A row whose every question has been answered
// (without "leave it out") is accepted: answering IS deciding.
function ppApplyAnswer(row, q, idx) {
  var opt = q && q.options && q.options[idx];
  if (!row || !opt) return row;
  q.answer = idx;
  if (opt.patch) Object.keys(opt.patch).forEach(function (k) { row[k] = opt.patch[k]; });
  if (opt.swapPerson) {
    var from = opt.swapPerson[0], to = opt.swapPerson[1];
    if (Array.isArray(row.people)) {
      row.people = row.people.map(function (n) { return n === from ? to : n; })
        .filter(function (n, i, all) { return all.indexOf(n) === i; });
    }
    if (row.owner === from) row.owner = to;
  }
  if (opt.dropPerson && Array.isArray(row.people)) {
    row.people = row.people.filter(function (n) { return n !== opt.dropPerson; });
  }
  if (opt.skip) { row.skipped = true; row.accept = false; return row; }
  if (!row.skipped && !ppOpenQuestions(row).length) row.accept = true;
  return row;
}
// A hand edit to a field settles the questions about that field.
function ppSettleQuestionsAbout(row, about) {
  ((row && row.questions) || []).forEach(function (q) {
    if (q.answer == null && q.about === about) q.answer = -1;
  });
  if (row && !row.skipped && !ppOpenQuestions(row).length) row.accept = true;
}
function ppDateQuestion(dates, startField, endValue) {
  return ppQuestion('Which date?', startField, dates.map(function (d) {
    var patch = {};
    patch[startField] = d;
    if (endValue && endValue.start && endValue.end) patch.end = ppShiftIso(endValue.end, ppDaysApart(endValue.start, d));
    return { label: ppFmtDay(d), patch: patch };
  }));
}

// Context, not the whole dossier: extraction needs the cast list and what is
// already tracked, and nothing else. Sending the full dossier here would cost
// tokens to make the model worse at a narrow job.
// The calendar the model may refer to when something moves. Each item gets a
// short id (S1, S2…) for `replaces`; the real task id never leaves the browser
// and the map back is kept on our side. Only recent and upcoming items: a
// thread rescheduling something from three months ago is not a reschedule.
var PP_SCHED_CONTEXT_MAX = 40;
function ppScheduleContext(proj, today) {
  var from = ppShiftIso(today || ppAiToday(), -7);
  var items = ((proj && proj.tasks) || []).filter(function (t) {
    return t && t.date && ppTaskKind(t) && (t.endDate || t.date) >= from;
  }).sort(function (a, b) { return a.date.localeCompare(b.date); }).slice(0, PP_SCHED_CONTEXT_MAX);
  var refs = {}, lines = [];
  items.forEach(function (t, i) {
    var ref = 'S' + (i + 1);
    var kind = ppTaskKind(t);
    var label = kind === 'work' ? ((t.role || 'Work') + ' work') : PP_SCHED_KINDS[kind].label;
    var people = ppTaskPeople(t);
    refs[ref] = { id: t.id, kind: kind, start: t.date, end: t.endDate || '', title: t.taskName || '', label: label, role: t.role || '' };
    lines.push('  ' + ref + ' · ' + label + (t.taskName ? ' "' + t.taskName + '"' : '') + ' · ' +
               ppFmtSpan(t.date, t.endDate) + ' (' + t.date + (t.endDate && t.endDate !== t.date ? ' to ' + t.endDate : '') + ')' +
               (people.length ? ' · ' + people.join(', ') : ''));
  });
  return { refs: refs, lines: lines };
}

function ppBuildExtractContext(proj, sched) {
  var today = ppAiToday();
  var lines = [
    // The weekday matters: "Thursday" and "next Friday" are resolved against it.
    'Today is ' + today + ' (' + PP_DOW_LONG[ppIsoDow(today)] + ').',
    'Project: ' + ((proj && proj.name) || 'Untitled') + '.'
  ];
  var names = ppKnownNames(proj);
  if (names.length) lines.push('Known people: ' + names.join(', ') + '.');

  if (typeof commitmentsForProject === 'function' && proj) {
    var open = commitmentsForProject(proj.id, { openOnly: true }) || [];
    if (open.length) {
      lines.push('Existing open loops (do not repeat these):');
      open.forEach(function (c) { lines.push('  - ' + c.text + (c.waitingOn ? ' (waiting on ' + c.waitingOn + ')' : '')); });
    }
  }
  var cal = sched || ppScheduleContext(proj, today);
  if (cal.lines.length) {
    lines.push('Already on the calendar (use these ids in "replaces"):');
    cal.lines.forEach(function (l) { lines.push(l); });
  } else {
    lines.push('Nothing is on the calendar yet.');
  }
  return lines.join('\n');
}

function ppBuildExtractPrompt(proj, text, sched) {
  return [
    ppBuildExtractContext(proj, sched),
    '',
    '--- PASTED TEXT BEGINS ---',
    String(text || '').trim(),
    '--- PASTED TEXT ENDS ---',
    '',
    'Return {"commitments": [...], "note": {...}, "schedule": [...]} following the schema. Empty arrays are fine.'
  ].join('\n');
}

// Folds whatever the model called somebody onto the name the app already uses.
//
// Two passes, because they cover different gaps. `resolvePersonName` handles
// aliases and the "Last, First" fold, but only for people who have a person
// record. Plenty of names on a project — a client, a vendor contact — appear
// only in a roster, and a loop filed against "Walsh, Ryan" would never match
// the nudges' lookups for "Ryan Walsh". So fall back to matching the project's
// own cast list on the same normalised key.
// Which known people could this name mean?
//
// The interesting answer is "more than one". A thread saying "Liz will send it"
// on a project with a Liz Chen and a Liz Moreau is not a name we can resolve,
// and quietly picking one files the loop against the wrong person — where it
// still looks perfectly fine on screen, and never reaches whoever actually owes
// the thing. That is worth one question at review time.
//
// Deliberately deterministic: no model involved, no request spent. The roster
// is right here.
function ppOwnerMatches(raw, proj) {
  var name = String(raw || '').trim();
  if (!name) return { kind: 'none', candidates: [] };

  var known = ppKnownNames(proj);
  var key = function (v) {
    return typeof normalizePersonKey === 'function'
      ? normalizePersonKey(v)
      : String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  };

  // A full-name match, alias-aware, is decided — nothing to ask.
  var exact = known.filter(function (n) { return key(n) === key(name); });
  if (exact.length === 1) return { kind: 'exact', candidates: exact, resolved: exact[0] };
  if (typeof resolvePersonName === 'function') {
    var viaRecord = resolvePersonName(name);
    if (viaRecord && known.indexOf(viaRecord) >= 0) {
      return { kind: 'exact', candidates: [viaRecord], resolved: viaRecord };
    }
  }

  // A partial — usually a first name, sometimes a surname. Match on whole word
  // parts so "Liz" finds "Liz Chen" but "Lizard Ltd" does not.
  var want = name.toLowerCase().split(/\s+/).filter(Boolean);
  var hits = known.filter(function (n) {
    var parts = n.toLowerCase().split(/\s+/).filter(Boolean);
    return want.every(function (w) {
      return parts.some(function (part) { return part === w || part.indexOf(w) === 0; });
    });
  });

  // A single letter is an initial, not a name. "M" matching exactly one Marcus
  // is not evidence it means Marcus — it equally means a Maya who is not on
  // this project. Inferring from it produced a confident, pre-ticked loop
  // against a person the text never named, so an initial always asks.
  var initialOnly = want.length === 1 && want[0].length < 2;
  if (initialOnly) {
    return hits.length
      ? { kind: 'ambiguous', candidates: hits }
      : { kind: 'unknown', candidates: [] };
  }

  if (hits.length === 1) return { kind: 'inferred', candidates: hits, resolved: hits[0] };
  if (hits.length > 1)  return { kind: 'ambiguous', candidates: hits };
  return { kind: 'unknown', candidates: [] };
}

function ppResolveOwner(owner, proj) {
  if (!owner) return '';
  var m = ppOwnerMatches(owner, proj);
  // An ambiguous name is left exactly as written. Resolving it to a coin-flip
  // would hide the question the reviewer needs to answer.
  if (m.kind === 'exact' || m.kind === 'inferred') return m.resolved;
  return owner;
}

// Loose key for "is this the same loop?". Exact string match was the whole
// guard, so a paraphrase — or a trailing full stop — slipped straight through
// and the project gained a second loop for the same thing, sometimes pointing
// the opposite way to the one already tracked.
function ppLoopKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|an|to|for|of|on|in|with|from|please|can|you|we|our|my|by|at|as|is|it|be|or|if|so|up|do|and|but)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Two loop texts describing the same thing? Loose key equality, plus a
// containment check so "Chase legal for the licence" matches "Chase legal".
function ppSameLoop(a, b) {
  var ka = ppLoopKey(a), kb = ppLoopKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;

  // The identifier veto has to run BEFORE the prefix shortcut, not after it.
  // "Music licence cleared" is a prefix of "Music licence cleared for v2", so
  // the shortcut returned a match and the v2 loop was swallowed by its own
  // sibling without ever reaching the checks below.
  var wordsOf = function (k) { return k.split(' ').filter(Boolean); };
  var wa0 = wordsOf(ka), wb0 = wordsOf(kb);
  var setA0 = {}, setB0 = {};
  wa0.forEach(function (w) { setA0[w] = true; });
  wb0.forEach(function (w) { setB0[w] = true; });
  var isIdentifier = function (w) { return /\d/.test(w) || w.length <= 2; };
  if (wa0.some(function (w) { return !setB0[w] && isIdentifier(w); }) ||
      wb0.some(function (w) { return !setA0[w] && isIdentifier(w); })) return false;

  if (ka.indexOf(kb) === 0 || kb.indexOf(ka) === 0) return true;

  // Prefix matching only catches a rephrase that starts the same way. "Music
  // licence cleared" and "Chase Legal for the music licence" are the same loop
  // and share no prefix at all, so compare the words themselves.
  //
  // Two conditions, because overlap alone is not enough. "Send the cut to
  // Marcus" and "Send the cut to Dana" share two words out of three and are
  // emphatically NOT the same loop — merging them would silently drop one,
  // which is worse than showing a duplicate the reviewer can untick. So a match
  // also needs a shared word with some substance in it: short words are the
  // verbs and glue that any two loops have in common, while the long ones are
  // the subject matter.
  var wa = ka.split(' ').filter(Boolean);
  var wb = kb.split(' ').filter(Boolean);
  if (wa.length < 2 || wb.length < 2) return false;

  var setA = {}, setB = {};
  wa.forEach(function (w) { setA[w] = true; });
  wb.forEach(function (w) { setB[w] = true; });
  var sharedWords = wa.filter(function (w) { return setB[w]; });
  if (sharedWords.length < Math.ceil(Math.min(wa.length, wb.length) * 0.6)) return false;
  if (!sharedWords.some(function (w) { return w.length >= 5; })) return false;

  // Last veto, and the one that decides the hard cases. If each side has a
  // substantial word the other does not, they are about different things:
  // "book the studio for Tuesday" and "book the crew for Tuesday" overlap
  // heavily and share a long word, but studio and crew are the whole point.
  //
  // This deliberately lets some genuine rephrases through as duplicates —
  // "music licence cleared" versus "chase Legal for the music licence" trips it
  // on cleared/chase. That is the right way round to be wrong: a duplicate is a
  // visible row in a list the reviewer is already reading and unticks in one
  // click, whereas a false merge silently drops a real loop and nobody ever
  // learns it existed.
  // Some tokens are identifiers, and one of them appearing on only ONE side is
  // enough on its own: a digit anywhere ("version 1" / "version 2", "episode 3"
  // / "episode 4") or a token of one or two characters ("cut A" / "cut B",
  // "for Mon" / "for Tue"). A length threshold that ignored these merged nine
  // of eleven realistic pairs, and a merged pair silently loses a loop that
  // never reaches the review list at all.
  var identifier = function (w) { return /\d/.test(w) || w.length <= 2; };
  var exclusive = function (words, other) {
    return words.filter(function (w) { return !other[w]; });
  };
  var aEx = exclusive(wa, setB);
  var bEx = exclusive(wb, setA);
  if (aEx.some(identifier) || bEx.some(identifier)) return false;

  // Otherwise: merge only when one loop's words are a subset of the other's.
  // Both sides carrying something the other lacks means they are about
  // different things, and the safe reading of "different" is to keep both — a
  // duplicate is a visible row the reviewer unticks, a false merge is invisible.
  return !(aEx.length && bEx.length);
}

// `owner` and `direction` are not independent, and treating them as two free
// fields let the model produce "Ryan is waiting on Ryan" — a loop invisible to
// its own owner's list AND to patternOwedByMe, because the Phase 4 scoping
// assumes the two agree. The manual add box has always derived one from the
// other; the AI paths must too.
//
// `direction` is not an independent fact — it is a reading of `owner` from the
// viewer's seat. `owner` is who owes the thing; if that is anybody other than
// you, then by definition you are waiting on them. So it is derived, not
// trusted, exactly as the manual add box has always done it.
//
// The model still reports a direction, and it is still worth asking for: it
// makes the model commit to a reading of the sentence, which improves the owner
// it picks. It just does not get the last word. Left to it, "Marcus will send a
// revised brief tomorrow" came back as owner Marcus / direction mine — a loop
// Ryan owed to himself, which no nudge would ever chase.
function ppCoherentDirection(owner, direction, me) {
  var o = String(owner || '').trim();
  if (!o) return 'mine';                                   // nobody to wait on
  if (me) {
    if (typeof normalizePersonKey === 'function') {
      if (normalizePersonKey(o) === normalizePersonKey(me)) return 'mine';
    } else if (o === me) return 'mine';
  }
  return 'theirs';
}

// Did the model complete a name the text left partial?
//
// The prompt now forbids it, but a prompt is a request. When the reply says
// "Liz Chen" and the sentence it came from only ever says "Liz", the surname
// was supplied by the model, not the writer — and that turns a question we
// should be asking into a confident wrong answer. Checking the quote is the
// deterministic backstop: it does not matter why the model expanded, only that
// the source text does not support it.
function ppUnexpandOwner(owner, quote, proj) {
  var o = String(owner || '').trim();
  var q = String(quote || '').trim();
  if (!o || !q) return o;
  var parts = o.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return o;                       // already partial

  var hay = q.toLowerCase();
  if (hay.indexOf(o.toLowerCase()) >= 0) return o;      // text really says it

  // Which parts of the name does the text actually contain?
  var present = parts.filter(function (part) {
    return new RegExp('(^|[^a-z])' + part.toLowerCase().replace(/[^a-z0-9]/g, '') + '([^a-z]|$)', 'i').test(hay);
  });
  if (present.length === parts.length) return o;        // all parts present

  if (!present.length) {
    // No part of the name is in the text. Usually a legitimate paraphrase —
    // "she said she would send it" — but it is also how an initial reads: the
    // thread says "M will pick it up" and the reply says "Marcus Delgado". If a
    // bare initial matching this name is sitting in the quote, that is what the
    // text actually gave us, so hand that back and let it be asked about.
    var initial = parts.map(function (part) { return part.charAt(0); })
      .filter(function (ch) { return ch && new RegExp('(^|[^A-Za-z])' + ch + '([^A-Za-z]|$)').test(q); })[0];
    return initial || o;
  }

  // Only some of the name is in the text. Fall back to what was written, so
  // ppOwnerMatches gets to decide whether that is ambiguous.
  return present.join(' ');
}

// Resolves and sanitises whatever came back. The model's output never reaches
// the store directly, so this exists to make the review list trustworthy —
// dates that are not dates, owners that are not people, empty rows.
function ppNormalizeExtracted(raw, proj, opts) {
  var out = [];
  var list = (raw && raw.commitments) || [];
  if (!Array.isArray(list)) return out;

  var existing = [];
  if (typeof commitmentsForProject === 'function' && proj) {
    (commitmentsForProject(proj.id, { openOnly: true }) || []).forEach(function (c) {
      existing.push(c.text);
    });
  }
  var me = (opts && opts.me) || '';

  list.forEach(function (item) {
    if (!item) return;
    var text = String(item.text || '').trim();
    if (!text) return;
    // The prompt asks it not to repeat existing loops; this is the backstop for
    // when it does anyway, which it does with paraphrases.
    if (existing.some(function (e) { return ppSameLoop(e, text); })) return;
    if (out.some(function (o) { return ppSameLoop(o.text, text); })) return; // dupes within one reply

    var quote = String(item.quote || '').trim();
    var owner = ppResolveOwner(ppUnexpandOwner(String(item.owner || '').trim(), quote, proj), proj);
    var dueOptions = ppDistinctDates(item.dateOptions);
    var due = ppValidIsoDate(item.due) || dueOptions[0] || '';

    var direction = ppCoherentDirection(owner, item.direction, me);

    // Two kinds of "we are not sure", surfaced the same way. The first we work
    // out ourselves from the roster; the second only the model can know.
    var match = ppOwnerMatches(owner, proj);
    var ask = String(item.uncertain || '').trim();
    var askKind = ask ? 'model' : '';

    // "Marcus — I owe you the runtime estimate" names Marcus, but the person
    // who owes it is whoever wrote the line. The prompt says so explicitly and
    // the model still files it against the addressee, which produces exactly
    // the inversion the direction rules were meant to prevent: a loop the
    // speaker owes, recorded as a wait ON the speaker's recipient.
    //
    // Whose "I" it is cannot be known from the sentence alone, so this asks
    // rather than guessing — the same contract as every other uncertainty here.
    if (owner && /\b(?:i|i'll|i will|i owe|i can|i should|let me)\b/i.test(quote) &&
        !/\byou(?:'ll| will)?\s+(?:owe|send|get|do|need)\b/i.test(quote)) {
      var meKey = me && typeof normalizePersonKey === 'function' ? normalizePersonKey(me) : '';
      var ownerKey = typeof normalizePersonKey === 'function' ? normalizePersonKey(owner) : '';
      if ((!meKey || meKey !== ownerKey) && !ask) {
        ask = 'The text says "I" — is this you, or ' + owner + '?';
        askKind = 'speaker';
      }
    }

    if (match.kind === 'ambiguous') {
      ask = 'Which ' + owner + '?';
      askKind = 'ambiguous';
    } else if (!ask && owner && match.kind === 'unknown' && direction === 'theirs') {
      // Waiting on somebody nobody on the project has heard of is worth a look:
      // it is usually a first name we cannot place, or an external contact.
      ask = 'Nobody on this project is called "' + owner + '" — is that right?';
      askKind = 'unknown';
    }

    // The same doubts, as questions with answers to click.
    var questions = [];
    if (askKind === 'ambiguous') {
      questions.push(ppQuestion(ask, 'owner', match.candidates.map(function (c) {
        return { label: c, patch: { owner: c, ownerResolved: true } };
      }).concat([{ label: 'Neither — keep "' + owner + '"', patch: { ownerResolved: true } }])));
    } else if (askKind === 'speaker') {
      questions.push(ppQuestion(ask, 'owner', me
        ? [{ label: 'Me (' + me + ')', patch: { owner: me } }, { label: owner }, { label: 'Leave it out', skip: true }]
        : [{ label: owner }, { label: 'Leave it out', skip: true }]));
    } else if (askKind === 'unknown') {
      questions.push(ppQuestion(ask, 'owner', [{ label: 'Yes, keep ' + owner }, { label: 'Leave it out', skip: true }]));
    } else if (askKind === 'model') {
      questions.push(ppGeneralQuestion(ask));
    }
    if (dueOptions.length > 1) questions.push(ppDateQuestion(dueOptions, 'due'));

    out.push({
      text: text,
      owner: owner,
      direction: direction,
      due: due,
      quote: quote,
      uncertain: ask,
      ownerOptions: match.kind === 'ambiguous' ? match.candidates : [],
      questions: questions,
      // A row we are unsure about is NOT pre-ticked. Everything else is: the
      // reviewer confirms the guess rather than re-entering it.
      accept: !questions.length
    });
  });
  return out;
}

function ppDistinctDates(list) {
  var out = [];
  (Array.isArray(list) ? list : []).forEach(function (v) {
    var d = ppValidIsoDate(v);
    if (d && out.indexOf(d) < 0) out.push(d);
  });
  return out;
}

// Calendar proposals. Same contract as the loops: nothing here is trusted
// until it has been checked against the project, and anything this cannot
// settle becomes a question rather than a guess.
//
// opts: { me, today, refs (from ppScheduleContext), roleFor(name) → role }
function ppNormalizeSchedule(raw, proj, opts) {
  opts = opts || {};
  var out = [];
  var list = (raw && raw.schedule) || [];
  if (!Array.isArray(list)) return out;
  var refs = opts.refs || {};
  var tasks = (proj && proj.tasks) || [];

  list.forEach(function (item, i) {
    if (!item) return;
    var kind = PP_SCHED_KINDS[item.kind] ? item.kind : '';
    if (!kind) return;
    var K = PP_SCHED_KINDS[kind];

    var dateOptions = ppDistinctDates(item.dateOptions);
    var start = ppValidIsoDate(item.start) || dateOptions[0] || '';
    if (!start) return;                       // a calendar item with no date is nothing
    var end = K.range ? ppValidIsoDate(item.end) : '';
    if (end && end <= start) end = '';

    var quote = String(item.quote || '').trim();
    var title = String(item.title || '').trim().slice(0, 80);
    var questions = [];

    // People: the loop rules, per name. A name prepro knows from the person
    // records but not from this project is fine — they get added to it.
    var people = [];
    (Array.isArray(item.people) ? item.people : []).forEach(function (rawName) {
      var nm = ppResolveOwner(ppUnexpandOwner(String(rawName || '').trim(), quote, proj), proj);
      if (!nm || people.indexOf(nm) >= 0) return;
      var m = ppOwnerMatches(nm, proj);
      if (m.kind === 'unknown' && typeof resolvePersonName === 'function') {
        var rec = resolvePersonName(nm);
        if (rec) { if (people.indexOf(rec) < 0) people.push(rec); return; }
      }
      people.push(nm);
      if (m.kind === 'ambiguous') {
        questions.push(ppQuestion('Which ' + nm + '?', 'people', m.candidates.map(function (c) {
          return { label: c, swapPerson: [nm, c] };
        }).concat([{ label: 'Neither — keep "' + nm + '"' }])));
      } else if (m.kind === 'unknown') {
        questions.push(ppQuestion('Nobody prepro knows is called "' + nm + '". Put them on it anyway?', 'people',
          [{ label: 'Yes, keep ' + nm }, { label: 'Leave ' + nm + ' off', dropPerson: nm }]));
      }
    });
    if (kind === 'pto' && !people.length) return;   // out — but who?

    var role = '';
    if (kind === 'work') {
      role = PP_WORK_ROLES.indexOf(item.role) >= 0 ? item.role : '';
      if (!role && people.length && typeof opts.roleFor === 'function') role = opts.roleFor(people[0]) || '';
      if (PP_WORK_ROLES.indexOf(role) < 0) role = 'Producer';
    }

    // Already there: same kind on the same day (and for work, the same role).
    var sameKind = tasks.filter(function (t) {
      return ppTaskKind(t) === kind && (kind !== 'work' || (t.role || '') === role);
    });
    // Two different meetings can share a day, and Liz's edit day is not Kevin's,
    // so "same" also needs the name (when both have one) or the people to agree.
    var isDup = function (t) {
      if (t.date !== start) return false;
      if (kind === 'work') {
        var tp = ppTaskPeople(t);
        return !people.length || people.some(function (n) { return tp.indexOf(n) >= 0; });
      }
      if (PP_SINGLETON_KINDS[kind] || !title || !t.taskName) return true;
      return ppSameLoop(title, t.taskName);
    };
    if (sameKind.some(isDup) && !item.replaces) return;

    // Is this something already on the calendar, moving? The model says so via
    // `replaces`; we also check ourselves for the cases it misses — a second
    // due date, or a meeting with the same name on a different day.
    var moveOf = null;
    var ref = refs[String(item.replaces || '').trim()];
    if (ref && ref.kind === kind) moveOf = ref;
    if (!moveOf) {
      var hit = sameKind.filter(function (t) {
        if (t.date === start || (t.endDate || t.date) < ppShiftIso(opts.today || ppAiToday(), -7)) return false;
        if (PP_SINGLETON_KINDS[kind]) return true;
        return kind !== 'work' && title && t.taskName && ppSameLoop(title, t.taskName);
      })[0];
      if (hit) moveOf = { id: hit.id, kind: kind, start: hit.date, end: hit.endDate || '', title: hit.taskName || '', label: PP_SCHED_KINDS[kind].label };
    }
    if (moveOf && moveOf.start === start) return;    // "moved" to where it already is

    if (moveOf) {
      var what = (moveOf.title ? '"' + moveOf.title + '"' : 'the ' + moveOf.label) + ' on ' + ppFmtSpan(moveOf.start, moveOf.end);
      questions.unshift(ppQuestion('Is this ' + what + ' moving to ' + ppFmtDay(start) + '?', 'move', [
        { label: 'Yes — move it', patch: { movesId: moveOf.id } },
        { label: 'No — add a new one', patch: { movesId: '' } }
      ]));
    }

    if (dateOptions.length > 1) {
      questions.push(ppDateQuestion(dateOptions, 'start', { start: start, end: end }));
    } else if (kind !== 'pto' && (ppIsoDow(start) === 0 || ppIsoDow(start) === 6)) {
      // A weekend chip is invisible with weekends hidden, and almost always a
      // misread "Saturday" rather than intended weekend work. Ask, with the
      // nearest workdays as the answers.
      var fri = ppShiftIso(start, ppIsoDow(start) === 6 ? -1 : -2);
      var mon = ppShiftIso(start, ppIsoDow(start) === 6 ? 2 : 1);
      var shift = function (d) {
        var p = { start: d };
        if (end) p.end = ppShiftIso(end, ppDaysApart(start, d));
        return p;
      };
      questions.push(ppQuestion('That lands on a ' + PP_DOW_LONG[ppIsoDow(start)] + '.', 'start', [
        { label: ppFmtDay(fri), patch: shift(fri) },
        { label: ppFmtDay(mon), patch: shift(mon) },
        { label: 'Keep ' + ppFmtDay(start) }
      ]));
    }

    var ask = String(item.uncertain || '').trim();
    if (ask) questions.push(ppGeneralQuestion(ask));

    out.push({
      id: 'cal' + i,
      kind: kind,
      title: title,
      role: role,
      people: people,
      start: start,
      end: end,
      quote: quote,
      movesId: '',
      moveOf: moveOf,
      questions: questions,
      accept: !questions.length
    });
  });
  return out;
}

// Keeps the head of a long thread and says plainly that it was cut, rather than
// storing an unbounded blob in a node every page rewrites in full.
function ppTrimSource(text) {
  var s = String(text || '').trim();
  if (s.length <= PP_SOURCE_KEEP) return s;
  return s.slice(0, PP_SOURCE_KEEP).trim() +
    '\n\n[… ' + (s.length - PP_SOURCE_KEEP) + ' more characters not kept — the summary above covers the whole thread]';
}

// The note types a thread may be filed as. Mirrors NOTE_TYPES in team.html
// minus 'system', which is reserved for events the app generates itself.
var PP_NOTE_TYPES = ['update', 'delay', 'direction', 'feedback', 'blocker', 'decision', 'team'];

// The thread as a note. Type matters beyond bookkeeping: a thread filed as
// 'blocker' or 'direction' is one patternOpenBlocker and patternGoalDrift can
// see, so classifying it correctly is what connects a pasted email to the nudge
// engine.
function ppNormalizeThreadNote(raw, text) {
  var n = (raw && raw.note) || {};
  var type = PP_NOTE_TYPES.indexOf(n.type) >= 0 ? n.type : 'update';
  // Validate against the page's own list where it exists, so the two cannot
  // drift into a type team.html has no emoji or label for.
  if (typeof NOTE_TYPES !== 'undefined' && Array.isArray(NOTE_TYPES)) {
    var known = NOTE_TYPES.some(function (t) { return t.key === type && t.key !== 'system'; });
    if (!known) type = 'update';
  }
  var summary = typeof n.summary === 'string' ? n.summary.trim() : '';
  var from = typeof n.from === 'string' ? n.from.trim() : '';

  // Is that sender actually in the thread, or did the model supply a plausible
  // name from the project's cast? On an unsigned chat it will happily name
  // somebody, and that name becomes the note's author — a real colleague
  // credited with something they never wrote. Checking the text is the only
  // reliable way to tell, and a guess should be marked as one rather than
  // silently trusted.
  var guessed = false;
  if (from) {
    var hay = String(text || '').toLowerCase();
    var parts = from.toLowerCase().split(/\s+/).filter(Boolean);
    guessed = !parts.some(function (part) {
      return part.length > 2 && hay.indexOf(part) >= 0;
    });
  }

  return {
    type: type,
    summary: summary,
    from: from,
    fromGuessed: guessed,
    sourceText: ppTrimSource(text),
    accept: !!summary   // nothing worth filing if it could not summarise it
  };
}

// Returns proposals. Writes nothing.
function ppReadThread(proj, text, opts) {
  opts = opts || {};
  if (!ppLlmConfigured()) return Promise.reject(new Error('No Gemini key set.'));
  var body = String(text || '').trim();
  // Same shape as a real result, always. Returning a bare array here made an
  // empty paste throw on `result.commitments` at every call site.
  if (!body) return Promise.resolve({ commitments: [], note: null, schedule: [] });
  // A 200KB paste is ~50k tokens against a daily budget of about twenty
  // requests, and the reply then reliably dies on MAX_TOKENS — a charged
  // request that can never succeed. Refuse before spending it.
  if (body.length > PP_PASTE_MAX) {
    return Promise.reject(new Error(
      'That is ' + Math.round(body.length / 1000) + 'KB of text — too much to read in one go (limit ' +
      Math.round(PP_PASTE_MAX / 1000) + 'KB). Paste the part of the thread that matters.'));
  }

  var today = ppAiToday();
  var sched = ppScheduleContext(proj, today);
  return ppCallLLMJson({
    system: PP_EXTRACT_SYSTEM,
    user: ppBuildExtractPrompt(proj, body, sched),
    schema: PP_EXTRACT_SCHEMA,
    temperature: 0,
    signal: opts.signal
  }).then(function (raw) {
    return {
      commitments: ppNormalizeExtracted(raw, proj, { me: opts.me }),
      note: ppNormalizeThreadNote(raw, body),
      schedule: ppNormalizeSchedule(raw, proj, { me: opts.me, today: today, refs: sched.refs, roleFor: opts.roleFor })
    };
  });
}

// Back-compat: the loops alone, for callers that do not want the note half.
function ppExtractCommitmentsOnly(proj, text, opts) {
  return ppReadThread(proj, text, opts).then(function (r) { return r.commitments; });
}

// ── 2. ADVISORY ──

var PP_ADVISORY_SCHEMA = {
  type: 'object',
  properties: {
    health: { type: 'string', enum: ['on-track', 'watch', 'at-risk'] },
    summary: { type: 'string', description: 'One sentence on where the project actually stands.' },
    risks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text:     { type: 'string', description: 'The concern, in one line.' },
          evidence: { type: 'string', description: 'Which line of the dossier says so.' }
        },
        required: ['text']
      }
    },
    proposed: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text:      { type: 'string' },
          owner:     { type: 'string' },
          direction: { type: 'string', enum: ['mine', 'theirs'] },
          due:       { type: 'string' },
          why:       { type: 'string', description: 'Why this is worth doing, from the dossier.' }
        },
        required: ['text']
      }
    }
  },
  // risks and proposed MUST be required. Left optional, the model simply omits
  // them — `proposed` came back empty on 3 of 4 test projects, which quietly
  // disabled the accept-into-loops payoff this whole feature exists for. An
  // empty array is a fine answer; a missing field is not.
  required: ['health', 'summary', 'risks', 'proposed']
};

var PP_ADVISORY_SYSTEM = [
  'You review a single video project and say what is slipping. You are given a complete dossier: brief, team, timeline, open loops, notes, and computed facts.',
  '',
  'Rules:',
  '- Ground everything in the dossier. Never invent a fact, a person, or a date that is not in it.',
  '- Cite the line you relied on in `evidence`. If you cannot cite one, do not raise the risk.',
  '- An empty brief, a stale open loop, a project past its cadence, and work past its scheduled date are the things most worth noticing.',
  '- Do not restate the timeline back. Say what it implies.',
  '- proposed: concrete next actions, at most four, only where the dossier supports them. Fewer is better than padded.',
  '- health: "on-track" unless the dossier gives a specific reason otherwise. Do not hedge to "watch" out of caution.',
  '- summary: one sentence a producer could read in three seconds.'
].join('\n');

// Dossier options for the advisory. Completions come from whichever page loaded
// this file — dash keeps them (isTaskDone), team reads dash's copy
// (isTaskDoneHere). The local edition has no source, and passing none makes the
// dossier say nothing about done/overdue instead of calling all past work late.
function ppDossierOpts() {
  var done = window.PREPRO_LOCAL ? null
    : typeof isTaskDoneHere === 'function' ? isTaskDoneHere
    : typeof isTaskDone === 'function' ? isTaskDone
    : null;
  return done ? { today: ppAiToday(), isTaskDone: done } : { today: ppAiToday() };
}

function ppBuildAdvisoryPrompt(proj) {
  return [
    'Today is ' + ppAiToday() + '.',
    '',
    buildProjectDossier(proj, ppDossierOpts()),
    '',
    'Return the JSON described by the schema.'
  ].join('\n');
}

// ── ADVISORY CACHE (prepro/advisory) ──
// Keyed by project, stamped with the hash of the dossier it was computed from.
// Shared rather than per-person on purpose: 30 projects × 5 people × every page
// load would be a runaway, and one person's sweep should serve the whole team.
var advisoryRecords = {};

var PP_HEALTH_VALUES = ['on-track', 'watch', 'at-risk'];

function ppNormalizeAdvisory(a, proj) {
  a = a || {};
  // `health` is declared as an enum in the schema but a schema is a request,
  // not a guarantee. team.html builds a CSS class out of this value and it is
  // written to the shared advisory node, so an arbitrary string would reach
  // every teammate's screen. Clamp it.
  var health = PP_HEALTH_VALUES.indexOf(a.health) >= 0 ? a.health : 'on-track';
  return {
    hash:        String(a.hash || ''),
    generatedAt: String(a.generatedAt || ''),
    by:          String(a.by || ''),
    model:       String(a.model || ''),
    health:      health,
    summary:     typeof a.summary === 'string' ? a.summary : '',
    risks:       Array.isArray(a.risks) ? a.risks.map(function (r) {
                   return { text: String((r && r.text) || ''), evidence: String((r && r.evidence) || '') };
                 }).filter(function (r) { return !!r.text; }) : [],
    proposed:    Array.isArray(a.proposed) ? a.proposed.map(function (p) {
                   // Same resolution the extraction path gets. Without it an
                   // aliased owner ("Marcus D") is stored raw and the loop is
                   // invisible to every name-keyed query and nudge.
                   var owner = ppResolveOwner(String((p && p.owner) || '').trim(), proj);
                   return {
                     text: String((p && p.text) || ''),
                     owner: owner,
                     direction: ppCoherentDirection(owner, p && p.direction, ''),
                     due: ppValidIsoDate(p && p.due),
                     why: String((p && p.why) || '')
                   };
                 }).filter(function (p) { return !!p.text; }) : []
  };
}

function ppNormalizeAdvisoryMap(src) {
  var out = {};
  Object.keys(src || {}).sort().forEach(function (id) { out[id] = ppNormalizeAdvisory(src[id]); });
  return out;
}

function applyRemoteAdvisory(data) {
  var incoming = ppNormalizeAdvisoryMap(data || {});
  if (JSON.stringify(incoming) === JSON.stringify(ppNormalizeAdvisoryMap(advisoryRecords))) return false;
  advisoryRecords = incoming;
  return true;
}

function ppAdvisoryFor(projectId) { return advisoryRecords[projectId] || null; }

function ppSaveAdvisory(projectId, record) {
  advisoryRecords[projectId] = ppNormalizeAdvisory(record);
  if (!window._fb) return;
  var fb = window._fb;
  fb.set(fb.ref(fb.db, 'prepro/advisory/' + projectId), advisoryRecords[projectId])
    .catch(function (err) { console.error('saveAdvisory:', err); });
}

function ppClearAdvisory(projectId) {
  delete advisoryRecords[projectId];
  if (!window._fb) return;
  var fb = window._fb;
  fb.set(fb.ref(fb.db, 'prepro/advisory/' + projectId), null)
    .catch(function (err) { console.error('clearAdvisory:', err); });
}

function ppDossierHash(proj) {
  return ppHash(buildProjectDossier(proj, ppDossierOpts()));
}

// Is the cached analysis still about the project as it stands? A false here is
// the "this predates Marcus's feedback note" signal, which falls out for free.
function ppAdvisoryIsCurrent(proj) {
  var rec = ppAdvisoryFor(proj && proj.id);
  if (!rec || !rec.hash) return false;
  return rec.hash === ppDossierHash(proj);
}

// Runs the analysis. Never called on render — only on an explicit request, and
// `force` is required to spend a request when the cache is already current.
function ppRunAdvisory(proj, opts) {
  opts = opts || {};
  if (!ppLlmConfigured()) return Promise.reject(new Error('No Gemini key set.'));
  if (!proj) return Promise.reject(new Error('No project.'));
  // A finished project has nothing to slip. Asking anyway spent a request to be
  // told a completed project was "at-risk" because tasks in its past sat after
  // their scheduled date — which is what finished work looks like.
  if (proj.completed || proj.cancelled) {
    return Promise.reject(new Error('This project is ' + (proj.completed ? 'completed' : 'cancelled') + ' — there is nothing to review.'));
  }

  if (!opts.force && ppAdvisoryIsCurrent(proj)) {
    return Promise.resolve(ppAdvisoryFor(proj.id));
  }

  var hash = ppDossierHash(proj);
  return ppCallLLMJson({
    system: PP_ADVISORY_SYSTEM,
    user: ppBuildAdvisoryPrompt(proj),
    schema: PP_ADVISORY_SCHEMA,
    temperature: 0.1,
    timeoutMs: 120000,
    signal: opts.signal
  }).then(function (raw) {
    var rec = ppNormalizeAdvisory({
      hash: hash,
      generatedAt: ppAiToday(),
      by: opts.by || '',
      model: ppPickModel(ppLlmSettings().model) || '',
      health: raw && raw.health,
      summary: raw && raw.summary,
      risks: raw && raw.risks,
      proposed: raw && raw.proposed
    }, proj);
    // Drop suggestions that duplicate a loop already on the project — the
    // advisory has no "do not repeat" rule of its own and cheerfully proposes
    // one that is already being chased, sometimes pointing the other way.
    if (typeof commitmentsForProject === 'function') {
      var live = (commitmentsForProject(proj.id, { openOnly: true }) || []).map(function (c) { return c.text; });
      rec.proposed = rec.proposed.filter(function (p) {
        return !live.some(function (t) { return ppSameLoop(t, p.text); });
      });
    }
    ppSaveAdvisory(proj.id, rec);
    return rec;
  });
}

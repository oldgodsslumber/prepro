/* ── PRE-PRO · SHARED PEOPLE MODULE ─────────────────────────────────────────
 *
 * Everything that answers "who is this person?" lives here, once, for team.html,
 * ops.html and dash.html.
 *
 * It exists because the three pages used to carry copy-pasted copies of
 * deletePersonEverywhere / mergePersonInto / collectAllPeople. When team.html
 * gained the person record, the copies in Ops and Dash silently kept the old
 * behaviour — deleting someone in Ops left their record behind, and team.html
 * read that orphan back and resurrected them. Sharing the code is the fix for
 * that whole class of bug, not just the one instance.
 *
 * Loaded as a CLASSIC script (not a module) before each page's inline script,
 * so the globals below are already defined by the time that script runs.
 *
 * Firebase: writes go through window._fb, which auth.js populates. Every setter
 * no-ops safely before Firebase is ready, so nothing here has to be ordered
 * against the auth gate.
 * ─────────────────────────────────────────────────────────────────────────── */
'use strict';

// ── TEAMS ──
// A person belongs to exactly one team. This is the identity axis: it answers
// "who is this?" and drives how the roster panel is grouped. Roles stay the
// separate "what are they doing on this task?" axis, which is why the two lists
// overlap without being redundant.
//
// `roles` here is only used to *derive* a team when migrating an existing
// person and to colour a role — it is not membership. Membership is the stored
// `team` key, so a Producer who moves to Brand Creative stops being on the
// Video Team the moment someone says so, not the moment they stop producing.
var TEAMS = [
  { key: 'video',  label: 'Video Team',     color: '#4a90d9', roles: ['Producer', 'Editor', 'Animator'] },
  { key: 'brand',  label: 'Brand Creative', color: '#e07b39', roles: ['Copywriter', 'Designer'] },
  { key: 'stake',  label: 'Stakeholders',   color: '#4aa9a0', roles: ['Stakeholder'] },
  { key: 'vendor', label: 'Vendors',        color: '#7c5cbf', roles: ['External Vendor'] }
];
var TEAM_KEYS = TEAMS.map(function (t) { return t.key; });
function getTeam(key) { return TEAMS.find(function (t) { return t.key === key; }) || null; }
function teamLabel(key) { var t = getTeam(key); return t ? t.label : ''; }
function teamColor(key) { var t = getTeam(key); return t ? t.color : 'var(--dim)'; }
// Team a role most likely implies, used only when deriving a record.
function teamForRole(role) { var t = TEAMS.find(function (t) { return t.roles.includes(role); }); return t ? t.key : ''; }

// Offices we track. Doubles as a person's home country and as the set of codes
// a Holiday can be tagged with — they are the same domain, so they are one list
// and cannot drift apart.
var PERSON_COUNTRIES = [
  { code: 'US', label: 'United States' },
  { code: 'IN', label: 'India' },
  { code: 'PL', label: 'Poland' },
  { code: 'UK', label: 'United Kingdom' }
];
var PERSON_COUNTRY_CODES = PERSON_COUNTRIES.map(function (c) { return c.code; });

/* ── PEOPLE RECORDS (prepro/people) ──────────────────────────────────────────
 * The single source of truth about a person:
 *
 *   name -> { team, roles[], defaultRole, email, country, aliases[],
 *             active, departedOn }
 *
 * Keyed by NAME rather than a generated id on purpose: every task already
 * stores `t.person = "<name>"` and every roster is an array of names, so ids
 * would mean rewriting all existing state. `aliases` covers the format-variant
 * problem ids would otherwise solve ("Walsh, Ryan" vs "Ryan Walsh"), and
 * renames go through the merge path.
 *
 * `active` and `departedOn` are both present deliberately. Migrating an
 * existing file can tell *that* someone is gone but not *when* they left, so it
 * can only set the boolean; a date can be filled in later and is what the
 * workload views prefer when it exists.
 * ─────────────────────────────────────────────────────────────────────────── */
var peopleRecords = {};

function savePeopleRecords() {
  if (!window._fb) return;
  var fb = window._fb;
  fb.set(fb.ref(fb.db, 'prepro/people'), peopleRecords)
    .catch(function (err) { console.error('savePeopleRecords:', err); });
}
function hasPeopleRecords() { return Object.keys(peopleRecords || {}).length > 0; }
function getPerson(name) { return (peopleRecords && peopleRecords[name]) || null; }

// Firebase drops empty arrays, empty strings and nulls, so a record written as
// {aliases: [], departedOn: null} comes back as {}. Normalising both sides
// before comparing is what stops our own echo from reading as a teammate's edit
// and re-rendering the world on every keystroke.
function normalizePeopleRecords(src) {
  var out = {};
  Object.keys(src || {}).sort().forEach(function (name) {
    var r = src[name] || {};
    out[name] = {
      team:        r.team || '',
      roles:       Array.isArray(r.roles) ? r.roles.slice().sort() : [],
      defaultRole: r.defaultRole || '',
      email:       r.email || '',
      country:     r.country || '',
      aliases:     Array.isArray(r.aliases) ? r.aliases.slice().sort() : [],
      active:      r.active !== false,
      departedOn:  r.departedOn || null
    };
  });
  return out;
}
// Returns true when the incoming snapshot genuinely differs from what we hold.
function applyRemotePeople(data) {
  var incoming = normalizePeopleRecords(data || {});
  if (JSON.stringify(incoming) === JSON.stringify(normalizePeopleRecords(peopleRecords))) return false;
  peopleRecords = incoming;
  return true;
}

// ── NAME MATCHING ──
// Normalised form used for alias/name matching: case-insensitive, punctuation
// and whitespace collapsed, and "Last, First" folded to "First Last" so the
// Pega export's name format matches the roster's.
function normalizePersonKey(raw) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  var comma = s.match(/^([^,]+),\s*(.+)$/);
  if (comma) s = comma[2] + ' ' + comma[1];
  return s.toLowerCase().replace(/[.'’"()]/g, '').replace(/\s+/g, ' ').trim();
}
// Canonical name for whatever form we were handed — exact hit, then normalised
// name, then alias. Returns '' when nobody matches, so callers can tell "no
// match" apart from "matched an empty name".
function resolvePersonName(raw) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (peopleRecords[s]) return s;
  var key = normalizePersonKey(s);
  if (!key) return '';
  var fallback = '';
  var names = Object.keys(peopleRecords);
  for (var i = 0; i < names.length; i++) {
    var rec = peopleRecords[names[i]];
    if (normalizePersonKey(names[i]) === key) return names[i];
    if (!fallback && (rec.aliases || []).some(function (a) { return normalizePersonKey(a) === key; })) fallback = names[i];
  }
  return fallback;
}

// ── RECORD MUTATORS ──
function upsertPerson(name, patch) {
  var nm = (name || '').trim();
  if (!nm) return null;
  var cur = peopleRecords[nm] || {
    team: '', roles: [], defaultRole: '', email: '',
    country: '', aliases: [], active: true, departedOn: null
  };
  peopleRecords[nm] = Object.assign({}, cur, patch || {});
  savePeopleRecords();
  return peopleRecords[nm];
}
function setPersonTeam(name, teamKey) {
  var rec = upsertPerson(name, { team: TEAM_KEYS.includes(teamKey) ? teamKey : '' });
  // Keep defaultRole honest: a role from the old team is worse than none.
  if (rec && rec.defaultRole && teamForRole(rec.defaultRole) !== rec.team) {
    var t = getTeam(rec.team);
    upsertPerson(name, {
      defaultRole: t ? ((rec.roles || []).find(function (r) { return t.roles.includes(r); }) || t.roles[0]) : ''
    });
  }
  return getPerson(name);
}
function setPersonCountry(name, code) {
  return upsertPerson(name, { country: PERSON_COUNTRY_CODES.includes(code) ? code : '' });
}
function setPersonAliases(name, raw) {
  var seen = {}, list = [];
  String(raw || '').split(',').forEach(function (a) {
    var v = a.trim(), k = normalizePersonKey(v);
    if (!v || !k || k === normalizePersonKey(name) || seen[k]) return;
    seen[k] = 1; list.push(v);
  });
  return upsertPerson(name, { aliases: list });
}
// Last day they were with the team. Setting one makes the workload views treat
// them as capacity up to that date and not after it; clearing it falls back to
// the plain active/inactive flag.
function setPersonDeparted(name, iso) {
  var clean = /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso : null;
  return upsertPerson(name, {
    active: clean ? false : (getPerson(name) || {}).active !== false,
    departedOn: clean
  });
}

// ── RECORD READERS ──
function personTeam(name) { var r = getPerson(name); return r ? r.team || '' : ''; }
function personCountry(name) { var r = getPerson(name); return r ? r.country || '' : ''; }
function personAliases(name) { var r = getPerson(name); return (r && r.aliases) || []; }
// Role a dragged person lands on a chip as. Falls back to their first known
// role, then to their team's primary — never to a hardcoded guess.
function personDefaultRole(name) {
  var r = getPerson(name);
  if (!r) return '';
  if (r.defaultRole) return r.defaultRole;
  if ((r.roles || []).length) return r.roles[0];
  var t = getTeam(r.team);
  return t ? t.roles[0] : '';
}

/* ── SUNSET & DEPARTURES ─────────────────────────────────────────────────────
 * Sunset answers "hide them from pickers". The departure helpers answer the
 * different question the workload views need: was this person still here on
 * this date? Without that, someone who left in March reads as idle capacity for
 * the rest of the year.
 *
 * The legacy prepro/sunsetPeople map is still read and written so a tab running
 * an older build stays consistent.
 * ─────────────────────────────────────────────────────────────────────────── */
var sunsetPeople = {}; // name -> true

function saveSunsetPeople() {
  if (!window._fb) return;
  var fb = window._fb;
  fb.set(fb.ref(fb.db, 'prepro/sunsetPeople'), sunsetPeople)
    .catch(function (err) { console.error('saveSunsetPeople:', err); });
}
function applyRemoteSunset(data) {
  var incoming = (data && typeof data === 'object') ? data : {};
  if (JSON.stringify(incoming) === JSON.stringify(sunsetPeople)) return false;
  sunsetPeople = incoming;
  return true;
}
function isSunset(name) {
  var rec = getPerson(name);
  if (rec && rec.active === false) return true;
  if (rec && rec.active === true) return false;
  return !!sunsetPeople[name];
}
function sunsetPerson(name) {
  if (!name) return;
  sunsetPeople[name] = true; saveSunsetPeople();
  if (getPerson(name)) upsertPerson(name, { active: false });
}
function restorePerson(name) {
  if (sunsetPeople[name]) { delete sunsetPeople[name]; saveSunsetPeople(); }
  if (getPerson(name)) upsertPerson(name, { active: true, departedOn: null });
}
// A record with active:false and no date is someone we know has gone but whose
// last day was never recorded. They get no workload row at all, because a
// permanently empty row reads as spare capacity.
function personGoneEntirely(name) {
  var rec = getPerson(name);
  return !!(rec && rec.active === false && !rec.departedOn);
}
function personActiveOn(name, dateStr) {
  var rec = getPerson(name);
  if (!rec) return true;                        // no record — assume present
  if (rec.departedOn) return dateStr <= rec.departedOn;
  return rec.active !== false;
}
// "Should this person show up as capacity on this date?" — the date-aware
// counterpart to isSunset, which can only answer "hide them from pickers".
//
// Use this, not isSunset, anywhere a person is being listed as somebody who
// works here. isSunset flips the moment a last day is *recorded*, so filtering
// on it erased people who are still here for another three weeks — they
// vanished from the sidebar and could not open their own dashboard.
function personCapacityOn(name, dateStr) {
  if (personGoneEntirely(name)) return false;          // gone, last day unknown
  if (!getPerson(name)) return !sunsetPeople[name];    // no record — legacy map only
  return personActiveOn(name, dateStr);
}

/* ── DELETE / MERGE (record half) ────────────────────────────────────────────
 * Each page still owns the part that walks its own state (rosters, tasks,
 * attendees, nameHistory). These two functions own the record, so no page can
 * forget it — which is exactly what went wrong before this module existed.
 * ─────────────────────────────────────────────────────────────────────────── */
function deletePersonRecord(name) {
  var touched = false;
  if (peopleRecords[name]) { delete peopleRecords[name]; touched = true; }
  if (sunsetPeople[name]) { delete sunsetPeople[name]; saveSunsetPeople(); }
  if (touched) savePeopleRecords();
  return touched;
}
// Fold two records together. The merged-away name becomes an alias of the
// survivor, so whatever kept re-creating it (usually a differently-formatted
// name in the Pega export) matches the survivor next time instead of minting
// the duplicate all over again.
function mergePersonRecords(from, into) {
  if (!from || !into || from === into) return false;
  if (sunsetPeople[from]) { delete sunsetPeople[from]; saveSunsetPeople(); }
  var recFrom = peopleRecords[from], recInto = peopleRecords[into];
  if (!recFrom && !recInto) return false;

  var merged = Object.assign({
    team: '', roles: [], defaultRole: '', email: '',
    country: '', aliases: [], active: true, departedOn: null
  }, recFrom || {}, recInto || {});

  var union = function (a, b) {
    var seen = {}, out = [];
    (a || []).concat(b || []).forEach(function (v) {
      var k = normalizePersonKey(v);
      if (!v || !k || seen[k]) return;
      seen[k] = 1; out.push(v);
    });
    return out;
  };
  merged.roles   = union(recInto && recInto.roles,   recFrom && recFrom.roles);
  merged.aliases = union(recInto && recInto.aliases, recFrom && recFrom.aliases);
  // Record the old name as an alias unless it's just a formatting variant of
  // the survivor's own name, which resolvePersonName already handles.
  if (normalizePersonKey(from) !== normalizePersonKey(into) &&
      !merged.aliases.some(function (a) { return normalizePersonKey(a) === normalizePersonKey(from); })) {
    merged.aliases.push(from);
  }
  if (!merged.team && recFrom) merged.team = recFrom.team || '';
  if (!merged.email && recFrom) merged.email = recFrom.email || '';
  if (!merged.country && recFrom) merged.country = recFrom.country || '';
  if (merged.defaultRole && !merged.roles.includes(merged.defaultRole)) merged.roles.push(merged.defaultRole);

  peopleRecords[into] = merged;
  delete peopleRecords[from];
  savePeopleRecords();
  return true;
}

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
  if (typeof peopleRecords === 'object' && peopleRecords) {
    Object.keys(peopleRecords).forEach(function (n) {
      if (typeof personGoneEntirely === 'function' && personGoneEntirely(n)) return;
      set[n] = true;
    });
  }
  return Object.keys(set).sort();
}

// ── 1. EXTRACTION ──

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
          quote:     { type: 'string', description: 'The sentence from the text this came from.' }
        },
        required: ['text', 'direction']
      }
    }
  },
  required: ['commitments']
};

var PP_EXTRACT_SYSTEM = [
  'You read work correspondence and pull out open loops: things somebody now owes somebody else.',
  '',
  'Rules:',
  '- Only extract what the text actually says. Never infer a task that would be sensible but is not stated.',
  '- One loop per distinct action. Do not merge two actions into one line.',
  '- text: a short imperative line, under about 12 words. No names in it — the owner field carries that.',
  '- owner: copy a name EXACTLY as it appears in the known-people list when it plainly refers to that person. If the text names somebody not on that list, use the name as written. If genuinely unclear, use an empty string.',
  '- direction: "mine" when our side owes it, "theirs" when we are waiting on somebody else.',
  '- due: only when a date is actually stated or clearly implied ("by Friday"). Resolve relative dates against the stated today. Otherwise empty string.',
  '- quote: the sentence you took it from, verbatim, so a human can check you.',
  '- Skip anything already listed as an existing open loop.',
  '- Pleasantries, FYIs and things already done are not open loops. Returning an empty array is a correct answer.'
].join('\n');

// Context, not the whole dossier: extraction needs the cast list and what is
// already tracked, and nothing else. Sending the full dossier here would cost
// tokens to make the model worse at a narrow job.
function ppBuildExtractContext(proj) {
  var today = ppAiToday();
  var lines = [
    'Today is ' + today + '.',
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
  return lines.join('\n');
}

function ppBuildExtractPrompt(proj, text) {
  return [
    ppBuildExtractContext(proj),
    '',
    '--- PASTED TEXT BEGINS ---',
    String(text || '').trim(),
    '--- PASTED TEXT ENDS ---',
    '',
    'Return {"commitments": [...]} following the schema. An empty array is fine.'
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
function ppResolveOwner(owner, proj) {
  if (!owner) return '';
  if (typeof resolvePersonName === 'function') {
    var resolved = resolvePersonName(owner);
    if (resolved) return resolved;
  }
  if (typeof normalizePersonKey === 'function') {
    var key = normalizePersonKey(owner);
    if (key) {
      var match = ppKnownNames(proj).find(function (n) { return normalizePersonKey(n) === key; });
      if (match) return match;
    }
  }
  return owner;
}

// Resolves and sanitises whatever came back. The model's output never reaches
// the store directly, so this exists to make the review list trustworthy —
// dates that are not dates, owners that are not people, empty rows.
function ppNormalizeExtracted(raw, proj) {
  var out = [];
  var list = (raw && raw.commitments) || [];
  if (!Array.isArray(list)) return out;

  var existing = {};
  if (typeof commitmentsForProject === 'function' && proj) {
    (commitmentsForProject(proj.id, { openOnly: true }) || []).forEach(function (c) {
      existing[String(c.text).trim().toLowerCase()] = true;
    });
  }

  list.forEach(function (item) {
    if (!item) return;
    var text = String(item.text || '').trim();
    if (!text) return;
    if (existing[text.toLowerCase()]) return; // model ignored the instruction

    var owner = ppResolveOwner(String(item.owner || '').trim(), proj);
    var due = String(item.due || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) due = '';

    var direction = item.direction === 'theirs' ? 'theirs' : 'mine';
    out.push({
      text: text,
      owner: owner,
      direction: direction,
      due: due,
      quote: String(item.quote || '').trim(),
      accept: true   // pre-ticked; the reviewer unticks what is wrong
    });
  });
  return out;
}

// Returns proposals. Writes nothing.
function ppExtractCommitments(proj, text, opts) {
  opts = opts || {};
  if (!ppLlmConfigured()) return Promise.reject(new Error('No Gemini key set.'));
  var body = String(text || '').trim();
  if (!body) return Promise.resolve([]);

  return ppCallLLMJson({
    system: PP_EXTRACT_SYSTEM,
    user: ppBuildExtractPrompt(proj, body),
    schema: PP_EXTRACT_SCHEMA,
    temperature: 0,
    signal: opts.signal
  }).then(function (raw) {
    return ppNormalizeExtracted(raw, proj);
  });
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
  required: ['health', 'summary']
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

function ppBuildAdvisoryPrompt(proj) {
  return [
    'Today is ' + ppAiToday() + '.',
    '',
    buildProjectDossier(proj, { today: ppAiToday() }),
    '',
    'Return the JSON described by the schema.'
  ].join('\n');
}

// ── ADVISORY CACHE (prepro/advisory) ──
// Keyed by project, stamped with the hash of the dossier it was computed from.
// Shared rather than per-person on purpose: 30 projects × 5 people × every page
// load would be a runaway, and one person's sweep should serve the whole team.
var advisoryRecords = {};

function ppNormalizeAdvisory(a) {
  a = a || {};
  return {
    hash:        String(a.hash || ''),
    generatedAt: String(a.generatedAt || ''),
    by:          String(a.by || ''),
    model:       String(a.model || ''),
    health:      String(a.health || ''),
    summary:     String(a.summary || ''),
    risks:       Array.isArray(a.risks) ? a.risks.map(function (r) {
                   return { text: String((r && r.text) || ''), evidence: String((r && r.evidence) || '') };
                 }).filter(function (r) { return !!r.text; }) : [],
    proposed:    Array.isArray(a.proposed) ? a.proposed.map(function (p) {
                   return {
                     text: String((p && p.text) || ''),
                     owner: String((p && p.owner) || ''),
                     direction: (p && p.direction) === 'theirs' ? 'theirs' : 'mine',
                     due: /^\d{4}-\d{2}-\d{2}$/.test((p && p.due) || '') ? p.due : '',
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
  return ppHash(buildProjectDossier(proj, { today: ppAiToday() }));
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
    });
    ppSaveAdvisory(proj.id, rec);
    return rec;
  });
}

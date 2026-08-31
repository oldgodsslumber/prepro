/* ── PRE-PRO · GEMINI CLIENT ─────────────────────────────────────────────────
 *
 * Ported from d:\claudecode\storybible2\js\llm.js, with the structured-output
 * handling grafted from d:\claudecode\storyboarder\js\providers.js and the
 * model facts moved out into gemini-models.json (a copy of the shared
 * gemini-registry). Converted from an ES module to a classic script, the same
 * contract people.js and commitments.js follow.
 *
 * ── The two rules this file exists to enforce ──
 *
 * 1. EVERY PERSON BRINGS THEIR OWN KEY, and the app is completely usable
 *    without one. prepro is multi-user, deployed from a public Pages repo,
 *    against a wildcard-readable Firebase node — a shared key in here is a
 *    published key. Keys live in localStorage and never touch `prepro/`.
 *    `ppLlmConfigured()` is false until somebody pastes one, and every caller
 *    must check it and degrade silently rather than showing a dead button.
 *
 * 2. QUOTA HANDLING IS LOAD-BEARING, not polish. On a free tier the daily
 *    limits are the operating constraint, so the usage counter and the
 *    fall-through chain will fire routinely rather than in some edge case.
 *    When the whole chain is spent, callers must fall back to the
 *    deterministic behaviour and say so plainly — never surface a raw API
 *    error as if the feature were broken.
 *
 * ── Hard-won API facts, inherited rather than rediscovered ──
 *
 * Gemma silently IGNORES responseMimeType: it is accepted, no error is raised,
 * and the model answers in prose anyway. gemini-3.5-flash-lite REJECTS
 * thinkingBudget but accepts thinkingLevel, while 2.5 predates thinkingLevel
 * entirely. Neither is visible in a status code. Both are now data in
 * gemini-models.json (`caps.jsonMode`, `caps.thinking`) rather than regexes
 * here, so refreshing the registry updates the behaviour.
 * ─────────────────────────────────────────────────────────────────────────── */
'use strict';

var PP_LLM_SETTINGS_KEY = 'prepro.llm.v1';
var PP_LLM_USAGE_KEY    = 'prepro.llm.usage.v1';
var PP_LLM_REGISTRY_URL = './gemini-models.json';

var PP_LLM_DEFAULTS = {
  apiKey: '',
  model: 'gemini-3.7-flash',
  temperature: 0.2,   // extraction, not prose — low and boring is correct
  enabled: true
};

// Baked-in fallback so the client still works if the registry file is missing
// or a fetch fails. Deliberately minimal: the file is the source of truth.
var PP_LLM_REGISTRY = {
  defaults: { gemini: 'gemini-3.7-flash' },
  chain: ['gemini-3.7-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemma-4-31b-it'],
  retired: [],
  models: {
    'gemini-3.7-flash':      { status: 'live', label: 'Gemini 3.7 Flash',      family: 'gemini', caps: { jsonMode: 'honored', thinking: 'thinkingLevel' } },
    'gemini-3.5-flash-lite': { status: 'live', label: 'Gemini 3.5 Flash Lite', family: 'gemini', caps: { jsonMode: 'honored', thinking: 'thinkingLevel' } },
    'gemini-2.5-flash':      { status: 'live', label: 'Gemini 2.5 Flash',      family: 'gemini', caps: { thinking: 'thinkingBudget' } },
    'gemma-4-31b-it':        { status: 'live', label: 'Gemma 4 31B',           family: 'gemma',  caps: { jsonMode: 'ignored', thinking: 'none' } }
  }
};

// Free-tier daily request budgets. Google no longer publishes per-model RPD, so
// these are conservative guesses — the 429 fall-through is the real backstop
// and this counter only exists to avoid burning a request to discover that.
var PP_LLM_DAILY_LIMITS = { gemini: 20, gemma: 1400 };

var _ppRegistryLoaded = false;

// Refreshes the model facts from the registry copy in this repo. Safe to call
// repeatedly; failure is silent because the baked-in fallback is sufficient.
function ppLoadLlmRegistry() {
  if (_ppRegistryLoaded) return Promise.resolve(PP_LLM_REGISTRY);
  _ppRegistryLoaded = true;
  var url = PP_LLM_REGISTRY_URL + '?v=' + (window.PREPRO_BUILD || '0');
  return fetch(url, { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (d && d.models && d.chain) PP_LLM_REGISTRY = d;
      return PP_LLM_REGISTRY;
    })
    .catch(function () { return PP_LLM_REGISTRY; });
}

function ppModelInfo(id) {
  return (PP_LLM_REGISTRY.models || {})[id] || null;
}
function ppModelLabel(id) {
  var m = ppModelInfo(id);
  return (m && m.label) || id;
}
function ppModelFamily(id) {
  var m = ppModelInfo(id);
  if (m && m.family) return m.family;
  return /^gemma/i.test(id) ? 'gemma' : 'gemini';
}
function ppModelDailyLimit(id) {
  return PP_LLM_DAILY_LIMITS[ppModelFamily(id)] || 20;
}
// Whether responseMimeType/responseSchema are actually honoured. Absent in the
// registry means untested, not false — fall back to the family heuristic, since
// assuming a Gemma honours JSON mode is the failure that produces no error at
// all, just prose.
function ppModelHonorsJson(id) {
  var m = ppModelInfo(id);
  var v = m && m.caps && m.caps.jsonMode;
  if (v === 'honored') return true;
  if (v === 'ignored') return false;
  return ppModelFamily(id) !== 'gemma';
}
function ppModelThinking(id) {
  var m = ppModelInfo(id);
  var v = m && m.caps && m.caps.thinking;
  if (v) return v;
  if (ppModelFamily(id) === 'gemma') return 'none';
  return /^gemini-3/i.test(id) ? 'thinkingLevel' : /gemini-2\.5-flash/i.test(id) ? 'thinkingBudget' : 'none';
}

function ppLiveModels() {
  var models = PP_LLM_REGISTRY.models || {};
  return Object.keys(models)
    .filter(function (id) { return models[id].status === 'live'; })
    .sort(function (a, b) {
      var ca = (PP_LLM_REGISTRY.chain || []).indexOf(a);
      var cb = (PP_LLM_REGISTRY.chain || []).indexOf(b);
      if (ca >= 0 && cb >= 0) return ca - cb;
      if (ca >= 0) return -1;
      if (cb >= 0) return 1;
      return a.localeCompare(b);
    });
}

// ── SETTINGS ──
function ppLlmSettings() {
  var s;
  try { s = JSON.parse(localStorage.getItem(PP_LLM_SETTINGS_KEY) || '{}'); }
  catch (_) { s = {}; }
  var out = {};
  Object.keys(PP_LLM_DEFAULTS).forEach(function (k) {
    out[k] = s[k] === undefined ? PP_LLM_DEFAULTS[k] : s[k];
  });
  // A retired model in a saved setting would 404 forever; reset rather than
  // leave someone with a permanently dead feature.
  if ((PP_LLM_REGISTRY.retired || []).indexOf(out.model) >= 0) out.model = PP_LLM_DEFAULTS.model;
  return out;
}

function ppLlmSave(patch) {
  var next = ppLlmSettings();
  Object.keys(patch || {}).forEach(function (k) { if (patch[k] !== undefined) next[k] = patch[k]; });
  try { localStorage.setItem(PP_LLM_SETTINGS_KEY, JSON.stringify(next)); } catch (_) {}
  return next;
}

// The gate every caller must check. False means: render nothing, offer nothing,
// and let the deterministic path stand on its own.
function ppLlmConfigured() {
  var s = ppLlmSettings();
  return !!(s.enabled && s.apiKey);
}

// ── DAILY USAGE ──
function ppUsageToday() {
  var key = (typeof cmTodayStr === 'function') ? cmTodayStr() : new Date().toISOString().slice(0, 10);
  try {
    var raw = JSON.parse(localStorage.getItem(PP_LLM_USAGE_KEY) || '{}');
    if (raw.date !== key) return { date: key, counts: {} };
    if (!raw.counts) raw.counts = {};
    return raw;
  } catch (_) { return { date: key, counts: {} }; }
}
function ppSetUsage(u) {
  try { localStorage.setItem(PP_LLM_USAGE_KEY, JSON.stringify(u)); } catch (_) {}
}
function ppBumpUsage(id) {
  var u = ppUsageToday();
  u.counts[id] = (u.counts[id] || 0) + 1;
  ppSetUsage(u);
  return u.counts[id];
}
// Pushes a model to its limit so the picker skips it for the rest of the day.
// Used when Google says 429 — their counter is authoritative and ours can be
// behind, e.g. the same key used on another machine.
function ppMarkExhausted(id) {
  var u = ppUsageToday();
  u.counts[id] = ppModelDailyLimit(id);
  ppSetUsage(u);
}

// Where in the chain we actually are. A model chosen explicitly outside the
// chain is returned untouched — an explicit choice is not second-guessed.
function ppPickModel(chosen) {
  var chain = PP_LLM_REGISTRY.chain || [];
  var u = ppUsageToday();
  var i = chain.indexOf(chosen);
  if (i < 0) return chosen;
  for (var j = i; j < chain.length; j++) {
    if ((u.counts[chain[j]] || 0) < ppModelDailyLimit(chain[j])) return chain[j];
  }
  return null; // whole chain spent — callers must degrade, not error
}

// For the UI: how much of today's budget is gone, per chain model.
function ppUsageSummary() {
  var u = ppUsageToday();
  return (PP_LLM_REGISTRY.chain || []).map(function (id) {
    return { id: id, label: ppModelLabel(id), used: u.counts[id] || 0, limit: ppModelDailyLimit(id) };
  });
}

function ppChainSpent() { return ppPickModel(ppLlmSettings().model) === null; }

// ── ERRORS ──
// A 429 that says the free-tier limit is ZERO is not a rate limit at all — the
// key is permanently ineligible, usually because its Cloud project has billing
// enabled or it was not made in AI Studio. Waiting does not fix it, and neither
// does falling down the chain: every model returns the same thing. Treating it
// as transient would burn the whole chain and then report "budget spent, resets
// at midnight" forever, hiding the one message that says how to fix it.
function ppIsZeroQuota(status, errText) {
  if (status !== 429) return false;
  var msg = '';
  try { msg = (JSON.parse(errText).error || {}).message || ''; } catch (_) { msg = String(errText || ''); }
  return /limit:\s*0/i.test(msg) && /free_tier/i.test(msg);
}

function ppGeminiError(status, errText, model) {
  var parsed = null;
  try { parsed = JSON.parse(errText); } catch (_) {}
  var msg = (parsed && parsed.error && parsed.error.message) || '';

  if (status === 429 && /limit:\s*0/i.test(msg) && /free_tier/i.test(msg)) {
    return [
      'Your API key has no free-tier quota at all — this is not a temporary rate limit.',
      '',
      'That usually means the key came from a Google Cloud project with billing enabled,',
      'or was not created through AI Studio.',
      '',
      'Fix: open https://aistudio.google.com/app/api-keys, DELETE this key, then',
      '"Create API key" and let AI Studio pick the project for you.'
    ].join('\n');
  }
  if (status === 429) {
    var m = msg.match(/retry in (\d+)/i);
    return 'Rate limited' + (m ? ' — retry in about ' + m[1] + 's.' : '.') +
           '\n\nprepro will fall through to the next model automatically where it can.';
  }
  if (status === 400 && /API key not valid/i.test(msg)) {
    return 'That API key is not valid. Re-copy it from https://aistudio.google.com/app/api-keys — it starts with "AIza".';
  }
  if (status === 403) return 'Forbidden — this key may not have access to ' + ppModelLabel(model) + '.';
  if (status === 404) return 'Model "' + model + '" was not found for this key. Pick another in Settings.';
  if (status >= 500) return "Google's API is temporarily unavailable. This is their end, not yours — try again shortly.";
  return msg ? 'Gemini ' + status + ': ' + msg : 'Gemini ' + status + ': ' + String(errText).slice(0, 300);
}

// A 200 can still carry no usable text, and the reason matters.
function ppEmptyReplyMessage(json, model) {
  var pf = json && json.promptFeedback;
  if (pf && pf.blockReason) {
    return 'Gemini blocked the request (' + pf.blockReason + ') before generating anything. Try rephrasing the pasted text.';
  }
  var reason = json && json.candidates && json.candidates[0] && json.candidates[0].finishReason;
  if (reason === 'MAX_TOKENS') {
    return 'The model ran out of output budget before replying — on a thinking model that usually means it thought too long. Paste less text, or pick a Gemma model in Settings.';
  }
  if (reason === 'SAFETY' || reason === 'PROHIBITED_CONTENT' || reason === 'BLOCKLIST' || reason === 'SPII') {
    return 'The model refused to answer (' + reason + ') and returned nothing. Try rephrasing.';
  }
  return 'The model returned an empty reply' + (reason ? ' (' + reason + ')' : '') + '. Usually transient — try again.';
}

// ── JSON CONTRACT ──
// Repeated as the LAST thing the model sees. A rule at the top of a long prompt
// is reliably forgotten by weaker models by the time they start generating —
// they answer in prose, or echo the schema with "..." placeholders.
var PP_JSON_REMINDER = [
  'REMINDER — output format (this overrides any urge to explain):',
  'Reply with ONLY the JSON described above. Start with { and end with }.',
  'No prose before or after, no markdown fences, no commentary.',
  'Never copy the schema literally: replace every placeholder with real values',
  'taken from the text. Found nothing for a field? Use [] or "" — never "...".'
].join('\n');

function ppParseJsonLoose(text) {
  if (!text) throw new Error('Empty response.');
  var trimmed = String(text).trim();
  try { return JSON.parse(trimmed); } catch (_) {}

  var fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch (_) {} }

  var start = trimmed.search(/[{[]/);
  if (start >= 0) {
    var open = trimmed[start], close = open === '{' ? '}' : ']';
    var depth = 0, inStr = false, esc = false;
    for (var i = start; i < trimmed.length; i++) {
      var c = trimmed[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          var slice = trimmed.slice(start, i + 1);
          try { return JSON.parse(slice); } catch (e) { throw new Error(ppParseError(e, trimmed)); }
        }
      }
    }
  }
  throw new Error(ppParseError(null, trimmed));
}

function ppParseError(err, fullText) {
  var lines = [err ? 'Could not parse JSON: ' + err.message : 'No JSON found in the reply.'];
  if (/\[\s*\.{2,3}/.test(fullText) || /"\.\.\."/.test(fullText)) {
    lines.push('', 'The model echoed the schema back with "..." placeholders instead of real content. Try a stronger model in Settings.');
  }
  lines.push('', 'Returned (first 400 chars):', String(fullText || '').slice(0, 400));
  return lines.join('\n');
}

// ── CORE CALL ──
var PP_LLM_TIMEOUT_MS = 90000;
var PP_LLM_MAX_RETRIES = 2;
var PP_LLM_RETRY_DELAYS = [1500, 4000];

function ppIsTransient(err) {
  var msg = (err && err.message) || String(err);
  if (err && err.status >= 500) return true;
  return /temporarily unavailable|UNAVAILABLE|INTERNAL|overloaded/i.test(msg);
}

function ppAnySignal(signals) {
  var valid = (signals || []).filter(Boolean);
  if (!valid.length) return undefined;
  if (valid.length === 1) return valid[0];
  var ctl = new AbortController();
  valid.forEach(function (sig) {
    if (sig.aborted) ctl.abort(sig.reason);
    else sig.addEventListener('abort', function () { ctl.abort(sig.reason); }, { once: true });
  });
  return ctl.signal;
}

/**
 * opts: { system, user, expectJson, schema, temperature, signal, timeoutMs }
 * `schema` is a JSON Schema; it is only sent to models the registry says
 * honour it, and is what turns "usually valid JSON" into "conforms to our shape".
 * Resolves to the reply text. Rejects with a human-readable Error.
 */
function ppCallLLM(opts) {
  opts = opts || {};
  var s = ppLlmSettings();
  if (!ppLlmConfigured()) {
    return Promise.reject(new Error('No Gemini key set. Add one in Settings → AI, or carry on without it — nothing in prepro requires it.'));
  }

  var model = ppPickModel(s.model);
  if (!model) {
    return Promise.reject(new Error("Today's free-tier budget is spent across every model in the chain. It resets at midnight; everything else in prepro works as normal until then."));
  }

  var temperature = opts.temperature == null ? s.temperature : opts.temperature;
  var user = opts.expectJson ? (opts.user + '\n\n' + PP_JSON_REMINDER) : opts.user;

  var attempt = 0;
  function run() {
    var timeoutCtl = new AbortController();
    var ms = opts.timeoutMs || PP_LLM_TIMEOUT_MS;
    var timer = setTimeout(function () {
      timeoutCtl.abort(new DOMException('Timed out after ' + ms + 'ms', 'TimeoutError'));
    }, ms);
    var signal = ppAnySignal([opts.signal, timeoutCtl.signal]);

    return ppCallGemini(s, model, {
      system: opts.system, user: user, expectJson: opts.expectJson,
      schema: opts.schema, temperature: temperature, signal: signal
    }).then(function (text) {
      clearTimeout(timer);
      return text;
    }, function (err) {
      clearTimeout(timer);
      if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) throw err;

      // A permanently ineligible key looks like a 429 but is not one. Surface it
      // untouched — it is the only error here with a fix the person can act on.
      if (err && err.permanent) throw err;

      // 429: Google's counter beats ours. Mark it spent and fall down the chain.
      if (err && err.status === 429) {
        ppMarkExhausted(model);
        var next = ppPickModel(model);
        if (next && next !== model) {
          model = next;
          return run();
        }
        throw new Error("Today's free-tier budget is spent. It resets at midnight; everything else in prepro works as normal until then.");
      }

      if (!ppIsTransient(err) || attempt >= PP_LLM_MAX_RETRIES) throw err;
      var delay = PP_LLM_RETRY_DELAYS[attempt] || 4000;
      attempt++;
      return new Promise(function (r) { setTimeout(r, delay); }).then(run);
    });
  }
  return run();
}

function ppCallGemini(s, model, o) {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
            encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(s.apiKey);

  var honorsJson = ppModelHonorsJson(model);
  var isGemma = ppModelFamily(model) === 'gemma';

  var text = (isGemma && o.system) ? (o.system + '\n\n----\n\n' + o.user) : o.user;
  var body = {
    contents: [{ role: 'user', parts: [{ text: text }] }],
    generationConfig: { temperature: o.temperature, maxOutputTokens: 8192 }
  };
  if (o.system && !isGemma) body.systemInstruction = { parts: [{ text: o.system }] };

  if (o.expectJson && honorsJson) {
    body.generationConfig.responseMimeType = 'application/json';
    // The graft from storyboarder: a real schema, not just a mime type.
    if (o.schema) body.generationConfig.responseSchema = o.schema;
  } else if (o.expectJson) {
    // Gemma accepts responseMimeType and silently ignores it, answering in
    // bulleted prose that can contain no braces at all — nothing to parse and
    // no error to catch. Wording, not configuration, is the only lever here.
    body.contents[0].parts.push({
      text: '\n\nOutput format: a single JSON object and nothing else. No preamble, no plan, no bullet points, no commentary. A ```json fenced block is acceptable. Your entire reply must be the JSON.'
    });
  }

  // Thinking draws from the same output budget, and extraction needs none of
  // it. Which knob exists varies by model and neither failure is visible in a
  // status code, so this comes from the registry.
  if (o.expectJson) {
    var th = ppModelThinking(model);
    if (th === 'thinkingLevel') body.generationConfig.thinkingConfig = { thinkingLevel: 'low' };
    else if (th === 'thinkingBudget') body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: o.signal
  }).then(function (resp) {
    if (!resp.ok) {
      return resp.text().then(function (errText) {
        var err = new Error(ppGeminiError(resp.status, errText, model));
        err.status = resp.status;
        err.modelId = model;
        // Marks the key itself as the problem, so the 429 handler does not
        // mistake it for today's quota and swallow the diagnosis.
        if (ppIsZeroQuota(resp.status, errText)) err.permanent = true;
        throw err;
      });
    }
    // A 200 means Google ran the call and spent a request NOW, before we know
    // whether usable text came back. Count it here so an empty or filtered
    // reply still tallies and the daily fall-through fires on time. 429s, 5xx
    // and timeouts never reach here, which is correct — those are not charged.
    ppBumpUsage(model);
    return resp.json();
  }).then(function (json) {
    var parts = json && json.candidates && json.candidates[0] &&
                json.candidates[0].content && json.candidates[0].content.parts;
    var out = parts ? parts.map(function (p) { return p.text || ''; }).join('') : '';
    if (!out) throw new Error(ppEmptyReplyMessage(json, model));
    return out;
  });
}

// JSON call with one repair pass. A model that returns nearly-JSON is common
// enough that failing outright would waste a request from a budget of twenty.
function ppCallLLMJson(opts) {
  opts = opts || {};
  var withJson = {};
  Object.keys(opts).forEach(function (k) { withJson[k] = opts[k]; });
  withJson.expectJson = true;

  return ppCallLLM(withJson).then(function (raw) {
    try {
      return ppParseJsonLoose(raw);
    } catch (firstErr) {
      return ppCallLLM({
        system: 'You repair JSON. The user pastes broken or wrapped JSON. Return ONLY the corrected JSON — no prose, no fences. Preserve all data; fix syntax only.',
        user: 'Broken output:\n' + raw,
        expectJson: true,
        temperature: 0,
        signal: opts.signal
      }).then(function (repaired) {
        return ppParseJsonLoose(repaired);
      }, function () {
        throw firstErr; // report the original problem, not the repair's
      });
    }
  });
}

// Settings "test connection": proves the key, the model and the JSON contract
// in one round trip rather than just pinging an endpoint.
function ppTestConnection() {
  return ppCallLLMJson({
    system: 'You are a connection test. Reply with exactly {"ok":true,"model":"<the model you are>"}.',
    user: 'Reply with the JSON described.',
    schema: {
      type: 'object',
      properties: { ok: { type: 'boolean' }, model: { type: 'string' } },
      required: ['ok']
    },
    temperature: 0,
    timeoutMs: 30000
  }).then(function (obj) {
    var s = ppLlmSettings();
    return { ok: !!(obj && obj.ok), model: ppPickModel(s.model), said: (obj && obj.model) || '' };
  });
}

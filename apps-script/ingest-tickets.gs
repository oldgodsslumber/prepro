/**
 * prepro ticket ingestion — Google Apps Script
 *
 * Reads new Pega ticket emails from a Gmail inbox, parses them, and
 * appends a new project entry to the prepro Firebase RTDB.
 *
 * Setup: see README.md in this folder. Required Script Properties:
 *   SENDER       — the From: address(es) to match (e.g. "tickets@example.com").
 *                  Multiple senders can be OR'd by using Gmail search syntax,
 *                  e.g. "from:a@x.com OR from:b@y.com".
 *   RTDB_SECRET  — Firebase legacy database secret used as ?auth=... in REST calls.
 */

const RTDB  = 'https://prepro-e2abc-default-rtdb.firebaseio.com';
const LABEL = 'prepro-imported';

function _props() { return PropertiesService.getScriptProperties(); }
function _sender() { return _props().getProperty('SENDER'); }
function _auth()   { return _props().getProperty('RTDB_SECRET'); }

const FIELD_PATTERNS = {
  name:               /^Title of Request:\s*(.+)$/m,
  function:           /^Your Function:\s*(.+)$/m,
  videoType:          /^Type of Video:\s*(.+)$/m,
  targetAudience:     /^Target Audience:\s*(.+)$/m,
  budget:             /^Budget Available:\s*(.+)$/m,
  requester:          /^Requester:\s*(.+)$/m,
  tangibleGoal1:      /^Tangible Goal # 1[^:]*:\s*(.+)$/m,
  tangibleGoal2:      /^Tangible Goal # 2[^:]*:\s*(.+)$/m,
  completionIssues:   /^Are there any issues\/events[^:]*:\s*(.+)$/m,
  additionalNotes:    /^Please add additional commentary[^:]*:\s*(.+)$/m,
  desiredDueDateRaw:  /^Desired Video Completion Date:\s*(.+)$/m,
};

function ingestTickets() {
  const sender = _sender();
  if (!sender) { Logger.log('SENDER script property not set; aborting.'); return; }

  const label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  const query = (sender.indexOf('from:') === -1 ? 'from:' + sender : sender) + ' -label:' + LABEL;
  const threads = GmailApp.search(query, 0, 25);
  Logger.log('Found %s candidate threads', threads.length);

  const existing = fetchProjects();
  const usedTicketIds = new Set(
    (existing || []).map(p => p && p.ticketId).filter(Boolean)
  );

  threads.forEach(thread => {
    try {
      const msg = thread.getMessages()[0];
      const parsed = parseTicket(msg.getSubject(), msg.getPlainBody(), msg.getBody());
      if (!parsed || !parsed.ticketId) {
        Logger.log('Skip (no ticket id): %s', msg.getSubject());
        return;
      }
      if (usedTicketIds.has(parsed.ticketId)) {
        Logger.log('Skip (already imported): %s', parsed.ticketId);
        thread.addLabel(label);
        return;
      }
      const project = buildProject(parsed);
      appendProject(project);
      usedTicketIds.add(parsed.ticketId);
      thread.addLabel(label);
      Logger.log('Imported %s as project %s', parsed.ticketId, project.id);
    } catch (e) {
      Logger.log('Error on thread "%s": %s', thread.getFirstMessageSubject(), e);
    }
  });
}

function parseTicket(subject, plain, html) {
  const idMatch     = (subject + '\n' + plain).match(/V-(\d+)/);
  const assignMatch = subject.match(/assigned to\s+(.+?)\s*$/i);
  const ticketIdToken = idMatch && idMatch[0];

  const normalized = normalizeBody(plain);

  const out = {
    ticketId:     ticketIdToken || null,
    ticketUrl:    extractTicketUrl(html, ticketIdToken, plain),
    leadProducer: assignMatch ? assignMatch[1].trim() : null,
  };

  for (const key in FIELD_PATTERNS) {
    const m = normalized.match(FIELD_PATTERNS[key]);
    if (m && m[1].trim()) out[key] = m[1].trim();
  }

  // Synopsis is multi-line: capture until the next "Field:" line.
  const synMatch = normalized.match(/^Synopsis:\s*([\s\S]*?)(?=\n[A-Z][^:\n]{0,40}:)/m);
  if (synMatch && synMatch[1].trim()) out.synopsis = synMatch[1].trim();

  return out;
}

// Real Pega emails often collapse multiple fields onto a single line.
// Force every known field label onto its own line so the per-field regexes
// don't bleed across labels.
function normalizeBody(plain) {
  const labels = [
    'Title of Request', 'Your Function', 'Topic', 'Region', 'Subregion',
    'ABM', 'Strategic ABM', 'Vertical', 'Business Objective',
    'Engagement Strategy', 'Vertical ESID', 'Requester', 'Type of Video',
    'Target Audience', 'Budget Available', 'Synopsis',
    'Tangible Goal # 1[^:\\n]*', 'Tangible Goal # 2[^:\\n]*',
    'Date you can provide scripts/other materials by',
    'Desired Video Completion Date',
    'Are there any issues/events[^:\\n]*', 'File Reference URL',
    'Please add additional commentary[^:\\n]*',
    'Related Requests', 'Email Request', 'Social Request',
    'Pega.com Request', 'Translation Request'
  ];
  const re = new RegExp('\\s*(' + labels.join('|') + '):\\s*', 'g');
  return plain.replace(re, '\n$1: ');
}

function extractTicketUrl(html, ticketIdToken, plain) {
  if (!ticketIdToken) return null;

  // 1. Any URL (in href or plain text) that contains the ticket id token.
  const urlRe = new RegExp('https?://[^\\s"\'<>)]*' + ticketIdToken + '[^\\s"\'<>)]*', 'i');
  let m = (html || '').match(urlRe) || (plain || '').match(urlRe);
  if (m) return decodeHtmlEntities(m[0]);

  // 2. Fallback: anchor whose visible text contains the ticket id.
  if (html) {
    const anchorRe = new RegExp('<a[^>]+href="([^"]+)"[^>]*>[^<]*' + ticketIdToken, 'i');
    m = html.match(anchorRe);
    if (m) return decodeHtmlEntities(m[1]);
  }
  return null;
}

function decodeHtmlEntities(s) {
  return s
    .replace(/&#(\d+);/g, function(_, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/&#x([0-9a-f]+);/gi, function(_, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&gt;/gi, '>')
    .replace(/&lt;/gi, '<')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function buildProject(p) {
  const roster = {};
  if (p.leadProducer) roster.Producer    = [p.leadProducer];
  if (p.requester)    roster.Stakeholder = [p.requester];

  const tasks = [];
  if (p.desiredDueDateRaw) {
    const iso = normalizeDate(p.desiredDueDateRaw);
    if (iso) tasks.push({
      id: Utilities.getUuid(),
      date: iso,
      taskName: 'Requested Due Date',
      isDueDate: true,
      milestoneType: 'milestone',
    });
  }

  const titlePart = p.name ? p.name : 'Untitled';
  const projectName = p.ticketId ? (p.ticketId + ' ' + titlePart) : titlePart;

  return {
    id: Utilities.getUuid(),
    name: projectName,
    parentId: null,
    tasks: tasks,
    roster: roster,
    dueDate: null,
    notes: [{
      id: Utilities.getUuid(),
      ts: Date.now(),
      kind: 'system',
      text: 'Imported from ' + p.ticketId,
    }],
    ticketId:         p.ticketId,
    ticketUrl:        p.ticketUrl || null,
    leadProducer:     p.leadProducer || null,
    function:         p.function || null,
    videoType:        p.videoType || null,
    targetAudience:   p.targetAudience || null,
    budget:           p.budget || null,
    synopsis:         p.synopsis || null,
    tangibleGoal1:    p.tangibleGoal1 || null,
    tangibleGoal2:    p.tangibleGoal2 || null,
    completionIssues: p.completionIssues || null,
    additionalNotes:  p.additionalNotes || null,
  };
}

function normalizeDate(raw) {
  // "5/29/26 12:01 PM" → "2026-05-29"
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  let mo = m[1], d = m[2], y = m[3];
  if (y.length === 2) y = '20' + y;
  return y + '-' + mo.padStart(2, '0') + '-' + d.padStart(2, '0');
}

function _projectsUrl() {
  return RTDB + '/prepro/state/projects.json?auth=' + encodeURIComponent(_auth());
}

function fetchProjects() {
  const resp = UrlFetchApp.fetch(_projectsUrl(), { muteHttpExceptions: true });
  const code = resp.getResponseCode();
  if (code !== 200) throw new Error('fetchProjects HTTP ' + code + ': ' + resp.getContentText());
  const body = resp.getContentText();
  if (!body || body === 'null') return [];
  const data = JSON.parse(body);
  return Array.isArray(data) ? data : Object.keys(data).map(k => data[k]);
}

function appendProject(project) {
  const current = fetchProjects() || [];
  current.push(project);
  const resp = UrlFetchApp.fetch(_projectsUrl(), {
    method: 'put',
    contentType: 'application/json',
    payload: JSON.stringify(current),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code !== 200) throw new Error('appendProject HTTP ' + code + ': ' + resp.getContentText());
}

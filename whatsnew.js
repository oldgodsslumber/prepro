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

// Shared auth + Firebase init for PRE-PRO.
// Imported by index/team/dash/ops as a module. Gates access behind Google sign-in
// with an admin-approval flow. Exposes window._fb after approval; resolves
// window._fbReady (a Promise) with the same handles for code that needs to
// wait for auth before subscribing to data.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getDatabase, ref, set, get, onValue, remove
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

const ADMIN_EMAIL = 'thatwalshguy@gmail.com';

const firebaseConfig = {
  apiKey:      'AIzaSyDYyEv6eospGbtmWt6orY6b4X71jhdUyKI',
  authDomain:  'prepro-e2abc.firebaseapp.com',
  databaseURL: 'https://prepro-e2abc-default-rtdb.firebaseio.com',
  projectId:   'prepro-e2abc',
  storageBucket: 'prepro-e2abc.appspot.com',
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getDatabase(app);

window._fbReady = new Promise(resolve => { window._fbReadyResolve = resolve; });

// ── Styles ──────────────────────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
#pp-auth-overlay { position: fixed; inset: 0; background: #0d0d12; color: #e0e0ec; z-index: 99999; display: flex; align-items: center; justify-content: center; font-family: system-ui, -apple-system, sans-serif; }
#pp-auth-overlay.hidden { display: none; }
.pp-auth-card { background: #16161e; border: 1px solid #2c2c3e; border-radius: 8px; padding: 32px 28px; width: 360px; max-width: 90vw; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,.5); }
.pp-auth-title { font-size: 18px; font-weight: 700; letter-spacing: .14em; margin-bottom: 4px; }
.pp-auth-sub { font-size: 12px; color: #8080a0; margin-bottom: 22px; }
.pp-auth-btn { display: inline-flex; align-items: center; gap: 10px; padding: 10px 18px; border-radius: 6px; background: #fff; color: #1f1f1f; font-size: 14px; font-weight: 500; cursor: pointer; border: none; }
.pp-auth-btn:hover { opacity: .92; }
.pp-auth-google-icon { width: 18px; height: 18px; }
.pp-auth-error { font-size: 12px; color: #e05555; margin-top: 14px; min-height: 16px; }
.pp-auth-user { display: flex; align-items: center; gap: 12px; padding: 12px; background: #1e1e28; border-radius: 6px; margin: 16px 0; text-align: left; }
.pp-auth-user img { width: 36px; height: 36px; border-radius: 50%; background: #2c2c3e; }
.pp-auth-user-info { flex: 1; min-width: 0; }
.pp-auth-user-name { font-size: 13px; font-weight: 600; }
.pp-auth-user-email { font-size: 11px; color: #8080a0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-auth-signout { font-size: 11px; color: #8080a0; background: none; border: none; cursor: pointer; text-decoration: underline; padding: 0; margin-top: 4px; font-family: inherit; }
.pp-auth-signout:hover { color: #e05555; }

#pp-admin-btn { position: fixed; bottom: 16px; right: 16px; background: #6c63ff; color: #fff; padding: 8px 14px; border-radius: 20px; font-size: 12px; font-weight: 600; cursor: pointer; border: none; box-shadow: 0 4px 12px rgba(0,0,0,.4); z-index: 9000; font-family: inherit; }
#pp-admin-btn:hover { opacity: .92; }
#pp-admin-btn .pp-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #e05555; margin-right: 6px; vertical-align: middle; }

#pp-admin-modal { position: fixed; inset: 0; background: rgba(0,0,0,.7); z-index: 9500; display: none; align-items: center; justify-content: center; font-family: system-ui, -apple-system, sans-serif; }
#pp-admin-modal.show { display: flex; }
.pp-admin-card { background: #16161e; border: 1px solid #2c2c3e; border-radius: 8px; width: 90%; max-width: 540px; max-height: 80vh; display: flex; flex-direction: column; color: #e0e0ec; }
.pp-admin-head { padding: 14px 18px; border-bottom: 1px solid #2c2c3e; display: flex; justify-content: space-between; align-items: center; }
.pp-admin-title { font-size: 13px; font-weight: 700; letter-spacing: .12em; }
.pp-admin-close { background: none; border: none; color: #8080a0; font-size: 22px; cursor: pointer; padding: 0; line-height: 1; }
.pp-admin-tabs { display: flex; padding: 0 18px; border-bottom: 1px solid #2c2c3e; background: #0d0d12; }
.pp-admin-tab { padding: 10px 14px; font-size: 12px; color: #8080a0; background: none; border: none; cursor: pointer; border-bottom: 2px solid transparent; font-family: inherit; }
.pp-admin-tab.active { color: #e0e0ec; border-bottom-color: #6c63ff; }
.pp-admin-list { flex: 1; overflow: auto; padding: 12px 18px; }
.pp-admin-empty { text-align: center; color: #8080a0; padding: 28px 0; font-size: 13px; }
.pp-admin-row { display: flex; align-items: center; gap: 12px; padding: 10px; background: #1e1e28; border-radius: 6px; margin-bottom: 8px; }
.pp-admin-row img { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; background: #2c2c3e; }
.pp-admin-row-info { flex: 1; min-width: 0; }
.pp-admin-row-name { font-size: 13px; font-weight: 600; }
.pp-admin-row-email { font-size: 11px; color: #8080a0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pp-admin-row-actions { display: flex; gap: 6px; flex-shrink: 0; }
.pp-admin-row-actions button { padding: 5px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer; border: none; font-family: inherit; }
.pp-admin-approve { background: #4cba6a; color: #fff; }
.pp-admin-deny    { background: #e05555; color: #fff; }
.pp-admin-revoke  { background: #2c2c3e; color: #e0e0ec; }
.pp-admin-self    { font-size: 11px; color: #8080a0; padding: 5px 10px; }
`;
document.head.appendChild(style);

// ── Overlay ────────────────────────────────────────────────────────────────
const overlay = document.createElement('div');
overlay.id = 'pp-auth-overlay';
overlay.innerHTML = `<div class="pp-auth-card" id="pp-auth-card">
  <div class="pp-auth-title">PRE-PRO</div>
  <div class="pp-auth-sub">Loading…</div>
</div>`;
function attachOverlay() {
  if (document.body) document.body.appendChild(overlay);
  else window.addEventListener('DOMContentLoaded', () => document.body.appendChild(overlay));
}
attachOverlay();

const card = () => overlay.querySelector('#pp-auth-card');

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderSignIn(errorMsg) {
  card().innerHTML = `
    <div class="pp-auth-title">PRE-PRO</div>
    <div class="pp-auth-sub">Sign in to continue</div>
    <button class="pp-auth-btn" id="pp-google-btn">
      <svg class="pp-auth-google-icon" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5h-1.9V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.3-.4-3.5z"/>
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.6 8.5 6.3 14.7z"/>
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.4 16.2 44 24 44z"/>
        <path fill="#1976D2" d="M43.6 20.5H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C41.4 36.4 44 30.6 44 24c0-1.3-.1-2.3-.4-3.5z"/>
      </svg>
      Sign in with Google
    </button>
    <div class="pp-auth-error">${escapeHtml(errorMsg || '')}</div>`;
  card().querySelector('#pp-google-btn').onclick = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
      renderSignIn(e.message || 'Sign-in failed');
    }
  };
}

function renderPending(user) {
  card().innerHTML = `
    <div class="pp-auth-title">Awaiting approval</div>
    <div class="pp-auth-sub">An admin will review your request shortly</div>
    <div class="pp-auth-user">
      <img src="${escapeHtml(user.photoURL)}" alt="" referrerpolicy="no-referrer">
      <div class="pp-auth-user-info">
        <div class="pp-auth-user-name">${escapeHtml(user.displayName)}</div>
        <div class="pp-auth-user-email">${escapeHtml(user.email)}</div>
      </div>
    </div>
    <button class="pp-auth-signout" id="pp-signout">Sign out</button>`;
  card().querySelector('#pp-signout').onclick = () => signOut(auth);
}

function showOverlay() { overlay.classList.remove('hidden'); }
function hideOverlay() { overlay.classList.add('hidden'); }

// ── Auth state machine ─────────────────────────────────────────────────────
let currentUser = null;
let isAdmin = false;
let resolved = false;

onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user) {
    isAdmin = false;
    showOverlay();
    renderSignIn();
    return;
  }
  isAdmin = (user.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();
  if (isAdmin) { grantAccess(user); return; }

  // Approved?
  let approved = false;
  try {
    const snap = await get(ref(db, `approvedUsers/${user.uid}`));
    approved = snap.exists();
  } catch (_) { /* fall through */ }

  if (approved) { grantAccess(user); return; }

  // Not approved → register pending request, show waiting screen
  try {
    await set(ref(db, `pendingUsers/${user.uid}`), {
      email: user.email || '',
      name:  user.displayName || '',
      photo: user.photoURL || '',
      requestedAt: Date.now()
    });
  } catch (_) { /* surface nothing — the waiting screen is the same UX either way */ }

  showOverlay();
  renderPending(user);
});

function grantAccess(user) {
  hideOverlay();
  window._fb = { db, ref, set, get, onValue };
  window._fbAuth = { user, isAdmin, signOut: () => signOut(auth) };
  if (!resolved) {
    resolved = true;
    if (window._fbReadyResolve) {
      window._fbReadyResolve({ db, ref, set, get, onValue, user, isAdmin });
      window._fbReadyResolve = null;
    }
  }
  window.dispatchEvent(new CustomEvent('prepro:auth-ready', {
    detail: { db, ref, set, get, onValue, user, isAdmin }
  }));
  if (isAdmin) setupAdminUI();
}

// ── Admin panel (only mounted for admin) ───────────────────────────────────
function setupAdminUI() {
  if (document.getElementById('pp-admin-btn')) return;

  const btn = document.createElement('button');
  btn.id = 'pp-admin-btn';
  btn.textContent = 'Admin';

  const modal = document.createElement('div');
  modal.id = 'pp-admin-modal';
  modal.innerHTML = `
    <div class="pp-admin-card">
      <div class="pp-admin-head">
        <div class="pp-admin-title">USER ACCESS</div>
        <button class="pp-admin-close" id="pp-admin-close" aria-label="Close">&times;</button>
      </div>
      <div class="pp-admin-tabs">
        <button class="pp-admin-tab active" data-tab="pending">Pending</button>
        <button class="pp-admin-tab" data-tab="approved">Approved</button>
      </div>
      <div class="pp-admin-list" id="pp-admin-list"></div>
    </div>`;

  function mount() {
    document.body.appendChild(btn);
    document.body.appendChild(modal);
  }
  if (document.body) mount(); else window.addEventListener('DOMContentLoaded', mount);

  btn.onclick = () => modal.classList.add('show');
  modal.querySelector('#pp-admin-close').onclick = () => modal.classList.remove('show');
  modal.onclick = e => { if (e.target === modal) modal.classList.remove('show'); };

  let activeTab = 'pending';
  let pendingData  = {};
  let approvedData = {};

  modal.querySelectorAll('.pp-admin-tab').forEach(t => {
    t.onclick = () => {
      modal.querySelectorAll('.pp-admin-tab').forEach(x => x.classList.toggle('active', x === t));
      activeTab = t.dataset.tab;
      renderList();
    };
  });

  function renderList() {
    const list = modal.querySelector('#pp-admin-list');
    const data = activeTab === 'pending' ? pendingData : approvedData;
    const entries = Object.entries(data || {});
    if (!entries.length) {
      list.innerHTML = `<div class="pp-admin-empty">${activeTab === 'pending' ? 'No pending requests' : 'No approved users yet'}</div>`;
      return;
    }
    list.innerHTML = entries.map(([uid, u]) => {
      const isSelf = currentUser && uid === currentUser.uid;
      const actions = activeTab === 'pending'
        ? `<button class="pp-admin-approve" data-uid="${uid}">Approve</button>
           <button class="pp-admin-deny" data-uid="${uid}">Deny</button>`
        : (isSelf
            ? `<span class="pp-admin-self">you</span>`
            : `<button class="pp-admin-revoke" data-uid="${uid}">Revoke</button>`);
      return `
        <div class="pp-admin-row">
          <img src="${escapeHtml(u.photo)}" alt="" referrerpolicy="no-referrer">
          <div class="pp-admin-row-info">
            <div class="pp-admin-row-name">${escapeHtml(u.name)}</div>
            <div class="pp-admin-row-email">${escapeHtml(u.email)}</div>
          </div>
          <div class="pp-admin-row-actions">${actions}</div>
        </div>`;
    }).join('');
    list.querySelectorAll('.pp-admin-approve').forEach(b => b.onclick = () => approveUser(b.dataset.uid));
    list.querySelectorAll('.pp-admin-deny').forEach(b => b.onclick = () => denyUser(b.dataset.uid));
    list.querySelectorAll('.pp-admin-revoke').forEach(b => b.onclick = () => revokeUser(b.dataset.uid));
  }

  async function approveUser(uid) {
    const u = pendingData[uid]; if (!u) return;
    await set(ref(db, `approvedUsers/${uid}`), {
      email: u.email || '', name: u.name || '', photo: u.photo || '',
      approvedAt: Date.now(), approvedBy: currentUser.email || ''
    });
    await remove(ref(db, `pendingUsers/${uid}`));
  }
  async function denyUser(uid) {
    await remove(ref(db, `pendingUsers/${uid}`));
  }
  async function revokeUser(uid) {
    if (!confirm('Revoke access for this user? They will need to be re-approved to use the app again.')) return;
    await remove(ref(db, `approvedUsers/${uid}`));
  }

  onValue(ref(db, 'pendingUsers'), snap => {
    pendingData = snap.val() || {};
    const count = Object.keys(pendingData).length;
    btn.innerHTML = count > 0 ? `<span class="pp-dot"></span>Admin (${count})` : 'Admin';
    if (activeTab === 'pending') renderList();
  });
  onValue(ref(db, 'approvedUsers'), snap => {
    approvedData = snap.val() || {};
    if (activeTab === 'approved') renderList();
  });
}

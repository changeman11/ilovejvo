// A live chat box: message list + send form, used by the global chat panel and the club chat.
// - Slurs are blocked before sending (and by the database rules).
// - Swearing is starred out when the reader's filter is on (default; toggled with setFilter()).
// - Admins see a ⚑ on messages with swearing and can delete any message.

import {
  onSnapshot, collection, query, orderBy, limit, doc, writeBatch, serverTimestamp, deleteDoc,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db, adminDatabase } from './firebase.js';
import { loadPeople } from './data.js';
import { checkText, censor } from './rules/profanity.js';
import { esc, avatarImg, fmtDay, fmtTime, urls } from './ui.js';

const FILTER_KEY = 'jvo.chatFilter';
export const filterOn = () => { try { return localStorage.getItem(FILTER_KEY) !== 'off'; } catch { return true; } };
export function setFilter(on) {
  try { localStorage.setItem(FILTER_KEY, on ? 'on' : 'off'); } catch { /* fine */ }
  document.dispatchEvent(new CustomEvent('jvo-chat-filter'));
}

const timeOf = (ms) => {
  if (!ms) return 'sending…';
  return new Date(ms).toDateString() === new Date().toDateString() ? fmtTime(ms) : `${fmtDay(ms)} ${fmtTime(ms)}`;
};

export function chatboxHtml({ placeholder = 'Say something', maxLength = 300, signInNote = '' } = {}) {
  return `
    <div class="chatbox">
      <div class="chat-log" data-chat-log aria-live="polite"><p class="muted small">Loading messages…</p></div>
      ${signInNote || `
      <form class="chat-form" data-form="chat" autocomplete="off">
        <textarea name="body" rows="1" maxlength="${maxLength}" placeholder="${esc(placeholder)}" aria-label="Message"></textarea>
        <button class="btn btn-primary btn-sm" type="submit">Send</button>
      </form>`}
      <p class="form-error" role="alert" hidden></p>
    </div>`;
}

// opts: {
//   path         collection, e.g. 'chat' or 'teams/<id>/chat'
//   user         signed-in player auth user (or null)
//   player       their profile (or null: read only)
//   adminUid     set when an admin is signed in (delete anything, see ⚑ flags)
//   canDelete    (message) => bool, extra delete rights (e.g. club manager)
//   rateLimit    true: also stamp chatLimits/{uid} (global chat rule)
//   show         how many recent messages (default 60)
//   onMessages   (messages) => {} after each update (for unread counts)
// }
// Returns a stop function.
export function mountChatbox(root, opts) {
  const log = root.querySelector('[data-chat-log]');
  const form = root.querySelector('form[data-form="chat"]');
  const err = root.querySelector('.form-error');
  let messages = [];
  let people = { playersById: {} };
  let first = true;
  loadPeople().then((p) => { people = p; draw(); }).catch(() => {});

  const say = (msg) => { if (!err) return; err.textContent = msg; err.hidden = !msg; };

  function draw() {
    if (!log) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    if (!messages.length) {
      log.innerHTML = '<p class="muted small">No messages yet. Say hi!</p>';
      return;
    }
    const filter = filterOn();
    log.innerHTML = messages.map((m) => {
      const p = people.playersById[m.authorPlayerId];
      const mine = opts.user && m.authorUid === opts.user.uid;
      const rude = checkText(m.body).level !== 'none';
      const canDelete = Boolean(mine || opts.adminUid || opts.canDelete?.(m));
      const body = filter ? censor(m.body) : m.body;
      return `
        <div class="chat-msg${mine ? ' mine' : ''}">
          ${mine ? '' : `<a href="${urls.player(m.authorPlayerId)}" data-link>${avatarImg(p ?? { displayName: '?' }, 'avatar')}</a>`}
          <div class="chat-bubble">
            <div class="chat-meta">${mine ? '' : `<a href="${urls.player(m.authorPlayerId)}" data-link><b>${esc(p?.displayName ?? 'Player')}</b></a>`}<span>${esc(timeOf(m.createdAt))}</span>
              ${rude && opts.adminUid ? '<span class="chat-flag" title="Contains swearing">⚑</span>' : ''}
              ${canDelete ? `<button class="link-btn" type="button" data-del-chat="${esc(m.id)}" aria-label="Delete message" title="Delete">×</button>` : ''}</div>
            <p>${esc(body).replace(/\n/g, '<br>')}</p>
          </div>
        </div>`;
    }).join('');
    if (atBottom || first) log.scrollTop = log.scrollHeight;
    first = false;
  }

  const q = query(collection(db, opts.path), orderBy('createdAt', 'desc'), limit(opts.show ?? 60));
  const stopListen = onSnapshot(q, (snap) => {
    messages = snap.docs
      .map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))
      .map((m) => ({ ...m, createdAt: m.createdAt?.toMillis?.() ?? null }))
      .reverse();
    if (messages.some((m) => !people.playersById[m.authorPlayerId])) {
      loadPeople({ fresh: true }).then((p) => { people = p; draw(); }).catch(() => {});
    }
    draw();
    opts.onMessages?.(messages);
  }, (e) => {
    console.warn('Chat:', e);
    if (log) log.innerHTML = '<p class="muted small">The chat couldn’t load. Refresh to try again.</p>';
  });
  const redrawOnFilter = () => draw();
  document.addEventListener('jvo-chat-filter', redrawOnFilter);

  async function send() {
    const body = form.body.value.trim();
    if (!body || !opts.player) return;
    if (checkText(body).level === 'severe') {
      say('That message has language that isn’t allowed here. Please keep it friendly.');
      return;
    }
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    say('');
    try {
      const batch = writeBatch(db);
      if (opts.rateLimit) batch.set(doc(db, `chatLimits/${opts.user.uid}`), { lastAt: serverTimestamp() });
      batch.set(doc(collection(db, opts.path)), { body, authorUid: opts.user.uid, authorPlayerId: opts.player.id, createdAt: serverTimestamp() });
      await batch.commit();
      form.body.value = '';
      log.scrollTop = log.scrollHeight;
    } catch (e) {
      console.error(e);
      say(e.code === 'permission-denied'
        ? (opts.rateLimit ? 'Slow down a little: one message every 3 seconds.' : 'That message couldn’t be sent.')
        : 'That didn’t send. Check your connection and try again.');
    } finally {
      button.disabled = false;
      form.body.focus();
    }
  }
  if (form) {
    form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
    form.body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
  }
  log?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del-chat]');
    if (!b || !window.confirm('Delete this message?')) return;
    const m = messages.find((x) => x.id === b.dataset.delChat);
    const mineOrManager = (opts.user && m?.authorUid === opts.user.uid) || opts.canDelete?.(m);
    try {
      await deleteDoc(doc(mineOrManager ? db : adminDatabase(), `${opts.path}/${b.dataset.delChat}`));
    } catch (e2) { console.error(e2); window.alert('That couldn’t be deleted.'); }
  });

  return () => {
    stopListen();
    document.removeEventListener('jvo-chat-filter', redrawOnFilter);
  };
}

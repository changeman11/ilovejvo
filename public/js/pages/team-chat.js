// Team chat in the Club hub: the squad's own chat box, live (new messages appear straight away).
// Stored in teams/{teamId}/chat; only squad members and admins can read it (firestore.rules inSquad).
// The writer and the manager can delete a message.

import { onSnapshot, collection, query, orderBy, limit } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from '../firebase.js';
import { sendChat, deleteChat, ensurePlayerLink } from '../player-data.js';
import { keepUntilPageChanges } from '../live.js';
import { esc, avatarImg, fmtDay, fmtTime, urls } from '../ui.js';

const SHOW = 80;

export function chatBlock(team) {
  return `
    <section class="team-chat" data-chat>
      <div class="section-head"><h2>${esc(team.name)} chat</h2><span class="muted small">Only your squad can see this</span></div>
      <div class="panel chat-panel">
        <div class="chat-log" data-chat-log aria-live="polite"><p class="muted small">Loading messages…</p></div>
        <form class="chat-form" data-form="chat" autocomplete="off">
          <textarea name="body" rows="1" maxlength="500" placeholder="Message your squad" aria-label="Message"></textarea>
          <button class="btn btn-primary btn-sm" type="submit">Send</button>
        </form>
        <p class="form-error" role="alert" hidden></p>
      </div>
    </section>`;
}

const timeOf = (ms) => {
  if (!ms) return 'sending…';
  const sameDay = new Date(ms).toDateString() === new Date().toDateString();
  return sameDay ? fmtTime(ms) : `${fmtDay(ms)} ${fmtTime(ms)}`;
};

// ctx: { user, player, team, isManager, playersById }
export function mountChat(el, ctx) {
  const box = el.querySelector('[data-chat]');
  if (!box) return;
  const log = box.querySelector('[data-chat-log]');
  const form = box.querySelector('form[data-form="chat"]');
  const err = box.querySelector('.form-error');
  let messages = [];

  const draw = () => {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    if (!messages.length) {
      log.innerHTML = '<p class="muted small">No messages yet. Say hi to your squad!</p>';
      return;
    }
    log.innerHTML = messages.map((m) => {
      const p = ctx.playersById[m.authorPlayerId];
      const mine = m.authorUid === ctx.user.uid;
      const canDelete = mine || ctx.isManager;
      return `
        <div class="chat-msg${mine ? ' mine' : ''}">
          ${mine ? '' : `<a href="${urls.player(m.authorPlayerId)}" data-link>${avatarImg(p ?? { displayName: '?' }, 'avatar')}</a>`}
          <div class="chat-bubble">
            <div class="chat-meta">${mine ? '' : `<b>${esc(p?.displayName ?? 'Player')}</b>`}<span>${esc(timeOf(m.createdAt))}</span>
              ${canDelete ? `<button class="link-btn" type="button" data-del-chat="${esc(m.id)}" aria-label="Delete message">×</button>` : ''}</div>
            <p>${esc(m.body).replace(/\n/g, '<br>')}</p>
          </div>
        </div>`;
    }).join('');
    if (atBottom || !draw.done) log.scrollTop = log.scrollHeight;
    draw.done = true;
  };

  const q = query(collection(db, `teams/${ctx.team.id}/chat`), orderBy('createdAt', 'desc'), limit(SHOW));
  let stopped = false;
  keepUntilPageChanges(() => { stopped = true; });
  // The rules recognise squad members through playerLinks/{uid}; make sure it exists first.
  ensurePlayerLink({ uid: ctx.user.uid, player: ctx.player }).catch((e) => console.warn('Chat link:', e)).then(() => {
    if (stopped) return;
    keepUntilPageChanges(listen());
  });
  const listen = () => onSnapshot(q, (snap) => {
    messages = snap.docs
      .map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))
      .map((m) => ({ ...m, createdAt: m.createdAt?.toMillis?.() ?? null }))
      .reverse();
    draw();
  }, (e) => {
    console.warn('Chat:', e);
    log.innerHTML = '<p class="muted small">The chat couldn’t load. Refresh to try again.</p>';
  });

  const send = async () => {
    const body = form.body.value.trim();
    if (!body) return;
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    err.hidden = true;
    try {
      await sendChat({ uid: ctx.user.uid, player: ctx.player, teamId: ctx.team.id, body });
      form.body.value = '';
      log.scrollTop = log.scrollHeight;
    } catch (e) {
      console.error(e);
      err.textContent = 'That didn’t send. Check your connection and try again.';
      err.hidden = false;
    } finally {
      button.disabled = false;
      form.body.focus();
    }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
  // Enter sends, Shift+Enter makes a new line.
  form.body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  log.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-del-chat]');
    if (!b || !window.confirm('Delete this message?')) return;
    try { await deleteChat({ teamId: ctx.team.id, messageId: b.dataset.delChat }); } catch (e2) { console.error(e2); }
  });
}

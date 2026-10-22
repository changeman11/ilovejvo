// The bell in the top bar: invites, join requests and their answers, and matches waiting for
// your result vote. Worked out from the same records the Club hub uses (nothing extra is stored).
// "Seen" is remembered on this device only: opening the bell clears the red count.

import { currentUser } from './auth.js';
import { loadMe, isApprovedTeam, loadAllBundles } from './data.js';
import { matchesToReport } from './pages/report.js';
import { esc, urls, fmtDay } from './ui.js';

const box = document.querySelector('[data-bell]');
const SEEN_KEY = 'jvo.notificationsSeenAt';
const RECENT = 14 * 24 * 3600 * 1000; // answers older than two weeks drop off
let cache = { at: 0, uid: null, items: [] };

const seenAt = () => { try { return Number(localStorage.getItem(SEEN_KEY) ?? 0); } catch { return 0; } };
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* fine */ } };

// [{ id, at, text (HTML), href }] newest first.
async function gather(uid) {
  const me = await loadMe(uid);
  if (!me.player) return [];
  const items = [];
  const now = Date.now();
  const team = (id) => esc(me.teamsById[id]?.name ?? 'a club');
  for (const o of me.offers) {
    if (o.status === 'pending') items.push({ id: `offer-${o.id}`, at: o.createdAt ?? o.updatedAt ?? 0, icon: '✉️', text: `<b>${team(o.teamId)}</b> invited you to their club`, href: '/club' });
  }
  for (const r of me.myJoinRequests ?? []) {
    if (['accepted', 'declined'].includes(r.status) && now - (r.updatedAt ?? 0) < RECENT) {
      items.push({ id: `jr-${r.id}-${r.status}`, at: r.updatedAt ?? 0, icon: r.status === 'accepted' ? '🎉' : '✋', text: `<b>${team(r.teamId)}</b> ${r.status === 'accepted' ? 'accepted you. Welcome to the club!' : 'declined your request to join'}`, href: r.status === 'accepted' ? '/club' : urls.team(r.teamId) });
    }
  }
  for (const r of me.teamJoinRequests ?? []) {
    if (r.status === 'pending') items.push({ id: `req-${r.id}`, at: r.createdAt ?? 0, icon: '🙋', text: `<b>${esc(me.playersById[r.playerId]?.displayName ?? 'A player')}</b> wants to join your club`, href: '/club?tab=requests' });
  }
  for (const l of me.leaves) {
    if (['approved', 'declined'].includes(l.status) && now - (l.updatedAt ?? 0) < RECENT) {
      items.push({ id: `leave-${l.id}-${l.status}`, at: l.updatedAt ?? 0, icon: '🚪', text: `Your request to leave was <b>${l.status}</b>`, href: '/club' });
    }
  }
  if (isApprovedTeam(me.team)) {
    const bundles = await loadAllBundles().catch(() => []);
    for (const { b, f } of matchesToReport(bundles, me.player).filter((x) => !x.voted)) {
      if (!f.scheduledAt || f.scheduledAt > now) continue; // only matches that should have been played
      items.push({ id: `vote-${b.event.id}-${f.id}`, at: f.scheduledAt, icon: '🏐', text: `Report the result: <b>${team(f.homeTeamId)}</b> v <b>${team(f.awayTeamId)}</b>`, href: urls.match(b.event.id, f.id) });
    }
  }
  return items.sort((x, y) => (y.at ?? 0) - (x.at ?? 0));
}

const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zM10 19a2 2 0 0 0 4 0"/></svg>';

function draw(items, open = false) {
  const unseen = items.filter((i) => (i.at ?? 0) > seenAt() || i.id.startsWith('offer') || i.id.startsWith('req')).length;
  box.hidden = false;
  box.innerHTML = `
    <button class="round-btn bell-btn" type="button" data-bell-toggle aria-expanded="${open}" aria-label="Notifications${unseen ? ` (${unseen} new)` : ''}" title="Notifications">
      ${BELL}${unseen && !open ? `<span class="bell-count">${unseen > 9 ? '9+' : unseen}</span>` : ''}
    </button>
    <div class="bell-panel" ${open ? '' : 'hidden'} role="dialog" aria-label="Notifications">
      <b class="bell-title">Notifications</b>
      ${items.length ? `<ul>${items.slice(0, 12).map((i) => `<li><a href="${esc(i.href)}" data-link><span class="bell-icon">${i.icon}</span><span>${i.text}${i.at ? `<small>${esc(fmtDay(i.at))}</small>` : ''}</span></a></li>`).join('')}</ul>`
        : '<p class="muted small">Nothing new. Invites and club news show up here.</p>'}
    </div>`;
}

// Refreshes the bell (cached for a minute so page changes stay cheap).
export async function updateBell({ force = false } = {}) {
  if (!box) return;
  const user = await currentUser().catch(() => null);
  if (!user) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  if (force || cache.uid !== user.uid || Date.now() - cache.at > 60000) {
    try {
      cache = { at: Date.now(), uid: user.uid, items: await gather(user.uid) };
    } catch (err) {
      console.warn('Notifications:', err);
      return;
    }
  }
  const open = box.querySelector('.bell-panel:not([hidden])') !== null;
  draw(cache.items, open);
}

if (box) {
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-bell-toggle]')) {
      const panel = box.querySelector('.bell-panel');
      const opening = panel.hidden;
      if (opening) markSeen();
      draw(cache.items, opening);
      return;
    }
    if (e.target.closest('a')) draw(cache.items, false);
  });
  document.addEventListener('click', (e) => {
    // composedPath: the clicked button may already have been redrawn (and detached) by the handler above
    if (!e.composedPath().includes(box) && box.querySelector('.bell-panel:not([hidden])')) draw(cache.items, false);
  });
}

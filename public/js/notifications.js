// The bell in the top bar: invites, join requests and their answers, and matches waiting for
// your result vote. Worked out from the same records the Club hub uses (nothing extra is stored).
// "Seen" is remembered on this device only: opening the bell clears the red count.

import { currentUser, currentAdmin } from './auth.js';
import { loadMe, isApprovedTeam, loadAllBundles, loadRequests } from './data.js';
import { tallyVotes } from './rules/votes.js';
import { flowOf, matchState, eventPhase } from './rules/flow.js';
import { checkText } from './rules/profanity.js';
import { getDocs, query, collection, orderBy, limit } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { matchesToReport } from './pages/report.js';
import { esc, urls, fmtDay, fmtTime } from './ui.js';
import { signupsOpen, lockTime } from './rules/autofix.js';

const box = document.querySelector('[data-bell]');
const SEEN_KEY = 'jvo.notificationsSeenAt';
const RECENT = 14 * 24 * 3600 * 1000; // answers older than two weeks drop off
let cache = { at: 0, key: null, items: [], admin: false, player: false };

const seenAt = () => { try { return Number(localStorage.getItem(SEEN_KEY) ?? 0); } catch { return 0; } };
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* fine */ } };

const DAY = 24 * 3600 * 1000;
const kind = (e) => (e.type === 'tournament' ? 'tournament' : 'exhibition night');
const at = (ms) => `${fmtDay(ms)} ${fmtTime(ms)}`;

// Tournament / exhibition reminders: new events, sign-ups to do (managers), sign-ups closing,
// fixtures set, and "starts soon" for events your club is in.
function eventReminders(bundles, me, now) {
  const out = [];
  const team = isApprovedTeam(me.team) ? me.team : null;
  const manager = team && team.managerUid === me.player.uid;
  for (const b of bundles) {
    const e = b.event;
    if (e.status !== 'upcoming') continue;
    const href = urls.event(e.id);
    const title = `<b>${esc(e.title)}</b>`;
    const inIt = team && b.plan.teamIds.includes(team.id);
    const open = signupsOpen(e, now);
    const closes = lockTime(e);

    if (manager && open && !inIt) {
      out.push({ id: `ev-signup-${e.id}`, at: e.createdAt ?? now, icon: '📝', text: `Sign ${esc(team.name)} up for ${title}${closes ? `<br>Closes ${esc(at(closes))}` : ''}`, href });
      if (closes && closes - now < DAY) {
        out.push({ id: `ev-closing-${e.id}`, at: closes - DAY, noDate: true, icon: '⏰', text: `Last chance: sign-ups for ${title} close ${esc(at(closes))}`, href });
      }
    } else if (!inIt && e.createdAt && now - e.createdAt < 7 * DAY) {
      out.push({ id: `ev-new-${e.id}`, at: e.createdAt, icon: '📣', text: `New ${kind(e)}: ${title}${e.date ? ` · ${esc(fmtDay(e.date))}` : ''}`, href });
    }
    if (inIt && e.fixturesLockedAt) {
      out.push({ id: `ev-fixtures-${e.id}`, at: e.fixturesLockedAt, icon: '📋', text: `Fixtures are set for ${title}`, href });
    }
    if (inIt && e.date && e.date > now && e.date - now < DAY) {
      out.push({ id: `ev-soon-${e.id}`, at: e.date - DAY, noDate: true, icon: '🏐', text: `${title} starts ${e.timeTbd ? esc(fmtDay(e.date)) : esc(at(e.date))}. Good luck!`, href });
    }
  }
  return out;
}

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
    if (r.status === 'pending') items.push({ id: `req-${r.id}`, at: r.createdAt ?? 0, icon: '🙋', text: `<b>${esc(me.playersById[r.playerId]?.displayName ?? 'A player')}</b> wants to join your club`, href: '/club?tab=manager#mgr-requests' });
  }
  for (const l of me.leaves) {
    if (['approved', 'declined'].includes(l.status) && now - (l.updatedAt ?? 0) < RECENT) {
      items.push({ id: `leave-${l.id}-${l.status}`, at: l.updatedAt ?? 0, icon: '🚪', text: `Your request to leave was <b>${l.status}</b>`, href: '/club' });
    }
  }
  const bundles = await loadAllBundles().catch(() => []);
  items.push(...eventReminders(bundles, me, now));
  if (isApprovedTeam(me.team)) {
    for (const { b, f } of matchesToReport(bundles, me.player).filter((x) => !x.voted)) {
      if (!f.scheduledAt || f.scheduledAt > now) continue; // only matches that should have been played
      items.push({ id: `vote-${b.event.id}-${f.id}`, at: f.scheduledAt, icon: '🏐', text: `Report the result: <b>${team(f.homeTeamId)}</b> v <b>${team(f.awayTeamId)}</b>`, href: urls.match(b.event.id, f.id) });
    }
  }
  return items.sort((x, y) => (y.at ?? 0) - (x.at ?? 0));
}

const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zM10 19a2 2 0 0 0 4 0"/></svg>';

// ---------- Admin to-dos (shown while the admin login is signed in on this device) ----------
// Approvals and checks waiting on an admin. They stay counted in red until they're dealt with.
async function gatherAdmin() {
  const [r, bundles] = await Promise.all([loadRequests(), loadAllBundles({ includeDrafts: true })]);
  const out = [];
  const now = Date.now();
  const inbox = '/admin/requests';
  for (const t of r.pendingTeams) {
    out.push({ id: `a-team-${t.id}`, at: t.updatedAt ?? 0, icon: '🛡️', text: `New club to approve: <b>${esc(t.name)}</b>`, href: inbox });
  }
  for (const c of r.claims) {
    out.push({ id: `a-claim-${c.id}`, at: c.createdAt ?? 0, icon: '🔗', text: `<b>${esc(c.discordName ?? 'Someone')}</b> wants to claim <b>${esc(r.playersById[c.playerId]?.displayName ?? c.playerId)}</b>`, href: inbox });
  }
  for (const l of r.leaves) {
    out.push({ id: `a-leave-${l.id}`, at: l.createdAt ?? 0, icon: '🚪', text: `<b>${esc(r.playersById[l.playerId]?.displayName ?? 'A player')}</b> wants to leave <b>${esc(r.teamsById[l.teamId]?.name ?? 'their club')}</b>`, href: inbox });
  }
  for (const b of bundles) {
    const name = (id) => esc(b.teamsById[id]?.name ?? 'TBC');
    for (const f of b.fixtures) {
      if (f.virtual) continue;
      const res = b.results[f.id];
      const match = `<b>${name(f.homeTeamId)}</b> v <b>${name(f.awayTeamId)}</b>`;
      if (res?.statsStatus === 'pending') {
        out.push({ id: `a-stats-${b.event.id}-${f.id}`, at: res.updatedAt ?? 0, icon: '📸', text: `Stats to check: ${match}`, href: urls.adminResult(b.event.id, f.id) });
      } else if (!res && flowOf(b.event)) {
        // Match flow: admins are pinged once a match has been stuck for a while (rules/flow.js).
        const st = matchState(b, f, now);
        const why = { disputed: 'the scores don’t match', waiting: 'only one team has reported', 'no-votes': 'nobody has reported' }[st.stuck];
        if (why) out.push({ id: `a-stuck-${b.event.id}-${f.id}-${st.stuck}`, at: now, icon: '⚠️', text: `Stuck match (${why}): ${match}`, href: urls.adminResult(b.event.id, f.id) });
      } else if (!res) {
        const tally = tallyVotes((b.submissions ?? []).filter((s) => s.fixtureId === f.id), f);
        if (tally.status === 'disputed') {
          out.push({ id: `a-dispute-${b.event.id}-${f.id}`, at: now, icon: '⚖️', text: `Teams disagree on the score: ${match}`, href: urls.adminResult(b.event.id, f.id) });
        } else if (f.scheduledAt && !f.timeTbd && now - f.scheduledAt > 3 * 3600 * 1000 && f.homeTeamId && f.awayTeamId) {
          out.push({ id: `a-missing-${b.event.id}-${f.id}`, at: f.scheduledAt, icon: '⏳', text: `No result yet: ${match}`, href: urls.adminResult(b.event.id, f.id) });
        }
      }
    }
    // A break that waits for an admin to open the finals.
    const phase = eventPhase(b, now);
    if (phase.phase === 'break' && !phase.breakEndsAt) {
      out.push({ id: `a-finals-${b.event.id}`, at: now, icon: '🏆', text: `<b>${esc(b.event.title)}</b>: the group stage is done. Open the finals when you're ready`, href: urls.adminEvent(b.event.id, 'fixtures') });
    }
    // An event starting within a day whose fixtures will need an admin online to lock them.
    const e = b.event;
    if (e.status === 'upcoming' && e.autoFixtures && e.autoFixtures !== 'off' && !e.fixturesLockedAt && e.date && e.date > now && e.date - now < DAY) {
      out.push({ id: `a-lock-${e.id}`, at: e.date - DAY, noDate: true, icon: '🔒', text: `<b>${esc(e.title)}</b> starts ${esc(at(e.date))}: be signed in around then so the fixtures lock and save`, href: urls.adminEvent(e.id, 'fixtures') });
    }
  }
  // Global chat messages from the last day with swearing in them (slurs are already blocked).
  try {
    const snap = await getDocs(query(collection(db, 'chat'), orderBy('createdAt', 'desc'), limit(150)));
    const rude = snap.docs.map((d) => d.data())
      .filter((m) => (m.createdAt?.toMillis?.() ?? 0) > now - DAY && checkText(m.body).level !== 'none');
    if (rude.length) {
      out.push({ id: 'a-chat', at: rude[0].createdAt.toMillis(), icon: '🗯️', text: `<b>${rude.length}</b> chat message${rude.length === 1 ? '' : 's'} with swearing today (marked ⚑ in the chat)`, openChat: true });
    }
  } catch (err) { console.warn('Chat check:', err); }
  return out.map((i) => ({ ...i, admin: true })).sort((x, y) => (y.at ?? 0) - (x.at ?? 0));
}

const itemHtml = (i) => (i.openChat ? `<li><a href="#" data-open-chat><span class="bell-icon">${i.icon}</span><span>${i.text}</span></a></li>` : `<li><a href="${esc(i.href)}" data-link><span class="bell-icon">${i.icon}</span><span>${i.text}${i.at && !i.noDate ? `<small>${esc(fmtDay(i.at))}</small>` : ''}</span></a></li>`);

function draw(items, open = false) {
  const mine = items.filter((i) => !i.admin);
  const adminItems = items.filter((i) => i.admin);
  // Admin to-dos and invites/requests stay counted until they're dealt with; the rest until you open the bell.
  const unseen = items.filter((i) => i.admin || (i.at ?? 0) > seenAt() || i.id.startsWith('offer') || i.id.startsWith('req')).length;
  box.hidden = false;
  box.innerHTML = `
    <button class="round-btn bell-btn" type="button" data-bell-toggle aria-expanded="${open}" aria-label="Notifications${unseen ? ` (${unseen} new)` : ''}" title="Notifications">
      ${BELL}${unseen && !open ? `<span class="bell-count">${unseen > 9 ? '9+' : unseen}</span>` : ''}
    </button>
    <div class="bell-panel" ${open ? '' : 'hidden'} role="dialog" aria-label="Notifications">
      ${cache.admin ? `
        <b class="bell-title">Admin to-do${adminItems.length ? ` <span class="bell-tag">${adminItems.length}</span>` : ''}</b>
        ${adminItems.length ? `<ul>${adminItems.slice(0, 10).map(itemHtml).join('')}</ul>${adminItems.length > 10 ? '<p class="small"><a href="/admin/requests" data-link>See everything in the admin inbox</a></p>' : ''}`
          : '<p class="muted small">All caught up. Approvals and results to check show up here.</p>'}` : ''}
      ${cache.player ? `
        <b class="bell-title">Notifications</b>
        ${mine.length ? `<ul>${mine.slice(0, 12).map(itemHtml).join('')}</ul>`
          : '<p class="muted small">Nothing new. Invites and club news show up here.</p>'}` : ''}
    </div>`;
}

// Refreshes the bell (cached for a minute so page changes stay cheap).
// Shows for players (Discord sign-in), admins (admin login), or both on the same device.
export async function updateBell({ force = false } = {}) {
  if (!box) return;
  const [user, adminState] = await Promise.all([currentUser().catch(() => null), currentAdmin().catch(() => null)]);
  const adminUid = adminState?.admin ? adminState.user.uid : null;
  if (!user && !adminUid) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const key = `${user?.uid ?? ''}|${adminUid ?? ''}`;
  if (force || cache.key !== key || Date.now() - cache.at > 60000) {
    try {
      const [items, adminItems] = await Promise.all([
        user ? gather(user.uid) : [],
        adminUid ? gatherAdmin().catch((err) => { console.warn('Admin notifications:', err); return []; }) : [],
      ]);
      cache = { at: Date.now(), key, items: [...adminItems, ...items], admin: Boolean(adminUid), player: Boolean(user) };
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

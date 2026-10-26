// Check-in (rules/flow.js, event.flow.readyUp; changed 2026-10-26 from a ready-up before every
// match): each player checks in ONCE for the event, on the event page or any of their match
// pages. A match opens when enough of each team have checked in. Staff (admins) can check a player
// in for them, and start a single match without waiting.
//
// checkinPanel(b, { fixture, st }) draws it: with a fixture (match page, still waiting) only that
// match's two teams; without (event page) every team in the event.

import { currentUser, currentAdmin } from '../auth.js';
import { esc, teamDot, playerLink } from '../ui.js';
import { checkIn, checkOut } from '../player-data.js';
import { startMatchNow, staffCheckIn, staffCheckOut } from '../admin-data.js';
import { readyNeeded, checkedIn } from '../rules/flow.js';
import { refresh } from '../nav.js';

let ctx = null; // { b, f, user, player, playerTeamId, mine, adminUid, adminName }

// Is check-in in use for this event (and still useful)?
export const checkinOn = (e) => e?.flow?.readyUp === true && e.flow?.on !== false && !['finished', 'cancelled'].includes(e.status);

// A team's players for this event: its squad (club members) and its event roster (mix teams).
function squadOf(b, teamId) {
  const roster = new Set(b.rosters?.[teamId]?.playerIds ?? []);
  return Object.values(b.playersById).filter((p) => p.teamId === teamId || roster.has(p.id))
    .sort((x, y) => x.displayName.localeCompare(y.displayName));
}
// Which of this event's teams a player plays for.
const teamOfPlayer = (b, player, teamIds) => teamIds.find((t) => player.teamId === t || (b.rosters?.[t]?.playerIds ?? []).includes(player.id)) ?? null;

export async function checkinPanel(b, { fixture = null, st = null } = {}) {
  ctx = null;
  if (!checkinOn(b.event)) return '';
  const teamIds = fixture ? [fixture.homeTeamId, fixture.awayTeamId].filter(Boolean) : b.teams.map((t) => t.id);
  if (!teamIds.length) return '';
  const user = await currentUser().catch(() => null);
  const me = user ? Object.values(b.playersById).find((p) => p.uid === user.uid) ?? null : null;
  const myTeam = me ? teamOfPlayer(b, me, fixture ? teamIds : b.teams.map((t) => t.id)) : null;
  const { user: adminUser, admin } = await currentAdmin().catch(() => ({}));
  const mine = me ? (b.checkins ?? []).find((c) => c.id === me.id || c.playerId === me.id) ?? null : null;
  ctx = { b, f: fixture, user, player: myTeam ? me : null, playerTeamId: myTeam, mine, adminUid: admin ? adminUser.uid : null, adminName: admin?.name ?? null };
  const need = readyNeeded(b.event);
  const byId = new Map((b.checkins ?? []).map((c) => [c.playerId, c]));

  const teamCard = (teamId) => {
    const team = b.teamsById[teamId];
    const ins = checkedIn(b, teamId);
    const squad = squadOf(b, teamId);
    // Admins see the whole squad with a button each; everyone else sees who's checked in.
    const rows = ctx.adminUid
      ? squad.map((p) => {
        const c = byId.get(p.id);
        return `<li>${c ? '✅' : '⏳'} ${playerLink(p, p.id)}${c?.by === 'staff' ? ' <span class="muted small">(by staff)</span>' : ''}
          ${c ? `<button class="link-btn small" type="button" data-ci="staff-out" data-player="${esc(p.id)}">undo</button>`
            : `<button class="btn btn-sm" type="button" data-ci="staff-in" data-player="${esc(p.id)}" data-team="${esc(teamId)}">Check in for them</button>`}</li>`;
      }).join('')
      : ins.map((c) => `<li>✅ ${playerLink(b.playersById[c.playerId], c.playerId)}</li>`).join('');
    return `
      <div class="ru-side">
        <b>${teamDot(team)} ${esc(team?.name ?? 'TBC')}</b>
        <span class="ru-count num${ins.length >= need ? ' full' : ''}">${Math.min(ins.length, need)}/${need}</span>
        <ul>${rows || '<li class="muted small">Nobody yet</li>'}</ul>
      </div>`;
  };

  const action = ctx.player
    ? (mine
      ? `<span class="small"><b>✓ You’re checked in${mine.by === 'staff' ? ' (by staff)' : ''}</b> for the whole event: no need to do it again before each match.</span>
         <button class="link-btn small" type="button" data-ci="out">Undo</button>`
      : '<button class="btn btn-primary" type="button" data-ci="in">✋ Check in for this event</button> <span class="muted small">Once is enough: it counts for every match.</span>')
    : (user ? '' : '<span class="small"><button class="btn btn-sm" type="button" data-discord-signin>Sign in with Discord</button> to check in.</span>');

  return `
    <section class="panel ready-up" data-checkin-panel>
      <h2 class="pro-h">✋ Check in${fixture ? '' : ' for the event'}</h2>
      <p class="small" style="margin-top:0">${fixture
        ? `This match starts once <b>${need} player${need === 1 ? '' : 's'} from each team</b> have checked in for the event. Then score reporting opens and the match thread starts on Discord.`
        : `Every player checks in <b>once</b>, before or during the event. A team’s matches start when ${need} of its players have checked in.`}
        ${ctx.adminUid ? ' <b>Staff:</b> check in anyone who can’t do it themselves.' : ''}</p>
      <div class="ru-sides">${teamIds.map(teamCard).join('')}</div>
      <div class="actions" style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        ${action}
        ${ctx.adminUid && fixture && st?.state === 'ready' ? '<button class="btn btn-sm" type="button" data-ci="start">Admin: start this match now</button>' : ''}
      </div>
      <p class="form-error" role="alert" hidden></p>
    </section>`;
}

// Kept for the match page (it calls readyPanel while a match waits for check-ins).
export const readyPanel = (b, f, st) => checkinPanel(b, { fixture: f, st });

export function mountReady(root) {
  const panel = root.querySelector('[data-checkin-panel]');
  if (!panel || !ctx) return;
  panel.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-ci]');
    if (!btn) return;
    const { b, f, user, player, mine, adminUid, adminName } = ctx;
    const error = panel.querySelector('.form-error');
    const act = btn.dataset.ci;
    btn.disabled = true;
    try {
      if (act === 'in') await checkIn({ uid: user.uid, eventId: b.event.id, player });
      if (act === 'out') {
        if (!window.confirm('Undo your check-in? Your team’s matches may wait until enough players check in again.')) { btn.disabled = false; return; }
        if (mine.by === 'staff') await staffCheckOut({ uid: adminUid ?? user.uid, eventId: b.event.id, checkin: mine }).catch(() => checkOut({ eventId: b.event.id, checkin: mine }));
        else await checkOut({ eventId: b.event.id, checkin: mine });
      }
      if (act === 'staff-in') {
        const p = b.playersById[btn.dataset.player];
        await staffCheckIn({ uid: adminUid, eventId: b.event.id, player: p, teamId: btn.dataset.team, staffName: adminName });
      }
      if (act === 'staff-out') {
        const c = (b.checkins ?? []).find((x) => x.playerId === btn.dataset.player);
        if (c) await staffCheckOut({ uid: adminUid, eventId: b.event.id, checkin: c });
      }
      if (act === 'start') {
        if (!window.confirm('Start this match now, without waiting for check-ins?')) { btn.disabled = false; return; }
        await startMatchNow({ uid: adminUid, eventId: b.event.id, fixture: f });
      }
      refresh();
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      error.textContent = err.code === 'permission-denied'
        ? 'That couldn’t be saved: you may not be on a team in this event any more. Refresh and try again.'
        : 'Something went wrong. Check your connection and try again.';
      error.hidden = false;
    }
  });
}

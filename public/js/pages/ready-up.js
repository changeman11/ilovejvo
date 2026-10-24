// Ready-up on the match page (rules/flow.js, event.flow.readyUp): before a match opens, players
// from both teams press Ready here. When enough from each side are ready, it opens (reporting, and
// the bot starts the Discord thread). Admins can start it without waiting.

import { currentUser, currentAdmin } from '../auth.js';
import { esc, teamDot, playerLink } from '../ui.js';
import { readyUp, unReady } from '../player-data.js';
import { startMatchNow } from '../admin-data.js';
import { refresh } from '../nav.js';

let ctx = null; // { b, f, user, player, mine, adminUid }

export async function readyPanel(b, f, st) {
  ctx = null;
  const user = await currentUser().catch(() => null);
  const player = user ? Object.values(b.playersById).find((p) => p.uid === user.uid) : null;
  const plays = player && (player.teamId === f.homeTeamId || player.teamId === f.awayTeamId);
  const { user: adminUser, admin } = await currentAdmin().catch(() => ({}));
  const mine = plays ? (b.ready ?? []).find((r) => r.id === `${f.id}__${player.id}`) ?? null : null;
  ctx = { b, f, user, player: plays ? player : null, mine, adminUid: admin ? adminUser.uid : null };

  const side = (teamId, list) => `
    <div class="ru-side">
      <b>${teamDot(b.teamsById[teamId])} ${esc(b.teamsById[teamId]?.name ?? 'TBC')}</b>
      <span class="ru-count num${list.length >= st.need ? ' full' : ''}">${Math.min(list.length, st.need)}/${st.need}</span>
      <ul>${list.map((r) => `<li>✅ ${playerLink(b.playersById[r.playerId], r.playerId)}</li>`).join('') || '<li class="muted small">Nobody yet</li>'}</ul>
    </div>`;
  return `
    <section class="panel ready-up" data-ready-panel>
      <h2 class="pro-h">✋ Ready up</h2>
      <p class="small" style="margin-top:0">This match starts when <b>${st.need} player${st.need === 1 ? '' : 's'} from each team</b> have pressed Ready here. Then score reporting opens and the match thread starts on Discord.</p>
      <div class="ru-sides">${side(f.homeTeamId, st.home)}${side(f.awayTeamId, st.away)}</div>
      <div class="actions" style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        ${ctx.player ? (mine
          ? '<span class="small"><b>You’re ready.</b></span><button class="btn btn-sm" type="button" data-ready="off">Not ready any more</button>'
          : '<button class="btn btn-primary" type="button" data-ready="on">✋ I’m ready</button>') : ''}
        ${ctx.adminUid ? '<button class="btn btn-sm" type="button" data-ready="start">Admin: start now</button>' : ''}
      </div>
      <p class="form-error" role="alert" hidden></p>
    </section>`;
}

export function mountReady(root) {
  const panel = root.querySelector('[data-ready-panel]');
  if (!panel || !ctx) return;
  panel.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-ready]');
    if (!btn) return;
    const { b, f, user, player, mine, adminUid } = ctx;
    const error = panel.querySelector('.form-error');
    btn.disabled = true;
    try {
      if (btn.dataset.ready === 'on') await readyUp({ uid: user.uid, eventId: b.event.id, fixtureId: f.id, player });
      if (btn.dataset.ready === 'off') await unReady({ eventId: b.event.id, ready: mine });
      if (btn.dataset.ready === 'start') {
        if (!window.confirm('Start this match now, without waiting for everyone to ready up?')) { btn.disabled = false; return; }
        await startMatchNow({ uid: adminUid, eventId: b.event.id, fixture: f });
      }
      refresh();
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      error.textContent = err.code === 'permission-denied'
        ? 'That couldn’t be saved: the match may already have a score, or you’re not on either team. Refresh and try again.'
        : 'Something went wrong. Check your connection and try again.';
      error.hidden = false;
    }
  });
}

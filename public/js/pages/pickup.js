// Pickup games: /pickup. Random 2v2-6v6 games run by the Discord bot (bot/, BOT-SETUP.md).
// - The live queue (pickupMeta/live, written by the bot): who's signed up, ready checks, drafts,
//   games on. Players signed in with Discord sign up / withdraw here (pickupSignups/{discordId});
//   the bot picks that up straight away, the same as the menu on Discord.
// - The Elo leaderboard (pickupRatings) and recent games (pickupGames).
// The page redraws itself when the live state or your sign-up changes.

import { onSnapshot, doc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from '../firebase.js';
import { loadPickupLive, loadPickupRatings, loadPickupGames, loadPickupSignup, loadPlayers, invalidate } from '../data.js';
import { pickupSignUp, pickupWithdraw } from '../player-data.js';
import { currentUser, discordOf } from '../auth.js';
import { esc, skeleton, pageTitle, urls } from '../ui.js';
import { discordInviteUrl } from '../config.js';
import { keepUntilPageChanges } from '../live.js';
import { refreshQuietly } from '../nav.js';

export const title = 'Pickup';

export function loading() {
  return skeleton([90, 260, 400]);
}

const OFFLINE_AFTER = 12 * 60 * 1000; // the bot re-sends its state every 5 minutes
const mode = (n) => `${n}v${n}`;

function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

// A Discord user's name, linked to their site profile when they have one.
function nameOf(id, fallback, byDiscord) {
  const p = byDiscord.get(String(id));
  return p ? `<a class="plink" href="${urls.player(p.id)}" data-link>${esc(p.displayName)}</a>` : esc(fallback ?? 'Player');
}

const form = (f) => (f ? String(f).split('').map((r) => `<span class="res ${r}">${r}</span>`).join(' ') : '<span class="muted">–</span>');

// Pickup rating card for profile pages. rank: loadPickupRank() result, or null.
export function pickupBlock(rank) {
  if (!rank) return '';
  const r = rank.rating;
  return `
    <div class="pk-mini">
      <a class="pk-elo" href="/pickup" data-link title="Pickup Elo"><b>${r.rating}</b><small>pickup elo</small></a>
      <div class="pk-mini-text">
        <div><b>#${rank.rank}</b> <span class="muted">of ${rank.total}</span></div>
        <div class="small">${r.wins} W · ${r.losses} L</div>
        <div class="pk-form">${form(r.form)}</div>
      </div>
    </div>`;
}

function liveBlock(live, me) {
  const online = live?.updatedAt && Date.now() - live.updatedAt < OFFLINE_AFTER;
  const queue = live?.queue ?? [];
  const matches = live?.matches ?? [];
  const games = live?.games ?? [];
  const modes = live?.modes ?? [2, 3, 4, 5, 6];
  const need = Math.max(0, Math.min(...modes) * 2 - queue.length);
  const readySeconds = live?.readySeconds ?? 60;

  let status;
  if (!online) status = '<p class="pk-status off"><span class="pk-dot off"></span>The pickup bot is offline right now. Sign-ups are kept for when it’s back.</p>';
  else if (live.countdownEndsAt && live.countdownEndsAt > Date.now()) status = `<p class="pk-status"><span class="live-dot"></span><b>${queue.length}</b> signed up · starting in <b data-countdown="${live.countdownEndsAt}">…</b></p>`;
  else status = `<p class="pk-status"><span class="live-dot"></span><b>${queue.length}</b> signed up${need ? ` · need <b>${need}</b> more to start` : ''}</p>`;

  // Your sign-up.
  const inMatch = me && matches.find((m) => m.players.some((p) => p.id === me.discordId));
  const myPlace = me ? queue.findIndex((p) => p.id === me.discordId) + 1 : 0;
  let action;
  if (!me) {
    action = '<button class="btn btn-primary" type="button" data-discord-signin>Sign in with Discord to play</button>';
  } else if (inMatch) {
    action = `<div class="pk-alert">🏐 <b>You’re in a ${mode(inMatch.size)}!</b> ${inMatch.phase === 'check'
      ? `Join your locked <b>ready up</b> voice channel on Discord now, before the time runs out.`
      : 'The captains are drafting in #pickup on Discord.'}</div>`;
  } else if (me.signedUp || myPlace) {
    action = `<p class="pk-you">✅ You’re signed up${myPlace ? `, <b>#${myPlace}</b> in the queue` : ''}.</p>
      <button class="btn" type="button" data-pickup="leave">Withdraw</button>`;
  } else {
    action = '<button class="btn btn-primary" type="button" data-pickup="join">Sign up</button>';
  }

  const list = queue.length
    ? `<ol class="pk-queue">${queue.map((p) => `<li${me && p.id === me.discordId ? ' class="me"' : ''}>${esc(p.name)}${p.from === 'site' ? ' <span class="pk-src" title="Signed up on the website">web</span>' : ''}</li>`).join('')}</ol>`
    : '<p class="muted">Nobody yet. Be the first!</p>';

  const matchHtml = matches.map((m) => {
    if (m.phase === 'check') {
      const ready = m.players.filter((p) => p.ready).length;
      return `<div class="pk-match"><b>${mode(m.size)} ready check</b> <span class="muted">${ready}/${m.players.length} in the voice channel</span>
        <p class="small">${m.players.map((p) => `${p.ready ? '✅' : '⏳'} ${esc(p.name)}`).join(' &nbsp; ')}</p></div>`;
    }
    return `<div class="pk-match"><b>${mode(m.size)} draft</b> <span class="muted">captains picking</span>
      <p class="small">${esc((m.teams?.a ?? []).join(', '))} <b>vs</b> ${esc((m.teams?.b ?? []).join(', '))}</p></div>`;
  }).join('');
  const gameHtml = games.map((g) => `<div class="pk-match"><b>Game #${g.number}</b> <span class="muted">${mode(g.size)}${g.status === 'disputed' ? ' · waiting for an admin' : ' · playing'}</span>
    <p class="small">${esc(g.a.join(', '))} <b>vs</b> ${esc(g.b.join(', '))}</p></div>`).join('');

  return `
    <section class="panel pk-live">
      <div class="pk-live-head">
        <div>
          <h2>Queue</h2>
          ${status}
        </div>
        <div class="pk-action">${action}</div>
      </div>
      ${list}
      ${matchHtml || gameHtml ? `<h3 class="pk-sub">Right now</h3>${matchHtml}${gameHtml}` : ''}
      <p class="muted small pk-how">Each game is a random mode (${modes.map(mode).join(', ')}) that fits how many are signed up.
        When the queue pops you’re pinged on Discord and have ${readySeconds} seconds to join the locked <b>ready up</b> voice channel,
        so you need to be in the ${discordInviteUrl ? `<a href="${esc(discordInviteUrl)}" target="_blank" rel="noopener">JVO Discord</a>` : 'JVO Discord'}.</p>
    </section>`;
}

function leaderboard(ratings, byDiscord, me) {
  if (!ratings.length) return '<p class="muted">No games played yet.</p>';
  return `<div class="table-wrap"><table class="data">
    <thead><tr><th class="first">Player</th><th>Elo</th><th>W</th><th>L</th><th>Games</th><th>Last 5</th></tr></thead>
    <tbody>${ratings.slice(0, 50).map((r, i) => `<tr${me && r.id === me.discordId ? ' class="me-row"' : ''}>
      <td class="first"><span class="rank">${i + 1}</span> ${nameOf(r.id, r.name, byDiscord)}</td>
      <td class="strong">${r.rating}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.games}</td>
      <td class="pk-form">${form(r.form)}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

function gameRow(g, byDiscord) {
  const team = (side) => {
    const t = g.teams?.[side];
    if (!t) return '';
    const won = g.winner === side;
    const players = t.players.filter((p) => !p.fake).map((p) => {
      const c = g.changes?.[p.id];
      const delta = g.status === 'done' && c ? ` <span class="pk-delta ${c.delta >= 0 ? 'up' : 'down'}">${c.delta > 0 ? '+' : ''}${c.delta}</span>` : '';
      return `${p.id === t.captain ? '👑 ' : ''}${nameOf(p.id, p.name, byDiscord)}${delta}`;
    }).join(', ');
    return `<div class="pk-side${won ? ' won' : ''}">${won ? '🏆 ' : ''}${players}</div>`;
  };
  const tag = g.status === 'done' ? '' : g.status === 'cancelled' ? '<span class="tag tag-cancelled">cancelled</span>'
    : g.status === 'disputed' ? '<span class="tag tag-draft">disputed</span>' : '<span class="tag tag-live">playing</span>';
  return `<div class="pk-game">
    <div class="pk-game-head"><b>#${g.number}</b> <span class="muted">${mode(g.size)} · ${g.createdAt ? ago(g.createdAt) : ''}</span> ${tag}</div>
    ${team('a')}<div class="pk-vs">vs</div>${team('b')}
  </div>`;
}

export async function render() {
  const user = await currentUser();
  const discord = user ? await discordOf(user) : null;
  const [live, ratings, games, players, signup] = await Promise.all([
    loadPickupLive(),
    loadPickupRatings({ fresh: true }).catch(() => []),
    loadPickupGames().catch(() => []),
    loadPlayers(),
    discord ? loadPickupSignup(discord.discordId) : null,
  ]);
  const byDiscord = new Map(players.filter((p) => p.discordId).map((p) => [String(p.discordId), p]));
  const me = discord ? { discordId: String(discord.discordId), signedUp: Boolean(signup), name: byDiscord.get(String(discord.discordId))?.displayName ?? discord.discordName ?? 'Player' } : null;

  return `
    <div class="page-head">${pageTitle('Pickup', 'Random 2v2 to 6v6 games on the JVO Discord, with captains, drafts and Elo.', 'green')}</div>
    <div class="cols pk-cols">
      <div class="stack">
        ${liveBlock(live, me)}
        <section>
          <div class="section-head"><h2>Recent games</h2></div>
          <div class="panel flush pk-games">${games.length ? games.map((g) => gameRow(g, byDiscord)).join('') : '<p class="muted" style="padding:16px">No games yet.</p>'}</div>
        </section>
      </div>
      <section>
        <div class="section-head"><h2>Elo leaderboard</h2><span class="muted small">everyone starts at 1000</span></div>
        <div class="panel flush">${leaderboard(ratings, byDiscord, me)}</div>
      </section>
    </div>
    <script type="application/json" data-pickup-me>${JSON.stringify(me ?? null).replace(/</g, '\\u003c')}</script>`;
}

export function mount(el) {
  const me = JSON.parse(el.querySelector('[data-pickup-me]')?.textContent || 'null');

  // Countdown to the queue popping.
  const tick = () => {
    for (const c of el.querySelectorAll('[data-countdown]')) {
      const s = Math.max(0, Math.ceil((Number(c.dataset.countdown) - Date.now()) / 1000));
      c.textContent = s ? `${s}s` : 'now';
    }
  };
  tick();
  const timer = setInterval(tick, 1000);
  keepUntilPageChanges(() => clearInterval(timer));

  // Redraw when the bot's live state or your own sign-up changes.
  let pending = null;
  const redraw = () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      invalidate('pickup:');
      refreshQuietly();
    }, 300);
  };
  keepUntilPageChanges(() => clearTimeout(pending));
  const watch = (ref) => {
    let first = true;
    keepUntilPageChanges(onSnapshot(ref, () => {
      if (first) { first = false; return; }
      redraw();
    }, () => {}));
  };
  watch(doc(db, 'pickupMeta/live'));
  if (me) watch(doc(db, `pickupSignups/${me.discordId}`));

  el.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-pickup]');
    if (!button || !me) return;
    button.disabled = true;
    try {
      if (button.dataset.pickup === 'join') await pickupSignUp(me.discordId, me.name);
      else await pickupWithdraw(me.discordId);
      redraw();
    } catch (err) {
      console.error(err);
      button.disabled = false;
      button.insertAdjacentHTML('afterend', `<p class="small" style="color:#b3184d">Couldn’t save that. Try again.</p>`);
    }
  });
}

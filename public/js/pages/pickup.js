// Pickup games: /pickup. Random 2v2-6v6 games run by the Discord bot (bot/, BOT-SETUP.md).
// - The live queue (pickupMeta/live, written by the bot): who's signed up, ready checks, drafts,
//   games on. Players signed in with Discord sign up / withdraw here (pickupSignups/{discordId});
//   the bot picks that up straight away, the same as the menu on Discord.
// - The Elo leaderboard (pickupRatings) and recent games (pickupGames).
// The page redraws itself when the live state or your sign-up changes.

import { onSnapshot, doc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from '../firebase.js';
import { loadPickupLive, loadPickupRatings, loadPickupGames, loadPickupSignup, loadPlayers, invalidate, loadRankedLive, loadRankedRatings, loadRankedSignup } from '../data.js';
import { pickupSignUp, pickupWithdraw, pickupVote, rankedJoin, rankedLeave } from '../player-data.js';
import { currentUser, discordOf, currentAdmin } from '../auth.js';
import { commit } from '../writes.js';
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

function liveBlock(live, me, isAdmin) {
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

  // Which mode is next: set by an admin, or community votes (MODE_VOTES_NEEDED pick it).
  const fixed = live?.fixedMode ?? null;
  const votes = live?.modeVotes ?? {};
  const needed = live?.modeVotesNeeded ?? 2;
  const voteText = Object.entries(votes).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${mode(Number(s))} ×${n}`).join(', ');
  // "Next up": the same projection the bot's queue card shows (Pickup.liveState().next).
  const next = live?.next ?? { size: null, by: 'random', fits: [], tied: [], target: Math.min(...modes) * 2 };
  const nextLabel = next.by === 'tie' ? next.tied.map(mode).join(' or ')
    : next.size ? mode(next.size) : next.fits.length === 1 ? mode(next.fits[0]) : 'random';
  const how = next.by === 'admin' ? `set by an admin${live.fixedModeOnce ? ' for the next game' : ''}`
    : next.by === 'votes' ? `picked by votes (${votes[next.size] ?? 0})`
      : next.by === 'tie' ? 'tied on votes'
        : next.fits.length > 1 ? `random from ${next.fits.map(mode).join(' · ')}`
          : next.fits.length === 1 ? 'the only mode that fits' : `${needed} votes pick the mode`;
  const target = next.target ?? Math.max(...modes) * 2;
  const pctFull = Math.min(100, Math.round((queue.length / target) * 100));
  const modeLine = `
    <div class="pk-next">
      <div class="pk-next-mode"><small>next up</small><b>${nextLabel}</b><span>${how}</span></div>
      <div class="pk-next-bar">
        <div class="pk-bar${pctFull >= 100 ? ' full' : ''}"><span style="width:${pctFull}%"></span></div>
        <small><b>${queue.length}</b>${queue.length < target && next.target ? ` / ${target}` : ''} players${next.waitingFor ? ` · ${mode(next.waitingFor)} has the votes, needs ${next.waitingFor * 2 - queue.length} more` : ''}</small>
      </div>
    </div>
    ${voteText && !fixed ? `<p class="pk-mode">🗳️ Votes: <b>${esc(voteText)}</b> · ${needed} pick the mode</p>` : ''}`;
  // Vote buttons for everyone: signed up -> changes your vote; signed in but not signed up ->
  // signs you up and votes in one go; not signed in -> sign in with Discord first.
  const signedUp = Boolean(me && (me.signedUp || myPlace));
  const voteButtons = !fixed && !inMatch ? `
    <div class="pk-votes" role="group" aria-label="Vote for the next mode">
      <span class="small muted">${!me ? 'Vote for the next mode (sign in first):' : signedUp ? 'Your vote:' : 'Vote (signs you up too):'}</span>
      ${modes.map((n) => `<button class="chip-link" type="button" ${me ? `data-vote="${n}"` : 'data-discord-signin'}${me?.vote === n ? ' aria-current="true"' : ''}>${mode(n)}${votes[n] ? ` · ${votes[n]}` : ''}</button>`).join('')}
      ${signedUp ? `<button class="chip-link" type="button" data-vote=""${!me.vote ? ' aria-current="true"' : ''}>any</button>` : ''}
    </div>` : '';
  const adminBox = isAdmin ? `
    <form class="pk-admin" data-pickup-admin>
      <label>Admin: mode <select name="size">
        <option value="">Community votes</option>
        ${modes.map((n) => `<option value="${n}"${fixed === n ? ' selected' : ''}>${mode(n)}</option>`).join('')}
      </select></label>
      <label class="small"><input type="checkbox" name="once"${live?.fixedModeOnce ? ' checked' : ''}> next game only</label>
      <button class="btn btn-sm" type="submit">Set</button>
    </form>` : '';

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
      ${modeLine}
      ${voteButtons}
      ${adminBox}
      ${list}
      ${matchHtml || gameHtml ? `<h3 class="pk-sub">Right now</h3>${matchHtml}${gameHtml}` : ''}
      <p class="muted small pk-how">Each game is a random mode (${modes.map(mode).join(', ')}) that fits how many are signed up.
        When the queue pops you’re pinged on Discord and have ${readySeconds} seconds to join the locked <b>ready up</b> voice channel,
        so you need to be in the ${discordInviteUrl ? `<a href="${esc(discordInviteUrl)}" target="_blank" rel="noopener">JVO Discord</a>` : 'JVO Discord'}.</p>
    </section>`;
}

// ---------- 1v1 ranked ----------
function rankedBlock(live, me) {
  const online = live?.updatedAt && Date.now() - live.updatedAt < OFFLINE_AFTER;
  const queue = live?.queue ?? [];
  const fixtures = live?.fixtures ?? [];
  const inGame = me && fixtures.find((f) => f.phase !== 'done' && f.phase !== 'cancelled' && (f.aId === me.discordId || f.bId === me.discordId));
  const inQueue = me && (me.inRanked || queue.some((p) => p.id === me.discordId));
  let action;
  if (!me) action = '<button class="btn btn-primary" type="button" data-discord-signin>Sign in to play</button>';
  else if (inGame) action = `<div class="pk-alert">⚔️ <b>You’re in Game ${inGame.number}!</b> ${inGame.phase === 'ready' ? 'Join your 1v1 voice channel on Discord and press Ready.' : 'Report the winner in your game’s thread on Discord.'}</div>`;
  else if (inQueue) action = '<button class="btn" type="button" data-ranked="leave">Leave 1v1 queue</button>';
  else action = '<button class="btn btn-primary" type="button" data-ranked="join">⚔️ Queue 1v1</button>';
  const slots = [0, 1].map((i) => `<li${queue[i] && me && queue[i].id === me.discordId ? ' class="me"' : ''}>${queue[i] ? esc(queue[i].name) : '<span class="muted">open slot</span>'}</li>`).join('');
  const games = fixtures.map((f) => `<div class="pk-match"><b>Game ${f.number}</b> <span class="muted">${f.phase === 'ready' ? `readying up (${f.ready}/2)` : f.phase === 'disputed' ? 'staff deciding' : 'playing'}</span><p class="small">${esc(f.a)} <b>vs</b> ${esc(f.b)}</p></div>`).join('');
  return `
    <section class="panel pk-live pk-ranked">
      <div class="pk-live-head">
        <div>
          <h2>⚔️ 1v1 ranked</h2>
          <p class="pk-status${online ? '' : ' off'}">${online ? '<span class="live-dot"></span>' : '<span class="pk-dot off"></span>'}<b>${queue.length}</b>/2 in the queue${online ? '' : ' · bot offline'}</p>
        </div>
        <div class="pk-action">${action}</div>
      </div>
      <ol class="pk-queue pk-slots">${slots}</ol>
      ${games ? `<h3 class="pk-sub">Right now</h3>${games}` : ''}
      <p class="muted small pk-how">When two are in, you both get a locked voice channel and a ready-up chat on Discord. Join the voice channel and press Ready within ${Math.round((live?.readySeconds ?? 300) / 60)} minutes, then both report the winner with a screenshot of the scoreboard.</p>
    </section>`;
}

function rpBoard(list, byDiscord, me) {
  const placed = list.filter((r) => r.games >= 5).sort((x, y) => y.rating - x.rating || y.wins - x.wins);
  const placing = list.filter((r) => r.games > 0 && r.games < 5);
  if (!placed.length && !placing.length) return '<p class="muted" style="padding:16px">No 1v1s yet.</p>';
  const rows = placed.slice(0, 50).map((r, i) => `<tr${me && r.id === me.discordId ? ' class="me-row"' : ''}>
      <td class="first"><span class="rank">${i + 1}</span> ${nameOf(r.id, r.name, byDiscord)}</td>
      <td class="strong">${r.rating}</td><td>${r.wins}</td><td>${r.losses}</td><td class="pk-form">${form(r.form)}</td></tr>`).join('');
  return `${placed.length ? `<div class="table-wrap"><table class="data">
    <thead><tr><th class="first">Player</th><th>RP</th><th>W</th><th>L</th><th>Last 5</th></tr></thead>
    <tbody>${rows}</tbody></table></div>` : '<p class="muted" style="padding:16px 16px 0">Nobody has finished placements yet.</p>'}
    ${placing.length ? `<p class="small pk-placing"><b>Placing:</b> ${placing.map((r) => `${nameOf(r.id, r.name, byDiscord)} ${r.games}/5`).join(' · ')}</p>` : ''}`;
}

// 1v1 RP card for profiles. rank: loadRankedRank() result, or null.
export function rankedBlockMini(rank) {
  if (!rank) return '';
  const r = rank.rating;
  const placed = r.games >= 5;
  return `
    <div class="pk-mini">
      <a class="pk-elo pk-rp" href="/pickup" data-link title="1v1 RP"><b>${r.rating}</b><small>${placed ? '1v1 rp' : `placing ${r.games}/5`}</small></a>
      <div class="pk-mini-text">
        <div>${placed ? `<b>#${rank.rank}</b> <span class="muted">of ${rank.total}</span>` : '<span class="muted">placements</span>'}</div>
        <div class="small">${r.wins} W · ${r.losses} L</div>
        <div class="pk-form">${form(r.form)}</div>
      </div>
    </div>`;
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
  const admin = await currentAdmin().catch(() => null);
  const [live, ratings, games, players, signup, live1, rp, rankedSignup] = await Promise.all([
    loadPickupLive(),
    loadPickupRatings({ fresh: true }).catch(() => []),
    loadPickupGames().catch(() => []),
    loadPlayers(),
    discord ? loadPickupSignup(discord.discordId) : null,
    loadRankedLive(),
    loadRankedRatings({ fresh: true }).catch(() => []),
    discord ? loadRankedSignup(discord.discordId) : null,
  ]);
  const byDiscord = new Map(players.filter((p) => p.discordId).map((p) => [String(p.discordId), p]));
  const me = discord ? { discordId: String(discord.discordId), signedUp: Boolean(signup), inRanked: Boolean(rankedSignup), vote: Number.isInteger(signup?.vote) ? signup.vote : null, name: byDiscord.get(String(discord.discordId))?.displayName ?? discord.discordName ?? 'Player' } : null;

  return `
    <div class="page-head">${pageTitle('Pickup', 'Random 2v2 to 6v6 games and 1v1 ranked on the JVO Discord, with drafts, Elo and RP.', 'green')}</div>
    <div class="cols pk-cols">
      <div class="stack">
        ${liveBlock(live, me, Boolean(admin?.admin))}
        <section>
          <div class="section-head"><h2>Recent games</h2></div>
          <div class="panel flush pk-games">${games.length ? games.map((g) => gameRow(g, byDiscord)).join('') : '<p class="muted" style="padding:16px">No games yet.</p>'}</div>
        </section>
      </div>
      <div class="stack">
        ${rankedBlock(live1, me)}
        <section>
          <div class="section-head"><h2>Elo leaderboard</h2><span class="muted small">pickup games · everyone starts at 1000</span></div>
          <div class="panel flush">${leaderboard(ratings, byDiscord, me)}</div>
        </section>
        <section>
          <div class="section-head"><h2>1v1 RP leaderboard</h2><span class="muted small">5 placements at ±50, then ±20</span></div>
          <div class="panel flush">${rpBoard(rp, byDiscord, me)}</div>
        </section>
      </div>
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
  watch(doc(db, 'pickupMeta/live1v1'));
  if (me) watch(doc(db, `rankedSignups/${me.discordId}`));
  if (me) watch(doc(db, `pickupSignups/${me.discordId}`));

  // Admins: set the mode (the bot picks it up straight away).
  el.querySelector('[data-pickup-admin]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const button = f.querySelector('button');
    button.disabled = true;
    try {
      const admin = await currentAdmin();
      if (!admin?.admin) throw new Error('not an admin');
      const size = f.size.value ? Number(f.size.value) : null;
      await commit(admin.user.uid, [{ type: 'set', path: 'pickupControl/mode', data: { size, once: Boolean(size && f.once.checked) } }], { admin: true });
      button.textContent = 'Saved';
    } catch (err) {
      console.error(err);
      button.disabled = false;
      button.insertAdjacentHTML('afterend', '<span class="small" style="color:#b3184d"> Couldn’t save.</span>');
    }
  });

  el.addEventListener('click', async (e) => {
    const vote = e.target.closest('[data-vote]');
    if (vote && me) {
      vote.disabled = true;
      try {
        const size = vote.dataset.vote ? Number(vote.dataset.vote) : null;
        if (me.signedUp) await pickupVote(me.discordId, size);
        else if (size) await pickupSignUp(me.discordId, me.name, size);
        redraw();
      } catch (err) {
        console.error(err);
        vote.disabled = false;
      }
      return;
    }
    const r = e.target.closest('[data-ranked]');
    if (r && me) {
      r.disabled = true;
      try {
        if (r.dataset.ranked === 'join') await rankedJoin(me.discordId, me.name);
        else await rankedLeave(me.discordId);
        redraw();
      } catch (err) {
        console.error(err);
        r.disabled = false;
      }
      return;
    }
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

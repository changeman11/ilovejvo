// What the bot's Discord messages look like. Each function returns a plain message object
// ({ content, embeds, components, allowedMentions }) in Discord's own JSON shape, so the game
// logic never needs discord.js and the tests can read them.
import { modeLabel, fittingModes, minPlayers, projectedMode } from './logic/modes.js';
import { currentSide } from './logic/draft.js';
import { randomNeeded } from './logic/random-teams.js';

// I<3JVO colours (CLAUDE.md "Look").
const BLUE = 0x1438d8;
const YELLOW = 0xffe200;
const TEAL = 0x16b3a3;
const CORAL = 0xff6b5b;
const GREY = 0x8a90a8;
const PURPLE = 0x7c5cff;

const BUTTON = 2;
const SELECT = 3;
const ROW = 1;
const STYLE = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 };

// The I<3JVO site's pickup page (SITE_URL in .env; empty = no links).
export const pickupUrl = (config) => (config?.siteUrl ? `${config.siteUrl}/pickup` : null);
// A row with a "open the site" link button, or nothing when there's no site URL.
function siteRow(config, label = 'I<3JVO pickup page') {
  const url = pickupUrl(config);
  return url ? [{ type: ROW, components: [{ type: BUTTON, style: STYLE.link, label, url, emoji: { name: '🌐' } }] }] : [];
}

// Names can contain Discord formatting characters; show them as typed.
export const esc = (name) => String(name ?? '?').slice(0, 64).replace(/[\\*_~`|>[\]]/g, '\\$&');
const short = (name, max = 32) => {
  const s = String(name ?? '?');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const unix = (ms) => Math.floor(ms / 1000);
const mention = (p) => (p.fake ? `**${esc(p.name)}**` : `<@${p.id}>`);
const noMentions = { parse: [] };

function rows(buttons) {
  const out = [];
  for (let i = 0; i < buttons.length && out.length < 5; i += 5) out.push({ type: ROW, components: buttons.slice(i, i + 5) });
  return out;
}

export const teamName = (game, side) => {
  const captain = game.teams[side].players.find((p) => p.id === game.teams[side].captain);
  return `Team ${side === 'a' ? 1 : 2} · ${short(captain?.name, 24)}`;
};

export const teamChannelName = (game, side) => `🏐 #${game.number} ${teamName(game, side)}`.slice(0, 100);

// Ready-up channel names. The bot tidies up leftover ones (names starting with LOBBY_PREFIX)
// when it starts.
export const LOBBY_PREFIX = '🏐 ready up · ';
export const lobbyChannelName = (match) => `${LOBBY_PREFIX}${modeLabel(match.size)}${match.tag ? ` #${match.tag}` : ''}`;
// The locked match chat: "ready-up-4v4" during the ready check and draft, then "game-12".
export const CHAT_PREFIX = 'ready-up-';
export const chatChannelName = (match) => `${CHAT_PREFIX}${modeLabel(match.size)}${match.tag ? `-${match.tag}` : ''}`;
export const gameChatName = (game) => `game-${game.number}`;

// ---------- queue ----------
// snapshot: { ready: [{id, name, fake}], drafting, countdownEndsAt, games: [{number, size, status}] }
// A bar of squares: filled up to `have` out of `want` (at most 12 squares).
export function bar(have, want, full = false) {
  const n = Math.max(1, Math.min(12, want));
  const filled = Math.min(n, have);
  return (full ? '🟩' : '🟦').repeat(filled) + '⬜'.repeat(n - filled);
}

// The queue card in #pickup: the next mode in big letters, a player bar, every mode with whether
// it fits and its votes, who's signed up, and what's on right now.
export function queueView(snapshot, config) {
  const { ready, drafting = 0, countdownEndsAt = null, games = [], votes = {}, fixedMode = null, randomVotes = 0 } = snapshot;
  const n = ready.length;
  const next = projectedMode({ readyCount: n, modes: config.modes, tally: votes, needed: config.modeVotesNeeded, fixed: fixedMode?.size ?? null });
  const needVotes = config.modeVotesNeeded;

  // Headline: the next mode and how it was decided.
  let headline;
  let how;
  if (next.by === 'admin') {
    headline = `## 🎛️ Next up: ${modeLabel(next.size)}`;
    how = `Set by an admin${fixedMode?.once ? ' for the next game' : ''} · voting is paused`;
  } else if (next.by === 'votes') {
    headline = `## 🗳️ Next up: ${modeLabel(next.size)}`;
    how = `Picked by votes (${votes[next.size]}) · change it with the vote menu`;
  } else if (next.by === 'tie') {
    headline = `## 🗳️ Next up: ${next.tied.map(modeLabel).join(' or ')}`;
    how = 'Tied on votes · one more vote decides it, or it’s a coin flip';
  } else if (next.fits.length) {
    headline = `## 🎲 Next up: ${next.fits.length === 1 ? modeLabel(next.fits[0]) : 'random'}`;
    how = next.fits.length === 1 ? 'The only mode that fits right now' : `Random from ${next.fits.map(modeLabel).join(' · ')} · ${needVotes} votes pick one`;
  } else {
    headline = '## 🎲 Next up: random';
    how = `${needVotes} votes pick the mode · otherwise random from what fits`;
  }
  if (randomVotes) how += `\n🎲 **${randomVotes}** want random teams · more than half of a game’s players = no draft`;
  if (next.waitingFor) how += `\n🗳️ ${modeLabel(next.waitingFor)} has the votes: it needs **${next.waitingFor * 2 - n}** more player${next.waitingFor * 2 - n === 1 ? '' : 's'}`;

  // The player bar and what's happening.
  const target = next.target ?? Math.max(...config.modes) * 2;
  const full = next.target === null || n >= target;
  let status;
  if (countdownEndsAt) status = `⏱️ **Starting <t:${unix(countdownEndsAt)}:R>**: others can still jump in`;
  else if (next.by === 'admin' && n < target) status = `⏳ Need **${target - n}** more for ${modeLabel(next.size)}`;
  else if (!next.fits.length) status = `⏳ Need **${target - n}** more to start`;
  else status = '✅ Enough to play';
  const enough = next.target !== null && n >= target;
  const fullFor = next.size ? ` · ${modeLabel(next.size)} is full` : '';
  const playerBar = `${bar(n, target, full)}  **${n}${!enough && next.target ? ` / ${target}` : ''}** player${n === 1 ? '' : 's'}${enough ? fullFor : ''}`;

  // Every mode: fits or how many more it needs, and its votes.
  const modesBoard = config.modes.map((m) => {
    const short = m * 2 - n;
    const isNext = (next.size ?? (next.fits.length === 1 ? next.fits[0] : null)) === m || (next.by === 'tie' && next.tied.includes(m));
    const state = short <= 0 ? '✅' : `🔒 +${short}`;
    const v = votes[m] ? ` · 🗳️ ${votes[m]}` : '';
    const label = `\`${modeLabel(m)}\``;
    return `${isNext ? '▶️' : '▫️'} ${isNext ? `**${label}**` : label} ${state}${v}`;
  }).join('\n');

  const players = n
    ? ready.slice(0, 20).map((p, i) => `\`${String(i + 1).padStart(2)}\` ${esc(p.name)}${p.from === 'site' ? ' 🌐' : ''}`).join('\n') + (n > 20 ? `\n…and ${n - 20} more` : '')
    : '*Nobody yet. Be the first!*';

  const live = games.filter((g) => g.status === 'playing' || g.status === 'disputed');
  const now = [
    ...(drafting ? [`🔔 ${drafting} getting ready (ready check or draft)`] : []),
    ...live.slice(0, 6).map((g) => `🏐 Game #${g.number} · ${modeLabel(g.size)}${g.status === 'disputed' ? ' · ⚠️ waiting for an admin' : ''}`),
  ].join('\n') || '*No games on*';

  const color = countdownEndsAt ? YELLOW : next.by === 'admin' ? PURPLE : next.fits.length ? TEAL : BLUE;
  const logo = config.siteUrl ? `${config.siteUrl}/icons/icon-192.png` : null;
  return {
    content: '',
    embeds: [
      {
        author: { name: 'I<3JVO PICKUP', url: pickupUrl(config) ?? undefined, icon_url: logo ?? undefined },
        color,
        description: `${headline}\n${how}\n\n${playerBar}\n${status}${config.pickupChatChannelId ? `\n💬 Chat with other players in <#${config.pickupChatChannelId}>` : ''}`,
        fields: [
          { name: '🎮 Modes', value: modesBoard, inline: true },
          { name: `👥 Signed up · ${n}`, value: players, inline: true },
          { name: '🔥 Right now', value: now, inline: false },
        ],
        thumbnail: logo ? { url: logo } : undefined,
        footer: { text: `Sign up below · vote for a mode · when it pops you have ${config.readySeconds}s to join your ready-up channel${pickupUrl(config) ? ' · 🌐 = signed up on the website' : ''}` },
      },
    ],
    components: [
      {
        type: ROW,
        components: [
          {
            type: SELECT,
            custom_id: 'queue',
            placeholder: 'Sign up or withdraw…',
            options: [
              { label: 'Sign up', value: 'join', description: 'Join the queue for the next pickup game', emoji: { name: '✅' } },
              { label: 'Withdraw', value: 'leave', description: 'Leave the queue', emoji: { name: '❌' } },
            ],
          },
        ],
      },
      {
        type: ROW,
        components: [
          {
            type: SELECT,
            custom_id: 'mode',
            placeholder: fixedMode ? `Mode set by an admin: ${modeLabel(fixedMode.size)}` : 'Vote for the next mode…',
            disabled: Boolean(fixedMode),
            options: [
              ...config.modes.map((n) => ({ label: modeLabel(n), value: String(n), description: `${votes[n] ?? 0} vote${(votes[n] ?? 0) === 1 ? '' : 's'} · needs ${n * 2} players`, emoji: { name: '🗳️' } })),
              { label: 'No preference', value: 'none', description: 'Remove your vote' },
            ],
          },
        ],
      },
      {
        type: ROW,
        components: [
          {
            type: SELECT,
            custom_id: 'teams',
            placeholder: 'How should teams be made?',
            options: [
              { label: 'Captains draft', value: 'draft', description: 'Two random captains pick their teams', emoji: { name: '🧢' } },
              { label: 'Random teams', value: 'random', description: `${randomVotes} vote${randomVotes === 1 ? '' : 's'} · more than half of a game = no draft`, emoji: { name: '🎲' } },
            ],
          },
        ],
      },
      ...siteRow(config, 'Queue, leaderboard & games on I<3JVO'),
    ],
    allowedMentions: noMentions,
  };
}

// ---------- ready check ----------
// match: { size, players: [{id, name, fake}], confirmed: Set, dropped: [names], lobbyId, deadline }
export function checkView(match, config, { ping = [] } = {}) {
  const ready = match.players.filter((p) => match.confirmed.has(p.id));
  const waiting = match.players.filter((p) => !match.confirmed.has(p.id));
  const lines = [
    `Join <#${match.lobbyId}> to confirm. Time's up <t:${unix(match.deadline)}:R>.`,
    'Anyone who isn\'t in it by then is dropped, and the next player in the queue takes their place.',
  ];
  if (match.dropped.length) lines.push(`\nDropped (didn't join in time): ${match.dropped.map(esc).join(', ')}`);
  return {
    content: ping.length
      ? `🏐 **${modeLabel(match.size)} found!**${match.why === 'votes' ? ' (voted)' : match.why === 'admin' ? ' (set by an admin)' : ''} ${ping.map((id) => `<@${id}>`).join(' ')} join <#${match.lobbyId}> within ${config.readySeconds} seconds.`
      : `🏐 **${modeLabel(match.size)} found!** Ready check in <#${match.lobbyId}>.`,
    embeds: [
      {
        title: `${modeLabel(match.size)}: ready check (${ready.length}/${match.players.length})`,
        color: YELLOW,
        description: lines.join('\n'),
        fields: [
          { name: `✅ Ready (${ready.length})`, value: ready.length ? ready.map((p) => esc(p.name)).join('\n') : '—', inline: true },
          { name: `⏳ Waiting for (${waiting.length})`, value: waiting.length ? waiting.map((p) => esc(p.name)).join('\n') : '—', inline: true },
        ],
        footer: { text: 'This chat and the ready-up voice channel are locked: only these players (and admins) can get in.' },
      },
    ],
    components: [],
    allowedMentions: { users: ping },
  };
}

// Everyone's in: the card in the match chat says so and points to the draft.
export function checkDoneView(match, config) {
  const base = checkView(match, config);
  return {
    ...base,
    content: `✅ **Everyone's in!** The ${modeLabel(match.size)} draft is below. This chat stays open for the game.`,
    embeds: base.embeds.map((e) => ({ ...e, color: TEAL, description: 'Everyone joined in time. Captains are picking now.' })),
  };
}

export function replacementView(match, ids, config) {
  return {
    content: `🏐 ${ids.map((id) => `<@${id}>`).join(' ')} you're in the ${modeLabel(match.size)}! Join <#${match.lobbyId}> within ${config.readySeconds} seconds to confirm.`,
    embeds: [],
    components: [],
    allowedMentions: { users: ids },
  };
}

export function matchCancelledView(match, reason) {
  const what = match.phase === 'draft' ? 'draft' : 'ready check';
  return {
    content: `🏐 ${modeLabel(match.size)} ${what} cancelled: ${reason}.`,
    embeds: [
      {
        title: `${modeLabel(match.size)} ${what} cancelled`,
        color: GREY,
        description: `${reason}. Everyone else is still signed up, in the same order.`,
        fields: [{ name: 'Players', value: match.players.map((p) => esc(p.name)).join(', ') || '—' }],
      },
    ],
    components: [],
    allowedMentions: noMentions,
  };
}

// ---------- draft ----------
// draft (a match in its draft phase): { id, state, names, fakes, deadline, note }
export function draftView(draft) {
  const { state, names } = draft;
  const person = (id) => ({ id, name: names[id], fake: draft.fakes.has(id) });
  const side = currentSide(state);
  const captain = side ? names[state.captains[side]] : null;
  const list = (s) => state.teams[s].map((id) => `${id === state.captains[s] ? '👑 ' : ''}${esc(names[id])}`).join('\n');
  const label = (s) => `Team ${s === 'a' ? 1 : 2} · ${short(names[state.captains[s]], 24)}`;
  const lines = [];
  if (side) lines.push(`**${esc(captain)}** is picking. Time's up <t:${unix(draft.deadline)}:R> (then it's a random pick).`);
  if (draft.note) lines.push(`_${draft.note}_`);
  return {
    content: `🏐 **${modeLabel(state.size)} draft!** Captains: ${mention(person(state.captains.a))} and ${mention(person(state.captains.b))}.`,
    embeds: [
      {
        title: `${modeLabel(state.size)} draft`,
        color: YELLOW,
        description: lines.join('\n') || undefined,
        fields: [
          { name: label('a'), value: list('a'), inline: true },
          { name: label('b'), value: list('b'), inline: true },
          { name: 'Still to pick', value: state.pool.length ? state.pool.map((id) => esc(names[id])).join('\n') : '—' },
        ],
        footer: { text: `Only the captain whose turn it is can pick. Anyone in the draft can vote for random teams (${randomNeeded(state.players.length)} votes ends the draft). Leaving the ready-up channel cancels it.` },
      },
    ],
    components: [
      ...rows(state.pool.map((id) => ({ type: BUTTON, style: STYLE.secondary, label: short(names[id], 80), custom_id: `pick:${draft.id}:${id}` }))),
      { type: ROW, components: [{ type: BUTTON, style: STYLE.primary, label: `Random teams (${draft.randomVotes?.size ?? 0}/${randomNeeded(state.players.length)})`, emoji: { name: '🎲' }, custom_id: `rnd:${draft.id}` }] },
    ],
    allowedMentions: { users: [state.captains.a, state.captains.b].filter((id) => !draft.fakes.has(id)) },
  };
}

// ---------- game card (the draft message turns into this) ----------
function playerLine(game, side, p) {
  const captain = p.id === game.teams[side].captain ? '👑 ' : '';
  const change = game.changes?.[p.id];
  if (game.status === 'done' && change) {
    const sign = change.delta > 0 ? '+' : change.delta < 0 ? '−' : '±';
    return `${captain}${esc(p.name)}  **${change.after ?? change.before + change.delta}** (${sign}${Math.abs(change.delta)})`;
  }
  return `${captain}${esc(p.name)}${p.fake ? ' _(test)_' : ''}`;
}

const outcomeText = (game, outcome) => (outcome === 'cancel' ? 'cancel the game' : `${teamName(game, outcome)} won`);

export function gameView(game, { problems = [] } = {}) {
  const fields = ['a', 'b'].map((side) => ({
    name: `${game.winner === side ? '🏆 ' : ''}${teamName(game, side)}`,
    value: game.teams[side].players.map((p) => playerLine(game, side, p)).join('\n'),
    inline: true,
  }));
  const title = `Game #${game.number} · ${modeLabel(game.size)}`;
  let color = BLUE;
  const lines = [];
  let components = [];
  if (game.status === 'playing' || game.status === 'disputed') {
    const channels = ['a', 'b'].filter((s) => game.channels?.[s]).map((s) => `<#${game.channels[s]}>`);
    if (game.random) lines.push('🎲 **Random teams:** the players voted for them instead of a draft.');
    if (channels.length) lines.push(`Team voice channels: ${channels.join(' and ')}`);
    lines.push('**Captains:** when the game is over, both press who won. If you both agree, Elo updates.');
    for (const side of ['a', 'b']) {
      const vote = game.votes?.[side];
      const captain = game.teams[side].players.find((p) => p.id === game.teams[side].captain);
      lines.push(`${vote ? '✅' : '⏳'} ${esc(captain?.name)}: ${vote ? outcomeText(game, vote) : 'not reported yet'}`);
    }
    if (game.status === 'disputed') {
      color = CORAL;
      lines.push('⚠️ **The captains disagree.** An admin will decide (or press again if it was a mistake).');
    }
    components = rows([
      { type: BUTTON, style: STYLE.primary, label: short(`${teamName(game, 'a')} won`, 80), custom_id: `res:${game.id}:a` },
      { type: BUTTON, style: STYLE.primary, label: short(`${teamName(game, 'b')} won`, 80), custom_id: `res:${game.id}:b` },
      { type: BUTTON, style: STYLE.secondary, label: 'Cancel game', custom_id: `res:${game.id}:cancel` },
    ]);
  } else if (game.status === 'done') {
    color = TEAL;
    lines.push(`🏆 **${teamName(game, game.winner)}** won.`);
    lines.push(game.decidedBy?.by === 'admin' ? `Decided by admin ${esc(game.decidedBy.name)}.` : 'Both captains agreed.');
  } else if (game.status === 'cancelled') {
    color = GREY;
    lines.push(`Cancelled${game.decidedBy?.by === 'admin' ? ` by admin ${esc(game.decidedBy.name)}` : ' by both captains'}. No Elo change.`);
  }
  if (problems.length) lines.push(`\n⚠️ ${problems.join('\n⚠️ ')}`);
  return {
    content: game.status === 'playing' ? `🏐 **Game #${game.number} is on!** Good luck.` : '',
    embeds: [{ title, color, description: lines.join('\n'), fields, footer: { text: `Game #${game.number} · /pickup result can change it (admins)` } }],
    components,
    allowedMentions: noMentions,
  };
}

// Posted in #pickup when a game is decided (the match chat with the game card is deleted).
export function resultView(game, { corrected = false, config = null } = {}) {
  const view = gameView(game);
  return {
    content: corrected ? `✏️ Game #${game.number} result changed.` : '',
    embeds: view.embeds,
    components: siteRow(config, 'Elo leaderboard on I<3JVO'),
    allowedMentions: noMentions,
  };
}

export function disputeView(game, config) {
  const roles = config.adminRoleIds.slice(0, 3);
  return {
    content: `${roles.map((r) => `<@&${r}>`).join(' ')} ⚠️ The captains of **game #${game.number}** disagree on the result. An admin: press the winner on the game card, or use \`/pickup result game:${game.number}\`.`.trim(),
    embeds: [],
    components: [],
    allowedMentions: { roles },
  };
}

// ---------- ratings ----------
export function ratingView(record, rank, total, config) {
  if (!record.games) {
    return { content: `**${esc(record.name)}** hasn't played a pickup game yet. Everyone starts at **${config.startRating}**.`, embeds: [], components: siteRow(config), allowedMentions: noMentions };
  }
  const form = record.form ? record.form.split('').map((c) => (c === 'W' ? '🟩' : '🟥')).join('') : '—';
  return {
    content: '',
    embeds: [
      {
        title: `${esc(record.name)}: ${record.rating} Elo`,
        url: pickupUrl(config) ?? undefined,
        color: BLUE,
        fields: [
          { name: 'Rank', value: `#${rank} of ${total}`, inline: true },
          { name: 'Games', value: `${record.games} (${record.wins} W · ${record.losses} L)`, inline: true },
          { name: 'Last 5', value: form, inline: true },
        ],
      },
    ],
    components: siteRow(config),
    allowedMentions: noMentions,
  };
}

export function leaderboardView(records, config = null) {
  const medal = ['🥇', '🥈', '🥉'];
  const top = records.slice(0, 20);
  return {
    content: '',
    embeds: [
      {
        title: '🏐 Pickup Elo leaderboard',
        url: pickupUrl(config) ?? undefined,
        color: YELLOW,
        description: top.length
          ? top.map((r, i) => `${medal[i] ?? `\`${String(i + 1).padStart(2)}\``} **${esc(r.name)}** ${r.rating} · ${r.wins}-${r.losses}`).join('\n')
          : 'No games played yet. Sign up on the queue card to start one!',
        footer: { text: records.length > 20 ? `Top 20 of ${records.length} players · /elo for anyone's rating` : '/elo for anyone\'s rating' },
      },
    ],
    components: siteRow(config, 'Full leaderboard on I<3JVO'),
    allowedMentions: noMentions,
  };
}

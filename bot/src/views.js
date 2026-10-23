// What the bot's Discord messages look like. Each function returns a plain message object
// ({ content, embeds, components, allowedMentions }) in Discord's own JSON shape, so the game
// logic never needs discord.js and the tests can read them.
import { modeLabel, fittingModes, minPlayers } from './logic/modes.js';
import { currentSide } from './logic/draft.js';

// I<3JVO colours (CLAUDE.md "Look").
const BLUE = 0x1438d8;
const YELLOW = 0xffe200;
const TEAL = 0x16b3a3;
const CORAL = 0xff6b5b;
const GREY = 0x8a90a8;

const BUTTON = 2;
const ROW = 1;
const STYLE = { primary: 1, secondary: 2, success: 3, danger: 4 };

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

// Channel names. The bot makes the queue channel if QUEUE_CHANNEL_ID is empty, and tidies up
// leftover ready-up channels (names starting with LOBBY_PREFIX) when it starts.
export const QUEUE_CHANNEL_NAME = '🏐 pickup queue';
export const LOBBY_PREFIX = '🏐 ready up · ';
export const lobbyChannelName = (match) => `${LOBBY_PREFIX}${modeLabel(match.size)}`;

// ---------- queue ----------
// snapshot: { ready: [{id, name, fake}], drafting, countdownEndsAt, games: [{number, size, status}] }
export function queueView(snapshot, config) {
  const { ready, drafting = 0, countdownEndsAt = null, games = [] } = snapshot;
  const need = minPlayers(config.modes) - ready.length;
  const fits = fittingModes(ready.length, config.modes).map(modeLabel).join(' · ');
  let status;
  if (countdownEndsAt) status = `**${ready.length}** ready. Starting <t:${unix(countdownEndsAt)}:R>, so others can still join.\nPossible modes: ${fits}`;
  else if (need > 0) status = `**${ready.length}** ready. Need **${need}** more to start a game.`;
  else status = `**${ready.length}** ready.`;
  const fields = [
    {
      name: `Ready (${ready.length})`,
      value: ready.length ? ready.slice(0, 30).map((p, i) => `${i + 1}. ${esc(p.name)}`).join('\n') + (ready.length > 30 ? `\n…and ${ready.length - 30} more` : '') : 'Nobody yet.',
    },
  ];
  if (drafting) fields.push({ name: 'Getting ready', value: `${drafting} game${drafting === 1 ? '' : 's'} in a ready check or draft right now.` });
  const live = games.filter((g) => g.status === 'playing' || g.status === 'disputed');
  if (live.length) {
    fields.push({
      name: 'Games on',
      value: live.slice(0, 10).map((g) => `#${g.number} ${modeLabel(g.size)}${g.status === 'disputed' ? ' (waiting for an admin)' : ''}`).join('\n'),
    });
  }
  return {
    content: '',
    embeds: [
      {
        title: '🏐 Pickup games: ready up',
        color: BLUE,
        description: `Join <#${config.queueChannelId}> to queue. Each game is a random mode (${config.modes.map(modeLabel).join(', ')}) that fits how many are queued. When you're picked, join your locked ready-up channel within ${config.readySeconds} seconds.\n\n${status}`,
        fields,
        footer: { text: 'I<3JVO pickups · /elo · /leaderboard' },
      },
    ],
    components: [],
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
      ? `🏐 **${modeLabel(match.size)} found!** ${ping.map((id) => `<@${id}>`).join(' ')} join <#${match.lobbyId}> within ${config.readySeconds} seconds.`
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
        footer: { text: 'The ready-up channel is locked: only these players (and admins) can join.' },
      },
    ],
    components: [],
    allowedMentions: { users: ping },
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
        description: `${reason}. Everyone else is back in the queue, in the same order.`,
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
        footer: { text: 'Only the captain whose turn it is can pick. Leaving the ready-up channel cancels the draft.' },
      },
    ],
    components: rows(
      state.pool.map((id) => ({ type: BUTTON, style: STYLE.secondary, label: short(names[id], 80), custom_id: `pick:${draft.id}:${id}` })),
    ),
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
    return { content: `**${esc(record.name)}** hasn't played a pickup game yet. Everyone starts at **${config.startRating}**.`, embeds: [], allowedMentions: noMentions };
  }
  const form = record.form ? record.form.split('').map((c) => (c === 'W' ? '🟩' : '🟥')).join('') : '—';
  return {
    content: '',
    embeds: [
      {
        title: `${esc(record.name)}: ${record.rating} Elo`,
        color: BLUE,
        fields: [
          { name: 'Rank', value: `#${rank} of ${total}`, inline: true },
          { name: 'Games', value: `${record.games} (${record.wins} W · ${record.losses} L)`, inline: true },
          { name: 'Last 5', value: form, inline: true },
        ],
      },
    ],
    allowedMentions: noMentions,
  };
}

export function leaderboardView(records) {
  const medal = ['🥇', '🥈', '🥉'];
  const top = records.slice(0, 20);
  return {
    content: '',
    embeds: [
      {
        title: '🏐 Pickup Elo leaderboard',
        color: YELLOW,
        description: top.length
          ? top.map((r, i) => `${medal[i] ?? `\`${String(i + 1).padStart(2)}\``} **${esc(r.name)}** ${r.rating} · ${r.wins}-${r.losses}`).join('\n')
          : 'No games played yet. Join the ready-up channel to start one!',
        footer: { text: records.length > 20 ? `Top 20 of ${records.length} players · /elo for anyone's rating` : '/elo for anyone\'s rating' },
      },
    ],
    allowedMentions: noMentions,
  };
}

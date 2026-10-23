// What the 1v1 ranked messages look like (plain Discord JSON, like views.js).
import { esc } from './views.js';
import { rpLabel, isPlaced, PLACEMENT_GAMES, PLACEMENT_STEP, RP_STEP } from './logic/ranked.js';

const BLUE = 0x1438d8;
const YELLOW = 0xffe200;
const TEAL = 0x16b3a3;
const CORAL = 0xff6b5b;
const GREY = 0x8a90a8;
const PURPLE = 0x7c5cff;
const ROW = 1;
const BUTTON = 2;
const STYLE = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 };
const noMentions = { parse: [] };
const unix = (ms) => Math.floor(ms / 1000);
const short = (s, n = 24) => (String(s ?? '?').length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? '?'));
const mention = (p) => `<@${p.id}>`;

// Channel names. LEFTOVER patterns are cleared when the bot starts.
export const voiceName = (f) => `1v1 - ${short(f.a.name)} VS ${short(f.b.name)} (Game ${f.number})`.slice(0, 100);
export const textName = (f) => `1v1-game-${f.number}`;
export const threadName = (f) => `Game ${f.number}: ${short(f.a.name, 40)} vs ${short(f.b.name, 40)}`.slice(0, 100);
export const VOICE_PREFIX = '1v1 - ';
export const TEXT_PREFIX = '1v1-game-';

// The ever-present queue card in the 1v1 queue channel.
export function queueCard({ queue, fixtures, config }) {
  const slots = [0, 1].map((i) => (queue[i] ? `🟦 ${esc(queue[i].name)}` : '⬜ *open slot*')).join('\n');
  const live = fixtures.filter((f) => f.phase !== 'done' && f.phase !== 'cancelled');
  const now = live.slice(0, 8).map((f) => `${f.phase === 'ready' ? '🔔' : f.phase === 'disputed' ? '⚠️' : '⚔️'} Game ${f.number}: ${esc(f.a.name)} vs ${esc(f.b.name)}${f.phase === 'ready' ? ' · readying up' : f.phase === 'disputed' ? ' · staff deciding' : ''}`).join('\n') || '*No 1v1s on*';
  return {
    content: '',
    embeds: [
      {
        author: { name: 'I<3JVO 1v1 RANKED', icon_url: config.siteUrl ? `${config.siteUrl}/icons/icon-192.png` : undefined },
        color: queue.length ? YELLOW : BLUE,
        description: `## ⚔️ 1v1 queue · ${queue.length}/2\nPress **Queue** to find an opponent. When two are in, a voice channel and a ready-up chat open for you both, and the queue opens again for the next pair.`,
        fields: [
          { name: '🎯 In the queue', value: slots, inline: true },
          { name: '🔥 Right now', value: now, inline: true },
          { name: '📈 RP', value: `First ${PLACEMENT_GAMES} games are placements: **±${PLACEMENT_STEP}**. After that: **±${RP_STEP}** a game.\n\`/rp\` · \`/rpleaderboard\``, inline: false },
        ],
        footer: { text: `You'll have ${Math.round(config.rankedReadySeconds / 60)} min to join the voice channel and press Ready.` },
      },
    ],
    components: [
      {
        type: ROW,
        components: [
          { type: BUTTON, style: STYLE.success, label: 'Queue', custom_id: 'rq:join', emoji: { name: '⚔️' } },
          { type: BUTTON, style: STYLE.secondary, label: 'Leave queue', custom_id: 'rq:leave' },
        ],
      },
    ],
    allowedMentions: noMentions,
  };
}

export function readyCard(f, config, { ping = false } = {}) {
  const line = (p) => `${f.ready.has(p.id) || f.phase !== 'ready' ? '✅' : '⏳'} ${esc(p.name)}`;
  const done = f.phase !== 'ready';
  return {
    content: ping ? `⚔️ ${mention(f.a)} vs ${mention(f.b)}: your 1v1 is ready!` : '',
    embeds: [
      {
        title: `Game ${f.number}: ready up`,
        color: done ? TEAL : YELLOW,
        description: done
          ? '✅ **Both ready!** Play your game, then report the result in the thread below.'
          : `1. Join the voice channel <#${f.voiceId}>\n2. Press **Ready**\n\nTime's up <t:${unix(f.deadline)}:R>. If one of you isn't ready, the fixture is cancelled with no RP change.`,
        fields: [{ name: 'Players', value: `${line(f.a)}\n${line(f.b)}` }],
      },
    ],
    components: done ? [] : [{ type: ROW, components: [{ type: BUTTON, style: STYLE.success, label: 'Ready', custom_id: `rr:${f.id}`, emoji: { name: '✅' } }] }],
    allowedMentions: ping ? { users: [f.a.id, f.b.id] } : noMentions,
  };
}

export function resultCard(f, config, { ping = false } = {}) {
  const status = (side) => (f.reports[side] ? `✅ ${esc(f[side].name)} reported` : `⏳ ${esc(f[side].name)}`);
  return {
    content: ping ? `${mention(f.a)} ${mention(f.b)} when your game's done, both of you press **Report result**.` : '',
    embeds: [
      {
        title: `Game ${f.number}: who won?`,
        color: f.phase === 'disputed' ? CORAL : BLUE,
        description: f.phase === 'disputed'
          ? '⚠️ **You picked different winners.** Staff will decide from the screenshots.'
          : 'Both players press **Report result**, pick the winner and attach a screenshot of the **end-game scoreboard** (required). If you agree, RP updates straight away.',
        fields: [{ name: 'Reports', value: `${status('a')}\n${status('b')}` }],
      },
    ],
    components: [{ type: ROW, components: [{ type: BUTTON, style: STYLE.primary, label: 'Report result', custom_id: `rres:${f.id}`, emoji: { name: '🏆' } }] }],
    allowedMentions: ping ? { users: [f.a.id, f.b.id] } : noMentions,
  };
}

// The pop-up form: who won (a list) + the scoreboard screenshot (a required file upload).
export function reportModal(f) {
  return {
    title: `Game ${f.number} result`.slice(0, 45),
    custom_id: `rrm:${f.id}`,
    components: [
      {
        type: 18, // label
        label: 'Who won?',
        component: {
          type: 3, // string select
          custom_id: 'winner',
          required: true,
          options: [
            { label: short(f.a.name, 90), value: 'a' },
            { label: short(f.b.name, 90), value: 'b' },
          ],
        },
      },
      {
        type: 18,
        label: 'End-game scoreboard screenshot',
        description: 'Required: a picture of the final scoreboard.',
        component: { type: 19, custom_id: 'shot', min_values: 1, max_values: 1, required: true }, // file upload
      },
    ],
  };
}

export function reportPosted(f, side, winner, fileName) {
  return {
    content: `📸 **${esc(f[side].name)}** reported **${esc(f[winner].name)}** won.${fileName ? '' : ' (screenshot couldn’t be copied)'}`,
    embeds: [],
    components: [],
    allowedMentions: noMentions,
  };
}

export function disputeCard(f, config) {
  const roles = config.staffRoleIds.slice(0, 3);
  return {
    content: `${roles.map((r) => `<@&${r}>`).join(' ')} ⚠️ **Game ${f.number}** needs a decision: the players picked different winners.`.trim(),
    embeds: [
      {
        title: `Game ${f.number}: ${esc(f.a.name)} vs ${esc(f.b.name)} · disputed`,
        color: CORAL,
        description: `${esc(f.a.name)} says **${esc(f[f.reports.a?.winner]?.name)}** won.\n${esc(f.b.name)} says **${esc(f[f.reports.b?.winner]?.name)}** won.\nTheir screenshots are attached.`,
      },
    ],
    components: [
      {
        type: ROW,
        components: [
          { type: BUTTON, style: STYLE.primary, label: short(`${f.a.name} won`, 80), custom_id: `rstaff:${f.id}:a` },
          { type: BUTTON, style: STYLE.primary, label: short(`${f.b.name} won`, 80), custom_id: `rstaff:${f.id}:b` },
          { type: BUTTON, style: STYLE.secondary, label: 'Cancel fixture', custom_id: `rstaff:${f.id}:cancel` },
        ],
      },
    ],
    allowedMentions: { roles },
  };
}

export function disputeSettled(game) {
  return { content: `✅ Game ${game.number} settled by ${esc(game.decidedBy?.name ?? 'staff')}.`, components: [], allowedMentions: noMentions };
}

const changeLine = (game, side) => {
  const p = game.players[side];
  const c = game.changes[p.id];
  const sign = c.delta > 0 ? '+' : '−';
  return `${game.winner === side ? '🏆 ' : ''}**${esc(p.name)}** ${c.after} RP (${sign}${Math.abs(c.delta)})${c.placement ? ' · placement game' : ''}`;
};

// Posted in the staff results channel for every finished game (with the screenshots attached).
export function resultPost(game, config) {
  const w = game.players[game.winner];
  const l = game.players[game.winner === 'a' ? 'b' : 'a'];
  return {
    content: '',
    embeds: [
      {
        title: `Game ${game.number}: ${esc(w.name)} beat ${esc(l.name)}`,
        color: TEAL,
        description: `${changeLine(game, 'a')}\n${changeLine(game, 'b')}`,
        fields: [{ name: 'Decided by', value: game.decidedBy?.by === 'staff' ? `Staff (${esc(game.decidedBy.name)})` : 'Both players agreed', inline: true }],
        timestamp: new Date(game.endedAt).toISOString(),
      },
    ],
    components: [],
    allowedMentions: noMentions,
  };
}

export function closingNote(game) {
  return {
    content: `🏁 Result saved: **${esc(game.players[game.winner].name)}** won. These channels close in a few seconds. GG!`,
    allowedMentions: noMentions,
  };
}

export function cancelNote(f, reason) {
  return {
    content: '',
    embeds: [{ title: `Game ${f.number}: ${esc(f.a.name)} vs ${esc(f.b.name)} · cancelled`, color: GREY, description: `${reason}. No RP change.` }],
    components: [],
    allowedMentions: noMentions,
  };
}

// /rp
export function rpCard(record, rank, total, config) {
  if (!record.games) return { content: `**${esc(record.name)}** hasn't played a 1v1 yet. Everyone starts at **1000 RP**, with ${PLACEMENT_GAMES} placement games.`, embeds: [], allowedMentions: noMentions };
  const form = record.form ? record.form.split('').map((c) => (c === 'W' ? '🟩' : '🟥')).join('') : '—';
  return {
    content: '',
    embeds: [
      {
        title: `${esc(record.name)}: ${rpLabel(record)}`,
        color: isPlaced(record) ? PURPLE : YELLOW,
        fields: [
          { name: 'Rank', value: isPlaced(record) ? `#${rank} of ${total}` : 'after placements', inline: true },
          { name: 'Games', value: `${record.games} (${record.wins} W · ${record.losses} L)`, inline: true },
          { name: 'Last 5', value: form, inline: true },
        ],
      },
    ],
    allowedMentions: noMentions,
  };
}

// /rpleaderboard: placed players first by RP; players still placing listed under.
export function rpLeaderboard(records) {
  const placed = records.filter(isPlaced).sort((x, y) => y.rating - x.rating || y.wins - x.wins);
  const placing = records.filter((r) => r.games > 0 && !isPlaced(r));
  const medal = ['🥇', '🥈', '🥉'];
  const lines = placed.slice(0, 20).map((r, i) => `${medal[i] ?? `\`${String(i + 1).padStart(2)}\``} **${esc(r.name)}** ${r.rating} RP · ${r.wins}-${r.losses}`);
  return {
    content: '',
    embeds: [
      {
        title: '⚔️ 1v1 RP leaderboard',
        color: PURPLE,
        description: lines.join('\n') || 'Nobody has finished placements yet.',
        fields: placing.length ? [{ name: `Placing (${placing.length})`, value: placing.slice(0, 15).map((r) => `${esc(r.name)} · ${r.games}/${PLACEMENT_GAMES}`).join('\n') }] : [],
      },
    ],
    allowedMentions: noMentions,
  };
}

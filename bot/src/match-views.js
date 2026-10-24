// What the match thread messages look like (plain Discord JSON, like views.js).
import { esc } from './views.js';
import { setsText, NOT_A_PLAYER, STAT_KEYS, STAT_LABELS, lineNumbers } from './logic/matches.js';

const BLUE = 0x1438d8;
const TEAL = 0x16b3a3;
const CORAL = 0xff6b5b;
const YELLOW = 0xffe200;
const GREY = 0x8a90a8;
const ROW = 1;
const BUTTON = 2;
const SELECT = 3;
const STYLE = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 };
const noMentions = { parse: [] };
const short = (s, n = 30) => (String(s ?? '?').length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? '?'));
const validId = (id) => /^\d{15,22}$/.test(String(id ?? ''));

const teamName = (t) => t?.name ?? 'TBC';
export const stageLabel = (f) => f.label || (f.stage === 'playoffs' ? 'Finals' : f.order ? `Round ${f.order}` : 'Match');
export const threadName = (m) => `🏐 ${short(m.home?.shortName || teamName(m.home), 28)} vs ${short(m.away?.shortName || teamName(m.away), 28)} · ${short(stageLabel(m.f), 30)}`.slice(0, 100);

const score = (sets) => {
  let h = 0;
  let a = 0;
  for (const s of sets ?? []) { if (Number(s.home) > Number(s.away)) h++; else a++; }
  return `${h}–${a}`;
};
const setList = (sets) => (sets ?? []).map((s) => `${s.home}–${s.away}`).join(' · ');
export { score as scoreOf, setList as setsLine, esc as safeName };

// A squad as lines: 👑 captain first, Discord mentions where we know them (mentions inside an
// embed don't ping anyone).
function squadLines(squad) {
  if (!squad.length) return '*No players listed*';
  return squad.slice(0, 10).map((p) => `${p.captain ? '👑' : '▫️'} ${validId(p.discordId) ? `<@${p.discordId}>` : esc(p.displayName)}`).join('\n');
}

function voteLines(m, side) {
  const votes = side === 'home' ? m.votes.home : m.votes.away;
  if (!votes.length) return '⏳ *no vote yet*';
  const agreed = (v) => m.votes.pair && (m.votes.pair.home.id === v.id || m.votes.pair.away.id === v.id);
  return votes.slice(0, 4).map((v) => {
    const p = m.playersById[v.playerId];
    const who = `${p?.captain ? '👑 ' : ''}${esc(p?.displayName ?? v.playerId)}`;
    const shots = v.screenshotPaths?.length ? ` 📸${v.screenshotPaths.length > 1 ? `×${v.screenshotPaths.length}` : ''}` : '';
    return `${agreed(v) ? '✅' : '🗳️'} ${who}: **${score(v.sets)}** (${setList(v.sets)})${shots}${v.via === 'discord' ? '' : ' · site'}`;
  }).join('\n');
}

// The card at the top of the thread. m: { b, f, home, away, homeSquad, awaySquad, playersById,
// votes (tallyVotes), result, format, url, removed }
export function matchCard(m, config, { ping = false } = {}) {
  const done = Boolean(m.result);
  const disputed = !done && m.votes.status === 'disputed';
  const color = m.removed ? GREY : done ? TEAL : disputed ? CORAL : m.votes.status === 'waiting' ? YELLOW : BLUE;
  const head = `**${esc(stageLabel(m.f))}** · Best of ${m.format.bestOf} · sets to ${m.format.pointsPerSet}, win by ${m.format.winBy ?? 2}`;
  let description;
  if (m.removed) {
    description = `${head}\n\nThis match was taken off the schedule.`;
  } else if (done) {
    const r = m.result;
    const homeWon = (r.sets ?? []).filter((s) => Number(s.home) > Number(s.away)).length > (r.sets ?? []).length / 2;
    const winner = homeWon ? m.home : m.away;
    description = `${head}\n\n## 🏆 ${esc(teamName(winner))} win ${score(r.sets)}\n${r.forfeit ? 'Forfeit.' : `Sets: **${setList(r.sets)}**`}\n\n${r.statsStatus === 'pending' ? '📸 An admin will add everyone’s stats from the screenshots.' : '📊 Stats are on the site.'}`;
  } else {
    const status = {
      none: '⏳ Waiting for both teams to vote.',
      waiting: `⏳ Waiting for **${esc(teamName(m.votes.home.length ? m.away : m.home))}** to vote.`,
      disputed: '⚠️ **The scores don’t match.** Check them and vote again, or a captain can **Confirm** the other team’s score.',
      agreed: '✅ Both teams agree.',
    }[m.votes.status] ?? '';
    description = `${head}\n\n`
      + '🗳️ When you’ve played, **one player from each team** presses **Report score** and types the set scores. Both teams the same = the score goes live straight away.\n'
      + '👑 **Captains** can press **Confirm** to agree with the other team’s score.\n'
      + '📸 Attach the **end-of-match screenshot**: admins read everyone’s stats from it.\n\n'
      + status;
  }
  const fields = [
    { name: `🔵 ${short(teamName(m.home), 60)}`, value: squadLines(m.homeSquad), inline: true },
    { name: `🔴 ${short(teamName(m.away), 60)}`, value: squadLines(m.awaySquad), inline: true },
  ];
  if (!m.removed) {
    fields.push({ name: '🗳️ Votes', value: `**${esc(m.home?.shortName || teamName(m.home))}**\n${voteLines(m, 'home')}\n**${esc(m.away?.shortName || teamName(m.away))}**\n${voteLines(m, 'away')}`.slice(0, 1024), inline: false });
  }
  const buttons = [];
  if (!done && !m.removed) {
    buttons.push({ type: BUTTON, style: STYLE.primary, label: 'Report score', custom_id: `mt:vote:${m.id}`, emoji: { name: '🗳️' } });
    if (m.votes.home.length || m.votes.away.length) buttons.push({ type: BUTTON, style: STYLE.success, label: 'Confirm their score', custom_id: `mt:confirm:${m.id}`, emoji: { name: '👑' } });
  }
  if (m.url) buttons.push({ type: BUTTON, style: STYLE.link, label: 'Match page', url: m.url, emoji: { name: '🌐' } });
  const users = ping ? [...m.homeSquad, ...m.awaySquad].map((p) => String(p.discordId ?? '')).filter(validId) : [];
  return {
    content: ping && users.length ? `🏐 **Your match is on!** ${users.map((id) => `<@${id}>`).join(' ')}\nPlay it, then report the score here.` : '',
    embeds: [{
      author: { name: `I<3JVO MATCH · ${short(m.b.event.title, 80)}`, icon_url: config.siteUrl ? `${config.siteUrl}/icons/icon-192.png` : undefined },
      title: `${done && !m.removed ? '✅' : disputed ? '⚠️' : '🏐'} ${short(teamName(m.home), 80)}  vs  ${short(teamName(m.away), 80)}`.slice(0, 256),
      url: m.url || undefined,
      color,
      description: description.slice(0, 4000),
      fields,
      footer: { text: done ? 'Final score · GG!' : 'Votes on the site count too. Same scores from both teams = score confirmed.' },
    }],
    components: buttons.length ? [{ type: ROW, components: buttons }] : [],
    allowedMentions: ping ? { users: users.slice(0, 100) } : noMentions,
  };
}

// The "Report score" form: the set scores (typed, home team first) and up to 3 screenshots.
export function voteModal(m, existing) {
  const home = m.home?.shortName || teamName(m.home);
  return {
    title: `Report: ${short(home, 16)} vs ${short(m.away?.shortName || teamName(m.away), 16)}`.slice(0, 45),
    custom_id: `mtm:${m.id}`,
    components: [
      {
        type: 18, // label
        label: `Set scores (${short(home, 20)} first)`.slice(0, 45),
        description: `Best of ${m.format.bestOf}, sets to ${m.format.pointsPerSet}. Like: 10-7, 8-10, 12-10`.slice(0, 100),
        component: {
          type: 4, // text input
          custom_id: 'sets',
          style: 1,
          required: true,
          min_length: 3,
          max_length: 80,
          placeholder: '10-7, 8-10, 12-10',
          ...(existing?.sets?.length ? { value: setsText(existing.sets) } : {}),
        },
      },
      {
        type: 18,
        label: 'End-of-match screenshot',
        description: 'The stats screen (full screen, F12 in Steam). Admins read everyone’s stats from it.'.slice(0, 100),
        component: { type: 19, custom_id: 'shots', min_values: 0, max_values: 3, required: false }, // file upload
      },
    ],
  };
}

export function reminder(m, due, config) {
  const pings = due.userIds.map((id) => `<@${id}>`).join(' ');
  const text = due.disputed
    ? `⚠️ **Scores don’t match yet** (reminder ${due.n}/${config.matchRemindMax}). ${pings}\nCheck your set scores and press **Report score** again, or a 👑 captain can **Confirm** the other team’s score.`
    : `⏰ **Reminder ${due.n}/${config.matchRemindMax}:** no score yet for **${esc(teamName(m.home))} vs ${esc(teamName(m.away))}**. ${pings}\nWhen you’ve finished, press **Report score** on the card above (or vote on the site).`;
  return { content: text, allowedMentions: { users: due.userIds.slice(0, 100) } };
}

export function adminPing(m, config) {
  const roles = config.adminRoleIds.slice(0, 3);
  return {
    content: `🚨 ${roles.map((r) => `<@&${r}>`).join(' ')} **${esc(teamName(m.home))} vs ${esc(teamName(m.away))}** still has no confirmed score after ${config.matchRemindMax} reminders. An admin may need to enter it on the site.${m.url ? `\n${m.url.replace('/match/', '/admin/result/')}` : ''}`.trim(),
    allowedMentions: { roles },
  };
}

export function finalNote(m) {
  return {
    content: m.result
      ? `✅ **Final: ${esc(teamName(m.home))} ${score(m.result.sets)} ${esc(teamName(m.away))}** (${setList(m.result.sets)}). GG! This thread closes soon.`
      : '🗑️ This match was taken off the schedule, so this thread closes soon.',
    allowedMentions: noMentions,
  };
}

const statLine = (stats) => ['pts', 'spk', 'blk', 'ace', 'dig']
  .filter((k) => stats?.[k]?.value != null)
  .map((k) => `${stats[k].value} ${k.toUpperCase()}`).join(' · ');

// "Who's who?": in-game names from the end-of-match screen that staff couldn't match to anyone.
// rows: askRows(result): names still unknown first, then the ones answered in Discord
//   [{ i, name, stats, playerId, notPlayer }]. pings: Discord IDs of players the reading didn't place.
// choices: everyone a name could be (both squads): [{ id, displayName, teamName, captain, has }]
//   has = the in-game name of the line they're down for already (picking them moves them).
// image: the attached screenshot's file name (shown big, so players can see the real names:
// the reading can get them wrong).
// One drop-down per name (Discord allows 5 per message; more appear as these are answered).
export const WHO_MENUS = 5;
export function whoIsWho(m, rows, pings, { image = null, choices = [] } = {}) {
  if (!rows.length) {
    return { content: '✅ **Who’s who: all sorted.** Thanks! Staff will check the stats.', embeds: [], components: [], allowedMentions: noMentions };
  }
  const open = rows.filter((r) => !r.playerId && !r.notPlayer);
  const shown = rows.slice(0, WHO_MENUS);
  const nameOf = (id) => choices.find((p) => p.id === id)?.displayName ?? id;
  const menus = shown.map((r) => ({
    type: ROW,
    components: [{
      type: SELECT,
      custom_id: `mt:who:${m.id}:${r.i}`,
      placeholder: short(`Who is ${r.name}?${statLine(r.stats) ? ` (${statLine(r.stats)})` : ''}`, 150),
      min_values: 1,
      max_values: 1,
      options: [
        ...choices.slice(0, 24).map((p) => ({
          label: short(`${r.playerId === p.id ? `${r.name} = ` : ''}${p.displayName ?? p.id}`, 100),
          value: p.id,
          description: short([p.teamName, p.has && r.playerId !== p.id ? `has: ${p.has}` : ''].filter(Boolean).join(' · '), 100) || undefined,
          ...(p.captain ? { emoji: { name: '👑' } } : {}),
          ...(r.playerId === p.id ? { default: true } : {}),
        })),
        { label: short(`${r.notPlayer ? `${r.name} = ` : ''}Not a real player / a bot`, 100), value: NOT_A_PLAYER, emoji: { name: '🤖' }, ...(r.notPlayer ? { default: true } : {}) },
      ],
    }],
  }));
  const line = (r) => {
    const answer = r.notPlayer ? ' → 🤖 not a player' : r.playerId ? ` → ✅ ${esc(nameOf(r.playerId))}` : '';
    return `• **${esc(r.name)}**${statLine(r.stats) ? `: ${statLine(r.stats)}` : ''}${answer}`;
  };
  const more = rows.length > shown.length ? `\n*${rows.length - shown.length} more appear once these are answered.*` : '';
  const head = open.length
    ? 'Staff couldn’t match these in-game (Steam) names from the end-of-match screen to anyone:'
    : '✅ **Every name has an answer.** Thanks! Staff will check them. Wrong one? Change it below.';
  return {
    content: pings.length ? `❓ ${pings.map((id) => `<@${id}>`).join(' ')} who’s who on the end screen?` : '',
    embeds: [{
      title: open.length ? '❓ Who’s who?' : '✅ Who’s who',
      color: open.length ? YELLOW : TEAL,
      description: `${head}\n\n${rows.slice(0, 10).map(line).join('\n')}${more}\n\nThe names are read automatically and can come out wrong, so check the screenshot${image ? ' below' : ''} and go by the stats. **Pick who each one is** in the menus, for yourself or a team-mate. Picked the wrong person? Pick again: it moves. Staff check it before the stats count.`,
      ...(image ? { image: { url: `attachment://${image}` } } : {}),
    }],
    components: menus,
    allowedMentions: { users: pings.slice(0, 100) },
  };
}

// ---------- "📊 Check your stats": players confirm or fix their own line ----------
// A neat table per team (squad order, captain first): ✅ confirmed, ✏️ fixed by a player, ⏳ to
// check, ⚠️ not on the screenshot. pings: Discord IDs of players still to confirm (first post only).
const pad = (s, n) => String(s).padStart(n);
function teamTable(squad, rows) {
  const byPlayer = new Map(rows.filter((r) => r.playerId && !r.notPlayer).map((r) => [r.playerId, r]));
  const head = `       ${STAT_LABELS.map((l) => pad(l, 3)).join(' ')}`;
  const lines = squad.slice(0, 8).map((p) => {
    const r = byPlayer.get(p.id);
    const mark = !r ? '⚠️' : r.editedBy ? '✏️' : r.confirmedBy ? '✅' : '⏳';
    const name = `${p.captain ? '👑' : ''}${String(p.displayName ?? p.id)}`.slice(0, 22);
    if (!r) return `${mark} **${esc(name)}**: not on the screenshot`;
    return `${mark} **${esc(name)}**\n\`${STAT_KEYS.map((k) => pad(r.stats?.[k]?.value ?? '?', 3)).join(' ')}\``;
  });
  return { head: `\`${head.trimStart()}\``, body: lines.join('\n') || '*No players listed*' };
}

export function statsCheck(m, rows, pings = []) {
  const home = teamTable(m.homeSquad, rows);
  const away = teamTable(m.awaySquad, rows);
  const onShot = rows.filter((r) => r.playerId && !r.notPlayer);
  const confirmed = onShot.filter((r) => r.confirmedBy).length;
  const allDone = onShot.length > 0 && confirmed === onShot.length;
  return {
    content: pings.length ? `📊 ${pings.map((id) => `<@${id}>`).join(' ')} check your stats from the end screen and press **✅ My line is right** (or fix it).` : '',
    embeds: [{
      title: allDone ? '📊 Stats: all confirmed ✅' : `📊 Check your stats (${confirmed}/${onShot.length} confirmed)`,
      color: allDone ? TEAL : BLUE,
      description: `Read from the end-of-match screenshot. **Check your own line**: right → **✅ My line is right**, wrong → **✏️ Fix a line**. 👑 Captains can confirm or fix anyone in their club. Staff submit them once you’re done.\n${home.head}`,
      fields: [
        { name: `🔵 ${short(m.home?.name ?? 'Home', 60)}`, value: home.body.slice(0, 1024), inline: false },
        { name: `🔴 ${short(m.away?.name ?? 'Away', 60)}`, value: away.body.slice(0, 1024), inline: false },
      ],
      footer: { text: '✅ confirmed · ✏️ fixed by a player · ⏳ to check · ⚠️ not on the screenshot' },
    }],
    components: allDone ? [{ type: ROW, components: [{ type: BUTTON, style: STYLE.secondary, label: 'Fix a line', custom_id: `mt:fix:${m.id}`, emoji: { name: '✏️' } }] }] : [{
      type: ROW,
      components: [
        { type: BUTTON, style: STYLE.success, label: 'My line is right', custom_id: `mt:ok:${m.id}`, emoji: { name: '✅' } },
        { type: BUTTON, style: STYLE.secondary, label: 'Fix a line', custom_id: `mt:fix:${m.id}`, emoji: { name: '✏️' } },
        { type: BUTTON, style: STYLE.primary, label: 'Confirm my team', custom_id: `mt:team:${m.id}`, emoji: { name: '👑' } },
      ],
    }],
    allowedMentions: { users: pings.slice(0, 100) },
  };
}

// The "Fix a line" form: whose line (players: just their own; captains: their club) and the numbers.
// choices: [{ id, displayName }], current: Map playerId -> "12 5 1 ..." (prefilled when there's one choice).
export function fixModal(m, choices, current) {
  const only = choices.length === 1 ? choices[0] : null;
  return {
    title: `Fix stats: ${short(m.home?.shortName || m.home?.name, 14)} v ${short(m.away?.shortName || m.away?.name, 14)}`.slice(0, 45),
    custom_id: `mtf:${m.id}`,
    components: [
      {
        type: 18,
        label: 'Whose line?',
        component: {
          type: SELECT,
          custom_id: 'who',
          required: true,
          options: choices.slice(0, 25).map((p) => ({ label: short(p.displayName ?? p.id, 100), value: p.id, description: short(`now: ${current.get(p.id) ?? '?'}`, 100), ...(only ? { default: true } : {}) })),
        },
      },
      {
        type: 18,
        label: `The ${STAT_KEYS.length} numbers, in order`,
        description: STAT_LABELS.join(' · ').slice(0, 100),
        component: {
          type: 4,
          custom_id: 'nums',
          style: 1,
          required: true,
          max_length: 60,
          placeholder: '12 5 1 3 2 1 0 4',
          ...(only && current.get(only.id) ? { value: current.get(only.id) } : {}),
        },
      },
    ],
  };
}

export function voteSaved({ agreed, disputed, otherName }) {
  if (agreed) return '✅ Saved, and it matches the other team’s vote: **the score is live** on the site.';
  if (disputed) return `🗳️ Saved, but it doesn’t match **${esc(otherName)}**’s vote. Double-check the scores, or an admin will decide.`;
  return `🗳️ Saved. The score goes live as soon as a player from **${esc(otherName)}** votes the same.`;
}

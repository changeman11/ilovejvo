// Match threads: the pure parts (no Discord, no Firebase), tested in tests/matches-logic.test.mjs.
// The site's own rules (site-rules/, copied from public/js/rules/) decide when a match opens and
// whether votes agree, so the bot and the site always say the same thing.
import { matchState } from '../site-rules/flow.js';
import { tallyVotes, sameSets, resultFromVotes } from '../site-rules/votes.js';
import { checkResult } from '../site-rules/match.js';
import { formatFor } from '../site-rules/season.js';
import { DEFAULT_FORMAT, DEFAULT_STATS } from '../site-rules/defaults.js';

export const threadDocId = (eventId, fixtureId) => `${eventId}__${fixtureId}`;

// The engine's "season" for an event (the same as engineSeason() in public/js/data.js).
export const seasonOf = (event) => ({ format: { ...DEFAULT_FORMAT, ...(event?.matchFormat ?? {}) } });
export const formatOf = (b, f) => formatFor(seasonOf(b.event), f);

export const isApprovedTeam = (t) => Boolean(t) && (t.status ?? 'approved') === 'approved';

// "10-7, 8-10, 12-10" (also "10 7 / 8 10", "10–7; 8–10", one per line...) -> [{ home, away }]
// Home team's points first. Returns { sets } or { error }.
export function parseSets(text) {
  const parts = String(text ?? '').split(/[,;/\n|]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { error: 'Type the set scores, e.g. 10-7, 8-10, 12-10' };
  const sets = [];
  for (const part of parts) {
    const m = /^(\d{1,2})\s*(?:[-–—:x]|\s)\s*(\d{1,2})$/i.exec(part);
    if (!m) return { error: `"${part}" isn't a set score. Write each set like 10-7, home team first.` };
    sets.push({ home: Number(m[1]), away: Number(m[2]) });
  }
  return { sets };
}

// Checks typed scores against the match's format. -> { sets } or { error }
export function readScore(text, format) {
  const parsed = parseSets(text);
  if (parsed.error) return parsed;
  const check = checkResult(parsed.sets, format);
  if (!check.ok) return { error: `Check the scores: ${check.errors[0]}.` };
  return { sets: parsed.sets };
}

// "10-7, 8-10, 12-10" for a vote's sets (what the form shows to edit).
export const setsText = (sets) => (sets ?? []).map((s) => `${s.home}-${s.away}`).join(', ');

// The club's captain (manager): the player whose id is managerPlayerId, or whose sign-in is managerUid.
export function captainOf(team, players) {
  if (!team) return null;
  return players.find((p) => p.id === team.managerPlayerId && p.teamId === team.id)
    ?? players.find((p) => team.managerUid && p.uid === team.managerUid && p.teamId === team.id)
    ?? null;
}

export const isCaptain = (team, player) => Boolean(team && player
  && ((team.managerPlayerId && team.managerPlayerId === player.id) || (team.managerUid && team.managerUid === player.uid)));

// A Discord user's site profile: the one with their Discord ID (preferring one that's signed in
// on the site and in a club).
export function profileOf(discordId, players) {
  const mine = players.filter((p) => String(p.discordId ?? '') === String(discordId));
  return mine.find((p) => p.uid && p.teamId) ?? mine.find((p) => p.uid) ?? mine[0] ?? null;
}

// The squad, captain first. -> [{ ...player, captain }]
export function squadOf(teamId, team, players) {
  return players
    .filter((p) => p.teamId === teamId)
    .map((p) => ({ ...p, captain: isCaptain(team, p) }))
    .sort((x, y) => Number(y.captain) - Number(x.captain) || String(x.displayName ?? '').localeCompare(String(y.displayName ?? '')));
}

const discordIds = (squad) => squad.map((p) => String(p.discordId ?? '')).filter((id) => /^\d{15,22}$/.test(id));

// Matches that should have a thread right now: saved, both teams known, open for votes
// (rules/flow.js: started, not paused, earlier matches done, no result yet).
export function openMatches(b, now) {
  return b.fixtures
    .filter((f) => !f.virtual && f.homeTeamId && f.awayTeamId)
    .filter((f) => matchState(b, f, now).state === 'open');
}

// Who to ping in a reminder, or null if it isn't time.
//   thread: { prompts, lastPromptAt, createdAt }, votes: tallyVotes(...) for the match
//   -> { who: 'missing' | 'both', userIds: [...], disputed, n } or { admins: true } or null
export function reminderDue({ thread, votes, home, away, now, everyMinutes, max }) {
  const last = thread.lastPromptAt ?? thread.createdAt ?? 0;
  if (now - last < everyMinutes * 60000) return null;
  if ((thread.prompts ?? 0) >= max) return thread.adminPingedAt ? null : { admins: true };
  const disputed = votes.status === 'disputed';
  let squads;
  if (disputed) squads = [home, away]; // both teams need to sort it out
  else squads = [votes.home.length ? null : home, votes.away.length ? null : away].filter(Boolean);
  const userIds = squads.flatMap(discordIds);
  if (!userIds.length) return null;
  return { who: disputed ? 'both' : 'missing', userIds, disputed, n: (thread.prompts ?? 0) + 1 };
}

// A vote document as the site saves it (events/{e}/submissions/{fixtureId}__{playerId}), made
// from the Discord form. updatedAt is set by the server as it saves.
export function voteDoc({ fixture, player, sets, screenshotPaths, existing, botUid, now }) {
  return {
    fixtureId: fixture.id,
    playerId: player.id,
    uid: player.uid,
    teamId: player.teamId,
    sets: sets.map((s) => ({ home: Number(s.home), away: Number(s.away) })),
    playerStats: {},
    screenshotPaths: screenshotPaths ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedBy: botUid,
    via: 'discord',
  };
}

// If this vote agrees with one from the other team: the score to publish (as the site would).
export function agreedResult({ b, fixture, vote, voteId, subs }) {
  const other = vote.teamId === fixture.homeTeamId ? fixture.awayTeamId : fixture.homeTeamId;
  const match = subs
    .filter((s) => s.fixtureId === fixture.id && s.teamId === other)
    .sort((x, y) => (y.updatedAt ?? 0) - (x.updatedAt ?? 0))
    .find((s) => sameSets(s.sets, vote.sets));
  if (!match) return null;
  const mine = { ...vote, id: voteId };
  const pair = vote.teamId === fixture.homeTeamId ? { home: mine, away: match } : { home: match, away: mine };
  return resultFromVotes(pair, fixture, formatOf(b, fixture));
}

// The newest vote from the other team that this captain hasn't already matched (for "Confirm").
export function toConfirm({ fixture, teamId, subs }) {
  const ours = subs.filter((s) => s.fixtureId === fixture.id && s.teamId === teamId);
  return subs
    .filter((s) => s.fixtureId === fixture.id && s.teamId && s.teamId !== teamId && (s.teamId === fixture.homeTeamId || s.teamId === fixture.awayTeamId))
    .filter((s) => !ours.some((o) => sameSets(o.sets, s.sets)))
    .sort((x, y) => (y.updatedAt ?? 0) - (x.updatedAt ?? 0))[0] ?? null;
}

// ---------- Unknown in-game names (the site's automatic stats reading, result.statsDraft) ----------
// Rows of the reading that no player was matched to: [{ i, name, stats }]. Only while staff
// haven't checked the stats yet (statsStatus 'pending'). Short names with nothing but zeros are
// left out: they're empty slots or bots on the end screen, not someone to ask about.
export function unknownNames(result) {
  if (result?.statsStatus !== 'pending' || !Array.isArray(result.statsDraft?.rows)) return [];
  const scored = (stats) => Object.values(stats ?? {}).some((c) => Number(c?.value) > 0);
  return result.statsDraft.rows
    .map((r, i) => ({ i, name: String(r.name ?? '').trim(), stats: r.stats ?? {}, playerId: r.playerId, notPlayer: r.notPlayer }))
    .filter((r) => !r.playerId && !r.notPlayer && r.name && (r.name.length >= 3 || scored(r.stats)))
    .map(({ playerId, notPlayer, ...r }) => r);
}

// Value of the "not a real player / a bot" choice in the who's who menus.
export const NOT_A_PLAYER = '__none__';

// ---------- Players confirm their own stats (result.statsDraft) ----------
// Each read line that's down as a player can be confirmed (✅) or fixed (✏️) by that player, or by
// their club's captain for anyone in the club; staff can do any. Staff then submit them from a list.
export const STAT_KEYS = DEFAULT_STATS.map((s) => s.key);
export const STAT_LABELS = DEFAULT_STATS.map((s) => s.label);

// "12 5 1 3 2 1 0 4" (or with commas) -> { pts: 12, spk: 5, ... } in STAT_KEYS order, or { error }.
export function parseStatLine(text) {
  const nums = String(text ?? '').trim().split(/[\s,;/|]+/).filter(Boolean);
  if (nums.length !== STAT_KEYS.length || nums.some((n) => !/^\d{1,3}$/.test(n))) {
    return { error: `Type all ${STAT_KEYS.length} numbers in order (${STAT_LABELS.join(' ')}), e.g. 12 5 1 3 2 1 0 4.` };
  }
  return { stats: Object.fromEntries(STAT_KEYS.map((k, i) => [k, Number(nums[i])])) };
}

export const lineNumbers = (row) => STAT_KEYS.map((k) => (row?.stats?.[k]?.value ?? '?')).join(' ');

// Who may confirm or fix the line of `playerId`: that player, their club's captain, or staff.
export function canEditLine({ playerId, editor, isStaff = false, teams, players }) {
  if (isStaff) return true;
  if (!editor) return false;
  if (editor.id === playerId) return true;
  const player = players.find((p) => p.id === playerId);
  const team = teams.get(player?.teamId);
  return Boolean(team && player.teamId === editor.teamId && isCaptain(team, editor));
}

// ✅ Confirm: the editor's own line, or (captain) every line in their club, or (staff) every line.
//   -> { rows, count } or { error }
export function confirmLines({ result, editor, isStaff = false, whole = false, teams, players, teamIds }) {
  const rows = result?.statsDraft?.rows;
  if (result?.statsStatus !== 'pending' || !Array.isArray(rows)) return { error: 'Staff have already submitted this match’s stats.' };
  const by = String(editor?.discordId ?? 'staff');
  const mine = (r) => r.playerId && !r.notPlayer && (whole
    ? isStaff || canEditLine({ playerId: r.playerId, editor, isStaff, teams, players })
    : r.playerId === editor?.id);
  if (whole && !isStaff) {
    const team = teams.get(editor?.teamId);
    if (!team || !isCaptain(team, editor) || !teamIds.includes(team.id)) return { error: '👑 Only a team’s captain can confirm the whole team.' };
  }
  const targets = rows.map((r, i) => (mine(r) ? i : -1)).filter((i) => i >= 0);
  if (!targets.length) {
    return { error: whole ? 'None of your team’s lines are on the reading yet.' : 'Your line isn’t on the reading (or isn’t matched to you yet). Check “Who’s who” above, or ask your captain.' };
  }
  return { rows: rows.map((r, i) => (targets.includes(i) ? { ...r, confirmedBy: by } : r)), count: targets.length };
}

// ✏️ Fix: new numbers for one player's line (marked edited and confirmed by the editor).
export function fixLine({ result, playerId, stats, editor, isStaff = false, teams, players }) {
  const rows = result?.statsDraft?.rows;
  if (result?.statsStatus !== 'pending' || !Array.isArray(rows)) return { error: 'Staff have already submitted this match’s stats.' };
  if (!canEditLine({ playerId, editor, isStaff, teams, players })) return { error: 'You can fix your own line, or (👑 captains) anyone in your club.' };
  const i = rows.findIndex((r) => r.playerId === playerId);
  if (i < 0) return { error: 'That player isn’t on the reading. Sort out “Who’s who” first.' };
  const by = String(editor?.discordId ?? 'staff');
  const next = { ...rows[i], stats: Object.fromEntries(STAT_KEYS.map((k) => [k, { value: stats[k], sure: true }])), editedBy: by, confirmedBy: by };
  return { rows: rows.map((r, j) => (j === i ? next : r)) };
}

// How far along a match's stats are: { lines, confirmed, edited, unknown }.
export function confirmProgress(result) {
  const rows = (result?.statsDraft?.rows ?? []).filter((r) => r.playerId && !r.notPlayer);
  return {
    lines: rows.length,
    confirmed: rows.filter((r) => r.confirmedBy).length,
    edited: rows.filter((r) => r.editedBy).length,
    unknown: unknownNames(result).length,
  };
}

// ---------- Screenshots posted in the thread ----------
// A match whose score is in but which has no end-of-match screenshot anywhere (no vote has one,
// none were copied from the thread yet) and whose stats aren't done: the bot looks in its thread.
export function needsScreenshot(result, subs) {
  if (!result || result.forfeit) return false;
  if (result.statsStatus === 'reviewed' || Object.keys(result.playerStats ?? {}).length) return false;
  if ((result.threadShots ?? []).length || result.statsDraft?.shot) return false;
  return !subs.some((s) => s.screenshotPaths?.length);
}

// Answered in Discord (who's who): this row's answer came from a player or staff, not the reading.
const answered = (r) => Boolean(r.answeredBy || r.claimedBy);

// The rows the who's who message shows a drop-down for: names still unknown first, then the ones
// answered in Discord (so a wrong answer can be changed). Rows the reading matched by itself are
// left to staff on the site. -> [{ i, name, stats, playerId, notPlayer }]
export function askRows(result) {
  if (result?.statsStatus !== 'pending' || !Array.isArray(result.statsDraft?.rows)) return [];
  const unknown = unknownNames(result);
  const done = result.statsDraft.rows
    .map((r, i) => ({ i, name: String(r.name ?? '').trim(), stats: r.stats ?? {}, playerId: r.playerId ?? null, notPlayer: Boolean(r.notPlayer), answered: answered(r) }))
    .filter((r) => r.answered && (r.playerId || r.notPlayer))
    .map(({ answered: _, ...r }) => r);
  return [...unknown.map((r) => ({ ...r, playerId: null, notPlayer: false })), ...done];
}

// Someone answers "who is row i?" (for themselves or a team-mate, or staff for anyone). An answer
// given in Discord can be changed the same way. Picking a player who already has another line
// moves them here, and that other line goes back to "who is?".
//   playerId: the player picked, or NOT_A_PLAYER. answerer: the asker's site profile (or null).
//   -> { rows (the new reading rows), movedFrom (the other line's name, or null) } or { error }
export function answerRow({ result, i, playerId, answerer, isStaff = false, teamIds, players }) {
  const rows = result?.statsDraft?.rows;
  if (result?.statsStatus !== 'pending' || !Array.isArray(rows)) return { error: 'Staff have already checked this match’s stats.' };
  if (!isStaff && !teamIds.includes(answerer?.teamId)) {
    return { error: answerer ? 'Only players from the two teams in this match (or staff) can answer.' : 'Your Discord isn’t linked to an I<3JVO profile yet, so the bot can’t tell who you are.' };
  }
  const row = rows[i];
  if (!row) return { error: 'That line isn’t on the reading any more.' };
  if ((row.playerId || row.notPlayer) && !answered(row)) return { error: 'The reading matched that line by itself. If it’s wrong, tell staff: they can fix it on the site.' };
  const by = String(answerer?.discordId ?? '');
  const clear = (r) => {
    const { playerId: _p, notPlayer: _n, answeredBy: _a, claimedBy: _c, confirmedBy: _k, editedBy: _e, ...rest } = r;
    return { ...rest, playerId: null };
  };
  if (playerId === NOT_A_PLAYER) {
    if (row.notPlayer) return { error: 'That one is already marked as not a real player.' };
    return { rows: rows.map((r, j) => (j === i ? { ...clear(r), notPlayer: true, answeredBy: by } : r)), movedFrom: null };
  }
  const player = players.find((p) => p.id === playerId);
  if (!player || !teamIds.includes(player.teamId)) return { error: 'Pick a player from one of the two teams.' };
  if (row.playerId === playerId) return { error: `That line is already down as ${player.displayName ?? 'them'}.` };
  const other = rows.findIndex((r, j) => j !== i && r.playerId === playerId);
  return {
    rows: rows.map((r, j) => (j === i ? { ...clear(r), playerId, answeredBy: by } : j === other ? clear(r) : r)),
    movedFrom: other >= 0 ? String(rows[other].name ?? '') : null,
  };
}

// Who to ask: players on either team that the reading didn't find (with a Discord ID).
export function unplacedPlayers(result, homeSquad, awaySquad) {
  const placed = new Set((result?.statsDraft?.rows ?? []).map((r) => r.playerId).filter(Boolean));
  return [...homeSquad, ...awaySquad].filter((p) => !placed.has(p.id) && /^\d{15,22}$/.test(String(p.discordId ?? '')));
}

// A player says "that's me" for row i. -> { rows } (the new reading rows) or { error }
export function claimRow({ result, i, profile, teamIds }) {
  const rows = result?.statsDraft?.rows;
  if (result?.statsStatus !== 'pending' || !Array.isArray(rows)) return { error: 'Staff have already checked this match’s stats.' };
  if (!profile) return { error: 'Your Discord isn’t linked to an I<3JVO profile yet, so the bot can’t tell who you are.' };
  if (!teamIds.includes(profile.teamId)) return { error: 'Only players from the two teams in this match can claim a line.' };
  const row = rows[i];
  if (!row) return { error: 'That line isn’t on the reading any more.' };
  if (row.playerId === profile.id) return { error: 'That line is already yours.' };
  if (row.playerId) return { error: 'Someone has already claimed that line. Tell staff if it’s wrong.' };
  if (rows.some((r) => r.playerId === profile.id)) return { error: 'You already have a line on this screenshot. If it’s the wrong one, tell staff.' };
  return { rows: rows.map((r, j) => (j === i ? { ...r, playerId: profile.id, claimedBy: String(profile.discordId ?? '') } : r)) };
}

export { tallyVotes, matchState, checkResult };

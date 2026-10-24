// Match threads: the pure parts (no Discord, no Firebase), tested in tests/matches-logic.test.mjs.
// The site's own rules (site-rules/, copied from public/js/rules/) decide when a match opens and
// whether votes agree, so the bot and the site always say the same thing.
import { matchState } from '../site-rules/flow.js';
import { tallyVotes, sameSets, resultFromVotes } from '../site-rules/votes.js';
import { checkResult } from '../site-rules/match.js';
import { formatFor } from '../site-rules/season.js';
import { DEFAULT_FORMAT } from '../site-rules/defaults.js';

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

export { tallyVotes, matchState, checkResult };

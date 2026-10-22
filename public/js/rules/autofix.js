// Club sign-ups, self-adjusting fixtures and finals for an event. Pure functions, no Firebase.
//
// - Clubs sign themselves up (events/{id}/entries/{teamId}) until 10 minutes before the start.
// - With auto fixtures on, the round robin is worked out from whoever has signed up, so it changes
//   as clubs join or pull out. 10 minutes before the start it locks; the next admin browser to see
//   the event saves it (ids "auto-r<round>-<home>-<away>", the same ids shown before saving).
// - Finals (optional): a final between the top 2, or semi-finals 1v4 / 2v3 and a grand final.
//   Seeds come from the event table once every group match has a result; the final waits for the
//   semi-final winners. Finals are saved as soon as both teams are known (ids "finals-<slot>").
//
// Fixtures that are only worked out (not saved yet) carry `virtual: true`. Results can only be
// reported on saved fixtures.

import { roundRobin, missingGames } from './schedule.js';
import { computeStandings } from './standings.js';
import { checkResult } from './match.js';
import { formatFor, isPlayoff } from './season.js';

export const LOCK_MINUTES = 10;
export const AUTO_MODES = { off: 'Off: I’ll add fixtures myself', once: 'Round robin: everyone plays once', double: 'Round robin: home & away' };
export const FINALS_TYPES = { none: 'No finals', final: 'Final: 1st v 2nd', semis: 'Semi-finals (1v4, 2v3), then a grand final' };

// When sign-ups close and the fixtures lock (ms), or null when the event has no start time yet.
export function lockTime(event) {
  return event?.date && !event.timeTbd ? event.date - LOCK_MINUTES * 60000 : null;
}

// Fixtures are fixed once an admin locked them, the event isn't upcoming, or it's 10 minutes to go.
export function isLocked(event, now = Date.now()) {
  if (event?.fixturesLockedAt) return true;
  if ((event?.status ?? 'upcoming') !== 'upcoming') return true;
  const t = lockTime(event);
  return t != null && now >= t;
}

export function signupsOpen(event, now = Date.now()) {
  return Boolean(event?.published && event?.signups) && !isLocked(event, now);
}

// Teams in the event: the ones an admin added, then clubs in the order they signed up.
export function entrantIds(event, entries = []) {
  const signed = [...entries]
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || String(a.teamId).localeCompare(String(b.teamId)))
    .map((e) => e.teamId);
  return [...new Set([...(event?.teamIds ?? []), ...signed])];
}

// The round robin for these teams, as fixtures.
export function groupFixtures(event, teamIds) {
  const mode = event?.autoFixtures;
  if (mode !== 'once' && mode !== 'double') return [];
  return roundRobin(teamIds, { double: mode === 'double' }).map((g, i) => ({
    id: `auto-r${g.round}-${g.homeTeamId}-${g.awayTeamId}`,
    label: `Round ${g.round}`,
    homeTeamId: g.homeTeamId,
    awayTeamId: g.awayTeamId,
    scheduledAt: event.date ?? null,
    timeTbd: true,
    bestOf: null,
    order: g.round * 100 + i,
    status: 'scheduled',
    auto: true,
  }));
}

const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

// The finals slots for the event's settings.
export function finalsSlots(event) {
  const f = event?.finals ?? {};
  const semiBestOf = f.semiBestOf ?? 3;
  const finalBestOf = f.finalBestOf ?? 5;
  if (f.type === 'final') return [{ slot: 'final', label: 'Final', homeSeed: 1, awaySeed: 2, bestOf: finalBestOf }];
  if (f.type === 'semis') {
    return [
      { slot: 'sf1', label: 'Semi-final 1', homeSeed: 1, awaySeed: 4, bestOf: semiBestOf },
      { slot: 'sf2', label: 'Semi-final 2', homeSeed: 2, awaySeed: 3, bestOf: semiBestOf },
      { slot: 'final', label: 'Grand final', homeFrom: 'sf1', awayFrom: 'sf2', bestOf: finalBestOf },
    ];
  }
  return [];
}

const neededTeams = (event) => ({ final: 2, semis: 4 }[event?.finals?.type] ?? 0);

function winnerOf(fixture, results, season) {
  const r = fixture && results[fixture.id];
  if (!r || !fixture.homeTeamId || !fixture.awayTeamId) return null;
  const check = checkResult(r.sets, formatFor(season, fixture));
  if (!check.ok) return null;
  return check.winner === 'home' ? fixture.homeTeamId : fixture.awayTeamId;
}

// Everything about an event's schedule right now.
// event, season: as in a bundle (dates in ms). entries: [{ teamId, createdAt }].
// fixtures: the saved fixtures. results: { [fixtureId]: result }.
// Returns {
//   teamIds, locked, open,
//   virtual:   fixtures to show that aren't saved yet,
//   toSave:    fixtures an admin browser should save now (locked round robin, finals with both teams),
//   lockGroup: true when saving `toSave` also fixes the round robin (sets fixturesLockedAt),
//   finalsNote: why finals can't be shown (e.g. not enough teams), or null
// }
export function schedulePlan({ event, season, entries = [], fixtures = [], results = {}, now = Date.now() }) {
  const teamIds = entrantIds(event, entries);
  const locked = isLocked(event, now);
  const saved = new Map(fixtures.map((f) => [f.id, f]));
  const virtual = [];
  const toSave = [];
  let lockGroup = false;

  // Round robin (until it has been saved once).
  if (!event?.fixturesLockedAt) {
    const manual = fixtures.filter((f) => !f.auto && !isPlayoff(f));
    const wanted = groupFixtures(event, teamIds).filter((f) => !saved.has(f.id));
    // Skip matchups an admin already added by hand.
    const fresh = missingGames(wanted, manual);
    virtual.push(...fresh.map((f) => ({ ...f, virtual: true })));
    if (locked && event?.autoFixtures && event.autoFixtures !== 'off') {
      toSave.push(...fresh);
      lockGroup = true;
    }
  }

  // Finals.
  const slots = finalsSlots(event);
  let finalsNote = null;
  if (slots.length) {
    if (teamIds.length < neededTeams(event)) {
      finalsNote = `Finals need at least ${neededTeams(event)} teams.`;
    } else {
      const group = [...fixtures.filter((f) => !isPlayoff(f)), ...virtual];
      const groupDone = group.length > 0 && group.every((f) => winnerOf(f, results, season) != null);
      let seeds = null;
      if (groupDone) {
        const table = computeStandings({ teams: teamIds.map((id) => ({ id, name: id })), fixtures: group, results, season });
        seeds = table.rows.map((r) => r.teamId);
      }
      const bySlot = {};
      for (const s of slots) {
        const id = `finals-${s.slot}`;
        const existing = saved.get(id);
        if (existing) { bySlot[s.slot] = existing; continue; }
        const from = (slot) => winnerOf(bySlot[slot], results, season);
        const home = s.homeSeed ? seeds?.[s.homeSeed - 1] ?? null : from(s.homeFrom);
        const away = s.awaySeed ? seeds?.[s.awaySeed - 1] ?? null : from(s.awayFrom);
        const fixture = {
          id,
          label: s.label,
          homeTeamId: home,
          awayTeamId: away,
          homePlaceholder: s.homeSeed ? `${ordinal(s.homeSeed)} place` : `Winner ${s.homeFrom === 'sf1' ? 'SF1' : 'SF2'}`,
          awayPlaceholder: s.awaySeed ? `${ordinal(s.awaySeed)} place` : `Winner ${s.awayFrom === 'sf1' ? 'SF1' : 'SF2'}`,
          scheduledAt: event?.date ?? null,
          timeTbd: true,
          bestOf: s.bestOf,
          order: 100000 + slots.indexOf(s),
          status: 'scheduled',
          stage: 'playoffs',
          finalSlot: s.slot,
        };
        bySlot[s.slot] = fixture;
        virtual.push({ ...fixture, virtual: true });
        if (home && away) toSave.push(fixture);
      }
    }
  }

  return { teamIds, locked, open: signupsOpen(event, now), virtual, toSave, lockGroup, finalsNote };
}

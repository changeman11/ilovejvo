// Club sign-ups, self-adjusting fixtures, group stages and knockouts for an event. Pure functions.
//
// - Clubs sign themselves up (events/{id}/entries/{teamId}) until 10 minutes before the start.
// - Groups (event.groups.count, 1 = no groups): teams are drawn into groups A, B, C... An admin can
//   place teams by hand (event.groups.assign); everyone else is drawn automatically: a random draw
//   that stays the same each time (worked out from the event and team ids), keeping groups even.
// - With auto fixtures on, a round robin is worked out inside each group from whoever has signed up,
//   so it changes as clubs join or pull out. 10 minutes before the start it locks; the next admin
//   browser saves it, and the draw is saved too (event.groups.assign) so it can't change afterwards.
//   Ids: "auto-r<round>-<home>-<away>" without groups, "auto-g<letter>-r<round>-<home>-<away>" with.
// - Knockout (event.finals.type): none, final (top 2), semis (top 4) or quarters (top 8).
//   Qualifiers: group winners, then runners-up, and so on; if only some of a placing go through
//   (e.g. 3 groups, top 4), the best of them go on points, then wins, sets and points ratio.
//   Bracket 1v8, 4v5, 2v7, 3v6 (quarters) / 1v4, 2v3 (semis), with seeds in group order, so the
//   first knockout round is a crossover (A1 v B2, B1 v A2) and group mates don't meet straight away.
//   Ids "finals-qf1".."finals-qf4", "finals-sf1", "finals-sf2", "finals-final". A knockout match is
//   saved as soon as both its teams are known.
//
// Fixtures that are only worked out (not saved yet) carry `virtual: true`. Results can only be
// reported on saved fixtures.

import { roundRobin, missingGames } from './schedule.js';
import { computeStandings, ratio } from './standings.js';
import { checkResult } from './match.js';
import { formatFor, isPlayoff } from './season.js';

export const LOCK_MINUTES = 10;
export const AUTO_MODES = { off: 'Off: I’ll add fixtures myself', once: 'Round robin: everyone plays once', double: 'Round robin: home & away' };
export const FINALS_TYPES = {
  none: 'No knockout',
  final: 'Final: top 2',
  semis: 'Semi-finals + final: top 4',
  quarters: 'Quarter-finals, semis + final: top 8',
};
export const GROUP_DRAWS = { auto: 'Automatic draw', manual: 'I’ll place teams myself (on the Teams tab); the rest are drawn' };
export const LETTERS = 'ABCDEFGH';
const KO_SIZE = { none: 0, final: 2, semis: 4, quarters: 8 };

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

// ---------- Groups ----------

export function groupCount(event) {
  const n = Math.floor(Number(event?.groups?.count ?? 1));
  return Number.isFinite(n) ? Math.min(8, Math.max(1, n)) : 1;
}

// A number from text that's always the same for the same text (for a draw that doesn't change).
function stableNumber(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// { A: [teamIds], B: [...] }. Teams placed by hand (or saved at the lock) stay put; the rest are
// drawn in a fixed random order into whichever group is smallest.
export function drawGroups(event, teamIds) {
  const n = groupCount(event);
  const letters = LETTERS.slice(0, n).split('');
  const groups = Object.fromEntries(letters.map((l) => [l, []]));
  const placed = event?.groups?.assign ?? {};
  const rest = [];
  for (const t of teamIds) {
    if (n > 1 && letters.includes(placed[t])) groups[placed[t]].push(t);
    else rest.push(t);
  }
  rest.sort((a, b) => stableNumber(`${event?.id ?? ''}:${a}`) - stableNumber(`${event?.id ?? ''}:${b}`));
  for (const t of rest) {
    const smallest = letters.reduce((best, l) => (groups[l].length < groups[best].length ? l : best), letters[0]);
    groups[smallest].push(t);
  }
  return groups;
}

// Round robins (one per group) for these groups, as fixtures.
// groups: { A: [teamIds], ... } (or just a list of team ids for one group).
export function groupFixtures(event, groupsOrIds) {
  const groups = Array.isArray(groupsOrIds) ? { A: groupsOrIds } : groupsOrIds;
  const mode = event?.autoFixtures;
  if (mode !== 'once' && mode !== 'double') return [];
  const letters = Object.keys(groups);
  const many = letters.length > 1;
  return letters.flatMap((l, gi) => roundRobin(groups[l], { double: mode === 'double' }).map((g, i) => ({
    id: many ? `auto-g${l}-r${g.round}-${g.homeTeamId}-${g.awayTeamId}` : `auto-r${g.round}-${g.homeTeamId}-${g.awayTeamId}`,
    label: many ? `Group ${l} · Round ${g.round}` : `Round ${g.round}`,
    homeTeamId: g.homeTeamId,
    awayTeamId: g.awayTeamId,
    scheduledAt: event.date ?? null,
    timeTbd: true,
    bestOf: null,
    // Groups play side by side: round 1 of every group, then round 2...
    order: g.round * 1000 + gi * 50 + i,
    status: 'scheduled',
    auto: true,
    ...(many ? { group: l } : {}),
  })));
}

// How many matches the round robins make (for the Rule config hint).
export function matchCount(event, teamCount) {
  const n = groupCount(event);
  const legs = event?.autoFixtures === 'double' ? 2 : 1;
  let total = 0;
  for (let g = 0; g < n; g++) {
    const size = Math.floor(teamCount / n) + (g < teamCount % n ? 1 : 0);
    total += (size * (size - 1) / 2) * legs;
  }
  return total;
}

// ---------- Knockout ----------

const ordinal = (n) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const placing = (p) => (p === 1 ? 'Winner' : p === 2 ? 'Runner-up' : `${ordinal(p)} place`);
const placingPlural = (p) => (p === 1 ? 'group winner' : p === 2 ? 'runner-up' : `${ordinal(p)}-placed team`);

// Who goes through, in seed order: [{ group, pos } | { pos, best }] plus a label for each.
function qualifiers(groups, size) {
  const letters = Object.keys(groups).filter((l) => groups[l].length);
  const many = letters.length > 1;
  const seeds = [];
  const deepest = Math.max(0, ...letters.map((l) => groups[l].length));
  for (let p = 1; seeds.length < size && p <= deepest; p++) {
    const tier = letters.filter((l) => groups[l].length >= p);
    const room = size - seeds.length;
    if (tier.length <= room) {
      for (const l of tier) seeds.push({ group: l, pos: p, label: many ? `${placing(p)} Group ${l}` : `${ordinal(p)} place` });
    } else {
      for (let k = 0; k < room; k++) seeds.push({ pos: p, best: k, label: k === 0 ? `Best ${placingPlural(p)}` : `${ordinal(k + 1)} best ${placingPlural(p)}` });
    }
  }
  return seeds.length === size ? seeds : null;
}

// Knockout matches: [{ slot, label, home: seed index | {from}, away, bestOf }]
function bracket(size, semiBestOf, finalBestOf) {
  if (size === 2) return [{ slot: 'final', label: 'Final', home: 0, away: 1, bestOf: finalBestOf }];
  const final = { slot: 'final', label: 'Grand final', home: { from: 'sf1' }, away: { from: 'sf2' }, bestOf: finalBestOf };
  if (size === 4) {
    return [
      { slot: 'sf1', label: 'Semi-final 1', home: 0, away: 3, bestOf: semiBestOf },
      { slot: 'sf2', label: 'Semi-final 2', home: 1, away: 2, bestOf: semiBestOf },
      final,
    ];
  }
  return [
    { slot: 'qf1', label: 'Quarter-final 1', home: 0, away: 7, bestOf: semiBestOf },
    { slot: 'qf2', label: 'Quarter-final 2', home: 3, away: 4, bestOf: semiBestOf },
    { slot: 'qf3', label: 'Quarter-final 3', home: 1, away: 6, bestOf: semiBestOf },
    { slot: 'qf4', label: 'Quarter-final 4', home: 2, away: 5, bestOf: semiBestOf },
    { slot: 'sf1', label: 'Semi-final 1', home: { from: 'qf1' }, away: { from: 'qf2' }, bestOf: semiBestOf },
    { slot: 'sf2', label: 'Semi-final 2', home: { from: 'qf3' }, away: { from: 'qf4' }, bestOf: semiBestOf },
    final,
  ];
}

// The knockout's matches for these settings (labels only, no teams), e.g. for showing the plan.
export function finalsSlots(event) {
  const f = event?.finals ?? {};
  const size = KO_SIZE[f.type] ?? 0;
  return size ? bracket(size, f.semiBestOf ?? 3, f.finalBestOf ?? 5) : [];
}

const slotName = (slot) => slot.toUpperCase().replace('FINAL', 'Final');

function winnerOf(fixture, results, season) {
  const r = fixture && results[fixture.id];
  if (!r || !fixture.homeTeamId || !fixture.awayTeamId) return null;
  const check = checkResult(r.sets, formatFor(season, fixture));
  if (!check.ok) return null;
  return check.winner === 'home' ? fixture.homeTeamId : fixture.awayTeamId;
}

// Better table row first: points, then wins, set ratio, point ratio.
const cmp = (x, y) => (x === y ? 0 : x > y ? -1 : 1); // higher first, safe with Infinity
const betterRow = (a, b) => cmp(a.points, b.points) || cmp(a.wins, b.wins)
  || cmp(ratio(a.setsWon, a.setsLost), ratio(b.setsWon, b.setsLost))
  || cmp(ratio(a.pointsWon, a.pointsLost), ratio(b.pointsWon, b.pointsLost));

// Each group's table, and whether all its matches have results.
// groupFix: { letter: [fixtures] }. Returns { letter: { rows, done } }.
export function groupTables({ groups, groupFix, results, season }) {
  const out = {};
  for (const [l, teamIds] of Object.entries(groups)) {
    const fixtures = groupFix[l] ?? [];
    const table = computeStandings({ teams: teamIds.map((id) => ({ id, name: id })), fixtures, results, season });
    out[l] = { rows: table.rows, done: fixtures.length > 0 && fixtures.every((f) => winnerOf(f, results, season) != null) };
  }
  return out;
}

// ---------- Everything together ----------

// Everything about an event's schedule right now.
// event, season: as in a bundle (dates in ms). entries: [{ teamId, createdAt }].
// fixtures: the saved fixtures. results: { [fixtureId]: result }.
// Returns {
//   teamIds, groups ({ A: [teamIds] }), groupCount, locked, open,
//   tables:   { letter: { rows, done } } (each group's table),
//   virtual:  fixtures to show that aren't saved yet,
//   toSave:   fixtures an admin browser should save now (locked round robin, knockout with both teams),
//   lockGroup: true when saving `toSave` also fixes the round robin (sets fixturesLockedAt and saves the draw),
//   finalsNote: why the knockout can't be shown (e.g. not enough teams), or null
// }
export function schedulePlan({ event, season, entries = [], fixtures = [], results = {}, now = Date.now() }) {
  const teamIds = entrantIds(event, entries);
  const n = groupCount(event);
  const groups = drawGroups(event, teamIds);
  const letters = Object.keys(groups);
  const locked = isLocked(event, now);
  const saved = new Map(fixtures.map((f) => [f.id, f]));
  const virtual = [];
  const toSave = [];
  let lockGroup = false;

  // Round robins (until they've been saved once).
  if (!event?.fixturesLockedAt) {
    const manual = fixtures.filter((f) => !f.auto && !isPlayoff(f));
    const wanted = groupFixtures(event, groups).filter((f) => !saved.has(f.id));
    const fresh = missingGames(wanted, manual); // skip matchups an admin already added by hand
    virtual.push(...fresh.map((f) => ({ ...f, virtual: true })));
    if (locked && event?.autoFixtures && event.autoFixtures !== 'off') {
      toSave.push(...fresh);
      lockGroup = true;
    }
  }

  // Group tables (one table when there are no groups).
  const stage = [...fixtures.filter((f) => !isPlayoff(f)), ...virtual];
  const groupFix = n > 1
    ? Object.fromEntries(letters.map((l) => [l, stage.filter((f) => f.group === l)]))
    : { A: stage };
  const tables = groupTables({ groups, groupFix, results, season });

  // Knockout.
  const slots = finalsSlots(event);
  let finalsNote = null;
  if (slots.length) {
    const size = KO_SIZE[event.finals.type];
    const seeds = qualifiers(groups, size);
    if (!seeds) {
      finalsNote = `The knockout needs at least ${size} teams.`;
    } else {
      const allDone = letters.every((l) => tables[l].done);
      // Who each seed is, once their group (or, for "best runner-up" places, every group) is done.
      const team = seeds.map((s) => {
        if (s.group) return tables[s.group].done ? tables[s.group].rows[s.pos - 1]?.teamId ?? null : null;
        if (!allDone) return null;
        const candidates = letters.map((l) => tables[l].rows[s.pos - 1]).filter(Boolean).sort(betterRow);
        // Skip teams already in on a full placing (can't happen with one row per group, but be safe).
        return candidates[s.best]?.teamId ?? null;
      });
      // "Best of" places: avoid a first-round match between teams from the same group if a swap helps.
      const groupOf = (id) => letters.find((l) => groups[l].includes(id));
      const firstRound = bracket(size).filter((m) => typeof m.home === 'number');
      // Only seeds from a "best of" place move (they aren't tied to a group position).
      const clash = (m) => team[m.home] && team[m.away] && groupOf(team[m.home]) === groupOf(team[m.away]);
      for (const m of firstRound) {
        if (!clash(m)) continue;
        const mover = 'best' in seeds[m.away] ? m.away : 'best' in seeds[m.home] ? m.home : null;
        if (mover == null) continue;
        // Swap it with a team from another first-round match if that leaves no clash in either.
        for (const o of firstRound.filter((x) => x !== m)) {
          const target = [o.away, o.home].find((t) => {
            [team[mover], team[t]] = [team[t], team[mover]];
            const ok = !clash(m) && !clash(o);
            [team[mover], team[t]] = [team[t], team[mover]];
            return ok;
          });
          if (target != null) { [team[mover], team[target]] = [team[target], team[mover]]; break; }
        }
      }

      const bySlot = {};
      for (const s of slots) {
        const id = `finals-${s.slot}`;
        const existing = saved.get(id);
        if (existing) { bySlot[s.slot] = existing; continue; }
        const side = (x) => (typeof x === 'number' ? team[x] : winnerOf(bySlot[x.from], results, season));
        const label = (x) => (typeof x === 'number' ? seeds[x].label : `Winner ${slotName(x.from)}`);
        const home = side(s.home);
        const away = side(s.away);
        const fixture = {
          id,
          label: s.label,
          homeTeamId: home ?? null,
          awayTeamId: away ?? null,
          homePlaceholder: label(s.home),
          awayPlaceholder: label(s.away),
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

  return { teamIds, groups, groupCount: n, tables, locked, open: signupsOpen(event, now), virtual, toSave, lockGroup, finalsNote };
}

// The draw to save at the lock, so it never changes afterwards: { teamId: letter }.
export function drawToSave(plan) {
  if (plan.groupCount < 2) return null;
  return Object.fromEntries(Object.entries(plan.groups).flatMap(([l, ids]) => ids.map((id) => [id, l])));
}

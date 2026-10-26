// Who finished 1st, 2nd and 3rd at an event, worked out from results (never stored).
//   - With a knockout: 1st = the final's winner, 2nd = its loser. 3rd = the 3rd place match's winner
//     (finals-3rd); without one, the semi-final losers share 3rd.
//   - Without a knockout: the top 3 of the table, once every match has a score.
// podium(b) -> { places: [{ place: 1|2|3, teamIds: [...] }], decided: bool } | null (not decided yet)
// b: an event bundle ({ event, season, fixtures, results, teams }).
import { checkResult } from './match.js';
import { formatFor } from './season.js';
import { computeStandings } from './standings.js';

function outcome(b, fixture) {
  const r = fixture && b.results?.[fixture.id];
  if (!r || !fixture.homeTeamId || !fixture.awayTeamId) return null;
  const check = checkResult(r.sets, formatFor(b.season, fixture));
  if (!check.ok) return null;
  const homeWon = check.winner === 'home';
  return { winner: homeWon ? fixture.homeTeamId : fixture.awayTeamId, loser: homeWon ? fixture.awayTeamId : fixture.homeTeamId };
}

export function podium(b) {
  const byId = new Map(b.fixtures.filter((f) => !f.virtual).map((f) => [f.id, f]));
  const final = outcome(b, byId.get('finals-final'));
  if (final) {
    const places = [{ place: 1, teamIds: [final.winner] }, { place: 2, teamIds: [final.loser] }];
    const third = outcome(b, byId.get('finals-3rd'));
    if (third) places.push({ place: 3, teamIds: [third.winner] });
    else {
      const semiLosers = ['finals-sf1', 'finals-sf2'].map((id) => outcome(b, byId.get(id))?.loser).filter(Boolean);
      if (semiLosers.length) places.push({ place: 3, teamIds: semiLosers });
    }
    return { places, decided: true };
  }
  // A knockout that hasn't finished: not decided.
  if ((b.event?.finals?.type ?? 'none') !== 'none' || [...byId.values()].some((f) => f.stage === 'playoffs')) return null;
  // No knockout: the table, once every match is played.
  const matches = [...byId.values()].filter((f) => f.homeTeamId && f.awayTeamId);
  if (!matches.length || matches.some((f) => !outcome(b, f) && !b.results?.[f.id]?.forfeit)) return null;
  const rows = computeStandings({ teams: b.teams ?? [], fixtures: matches, results: b.results, season: b.season }).rows;
  if (rows.length < 2) return null;
  return { places: rows.slice(0, 3).map((r, i) => ({ place: i + 1, teamIds: [r.teamId] })), decided: true };
}

// The latest event with a decided podium (by start date): { b, podium } or null.
export function latestPodium(bundles) {
  return [...bundles]
    .filter((b) => b.event?.published !== false && b.event?.status !== 'cancelled')
    .sort((x, y) => (y.event.date ?? 0) - (x.event.date ?? 0))
    .map((b) => ({ b, podium: podium(b) }))
    .find((x) => x.podium) ?? null;
}

// Every podium finish per team, newest first: Map teamId -> [{ place, eventId, title, date, joint }]
export function trophiesByTeam(bundles) {
  const out = new Map();
  for (const b of bundles) {
    if (b.event?.published === false || b.event?.status === 'cancelled') continue;
    const p = podium(b);
    if (!p) continue;
    for (const { place, teamIds } of p.places) {
      for (const id of teamIds) {
        if (!out.has(id)) out.set(id, []);
        out.get(id).push({ place, eventId: b.event.id, title: b.event.title, date: b.event.date ?? 0, joint: teamIds.length > 1 });
      }
    }
  }
  for (const list of out.values()) list.sort((x, y) => x.place - y.place || y.date - x.date);
  return out;
}

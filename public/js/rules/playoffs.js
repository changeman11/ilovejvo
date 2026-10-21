// Playoff bracket: who plays whom, who won, and who advances. Pure functions, no Firebase.
//
// The bracket is worked out from the locked seeds plus results every time, so winners
// "advance" automatically. The fixture documents also store their teams (so results can be
// entered against them); advanceUpdates() says which fixture docs need their teams filled in.

import { checkResult } from './match.js';
import { formatFor, isPlayoff } from './season.js';

// Slot layout for a bracket size. JVO uses 4: 1v4, 2v3, then the final.
export function bracketTemplate(size = 4) {
  if (size !== 4) throw new Error('Only 4-team playoffs are supported so far');
  return [
    { slot: 'sf1', round: 'sf', home: { seed: 1 }, away: { seed: 4 } },
    { slot: 'sf2', round: 'sf', home: { seed: 2 }, away: { seed: 3 } },
    { slot: 'final', round: 'final', home: { winnerOf: 'sf1' }, away: { winnerOf: 'sf2' } },
  ];
}

// Top N of the table: the seeds if the season ended now.
export function projectedSeeds(rows, size = 4) {
  return rows.slice(0, size).map((r) => r.teamId);
}

// Works out every slot. Returns null if the bracket hasn't been created (no seeds yet).
// Each slot: { slot, round, roundInfo, fixture, homeTeamId, awayTeamId, homeSeed, awaySeed,
//              check, winnerTeamId, played }
export function resolveBracket(season, fixtures, results) {
  const cfg = season?.playoffs;
  if (!cfg?.seeds?.length) return null;
  const seedOf = (teamId) => (teamId ? cfg.seeds.indexOf(teamId) + 1 || null : null);
  const bySlot = Object.fromEntries(fixtures.filter(isPlayoff).map((f) => [f.slot, f]));
  const out = {};

  for (const t of bracketTemplate(cfg.size)) {
    const pick = (src) => (src.seed ? cfg.seeds[src.seed - 1] ?? null : out[src.winnerOf]?.winnerTeamId ?? null);
    let home = pick(t.home);
    let away = pick(t.away);
    if (home && away && seedOf(away) < seedOf(home)) [home, away] = [away, home]; // better seed hosts

    const fixture = bySlot[t.slot] ?? null;
    const result = fixture ? results[fixture.id] : null;
    let check = null;
    let winnerTeamId = null;
    if (fixture && result) {
      check = checkResult(result.sets, formatFor(season, fixture));
      if (check.ok) winnerTeamId = check.winner === 'home' ? fixture.homeTeamId : fixture.awayTeamId;
    }
    // Once played, show the teams that actually played.
    if (winnerTeamId) {
      home = fixture.homeTeamId;
      away = fixture.awayTeamId;
    }
    out[t.slot] = {
      ...t,
      roundInfo: cfg.rounds?.find((r) => r.id === t.round) ?? { id: t.round, name: t.round },
      fixture,
      homeTeamId: home,
      awayTeamId: away,
      homeSeed: seedOf(home),
      awaySeed: seedOf(away),
      check,
      winnerTeamId,
      played: Boolean(winnerTeamId),
    };
  }
  return { slots: Object.values(out), bySlot: out, championId: out.final?.winnerTeamId ?? null };
}

// Fixture docs whose teams should change because an earlier round was decided (or undone).
// Never touches a slot that already has a result.
export function advanceUpdates(season, fixtures, results) {
  const bracket = resolveBracket(season, fixtures, results);
  if (!bracket) return [];
  return bracket.slots
    .filter((s) => s.fixture && !results[s.fixture.id])
    .filter((s) => (s.fixture.homeTeamId ?? null) !== s.homeTeamId || (s.fixture.awayTeamId ?? null) !== s.awayTeamId)
    .map((s) => ({ fixtureId: s.fixture.id, homeTeamId: s.homeTeamId, awayTeamId: s.awayTeamId }));
}

// Played playoff matches whose teams no longer match the bracket (e.g. a semi-final
// result was changed after the final was played). Shown to admins to check.
export function bracketProblems(season, fixtures, results) {
  const cfg = season?.playoffs;
  const bracket = resolveBracket(season, fixtures, results);
  if (!bracket) return [];
  const problems = [];
  for (const t of bracketTemplate(cfg.size)) {
    const slot = bracket.bySlot[t.slot];
    if (!slot.fixture || !results[slot.fixture.id]) continue;
    const expected = [t.home, t.away].map((src) => (src.seed ? cfg.seeds[src.seed - 1] : bracket.bySlot[src.winnerOf]?.winnerTeamId));
    const actual = [slot.fixture.homeTeamId, slot.fixture.awayTeamId];
    if (expected.some((id) => !actual.includes(id))) {
      problems.push({ fixtureId: slot.fixture.id, message: `${slot.roundInfo.name} was played by different teams than the bracket now gives. Check the earlier results.` });
    }
  }
  return problems;
}

// The fixture docs to create for a new bracket.
// lastRegularRound: so playoff rounds number on from the season (handy for sorting and race charts).
export function bracketFixtures(season, seeds, lastRegularRound) {
  const roundIds = season.playoffs.rounds.map((r) => r.id);
  return bracketTemplate(season.playoffs.size).map((t) => ({
    id: `po-${t.slot}`,
    stage: 'playoffs',
    slot: t.slot,
    playoffRound: t.round,
    round: lastRegularRound + 1 + roundIds.indexOf(t.round),
    division: season.divisions?.[0]?.id ?? null,
    homeTeamId: t.home.seed ? seeds[t.home.seed - 1] : null,
    awayTeamId: t.away.seed ? seeds[t.away.seed - 1] : null,
    scheduledAt: null,
    status: 'scheduled',
    stream: null,
  }));
}

// Round-robin fixture generator (circle method).
// Pure function: returns rounds of pairings, doesn't touch the database.

// teamIds: ['a', 'b', ...]
// double: play everyone twice, with home/away swapped in the second half
// Returns [{ round, homeTeamId, awayTeamId }]. Odd team counts get a bye each round
// (the team without a match that round simply isn't listed).
export function roundRobin(teamIds, { double = false } = {}) {
  const BYE = null;
  const list = [...teamIds];
  if (list.length < 2) return [];
  if (list.length % 2 === 1) list.push(BYE);

  const n = list.length;
  const roundsPerLeg = n - 1;
  const fixtures = [];

  // Keep the first team fixed and rotate the rest (who meets whom each round).
  // Home and away are balanced as we go (changed 2026-10-25: a fixed pattern left some teams away
  // for a whole group): the team with fewer home games so far hosts; on a tie, the one that was away
  // last time; then alternate by round. Every team ends within one of an even split.
  const homes = new Map();
  const last = new Map(); // teamId -> 'home' | 'away'
  let rotation = list.slice(1);
  for (let r = 0; r < roundsPerLeg; r++) {
    const current = [list[0], ...rotation];
    for (let i = 0; i < n / 2; i++) {
      const a = current[i];
      const b = current[n - 1 - i];
      if (a === BYE || b === BYE) continue;
      const ha = homes.get(a) ?? 0;
      const hb = homes.get(b) ?? 0;
      let host;
      if (ha !== hb) host = ha < hb ? a : b;
      else if (last.get(a) !== last.get(b)) host = last.get(a) === 'away' || last.get(b) === 'home' ? a : b;
      else host = (r + i) % 2 === 0 ? a : b;
      const guest = host === a ? b : a;
      homes.set(host, (homes.get(host) ?? 0) + 1);
      last.set(host, 'home');
      last.set(guest, 'away');
      fixtures.push({ round: r + 1, homeTeamId: host, awayTeamId: guest });
    }
    rotation = [rotation[rotation.length - 1], ...rotation.slice(0, -1)];
  }

  if (double) {
    const firstLeg = [...fixtures];
    for (const f of firstLeg) {
      fixtures.push({ round: f.round + roundsPerLeg, homeTeamId: f.awayTeamId, awayTeamId: f.homeTeamId });
    }
  }
  return fixtures;
}

// Only the games still missing: a pairing that already has a fixture (either way round) counts as
// played once. Lets an admin "top up" the schedule after a team joins late, without duplicates.
// existing: [{ homeTeamId, awayTeamId }]
export function missingGames(games, existing) {
  const key = (a, b) => [a, b].sort().join('|');
  const have = new Map();
  for (const f of existing) {
    if (!f.homeTeamId || !f.awayTeamId) continue;
    const k = key(f.homeTeamId, f.awayTeamId);
    have.set(k, (have.get(k) ?? 0) + 1);
  }
  return games.filter((g) => {
    const k = key(g.homeTeamId, g.awayTeamId);
    if ((have.get(k) ?? 0) > 0) {
      have.set(k, have.get(k) - 1);
      return false;
    }
    return true;
  });
}

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

  // Keep the first team fixed and rotate the rest.
  let rotation = list.slice(1);
  for (let r = 0; r < roundsPerLeg; r++) {
    const current = [list[0], ...rotation];
    for (let i = 0; i < n / 2; i++) {
      const a = current[i];
      const b = current[n - 1 - i];
      if (a === BYE || b === BYE) continue;
      // Alternate home/away so the fixed team doesn't always host.
      const flip = i === 0 ? r % 2 === 1 : (r + i) % 2 === 1;
      fixtures.push({ round: r + 1, homeTeamId: flip ? b : a, awayTeamId: flip ? a : b });
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

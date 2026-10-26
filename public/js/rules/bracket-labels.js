// Fixture label prefixes for elimination tournaments run by hand (added 2026-10-26): single
// elimination (Round 1 ... Final) and double elimination (Upper / Lower bracket rounds, Grand
// Final, Grand Final Reset). The admin fixture form offers them as a picker; the label becomes
// "<prefix> · Match <n>", and fixture lists put a heading per round (pages/parts.js roundName).
// Pure, tested.

export const ELIM_PREFIXES = {
  single: {
    label: 'Single elimination',
    rounds: ['Round 1', 'Round 2', 'Round 3', 'Round of 16', 'Quarter-final', 'Semi-final', '3rd place match', 'Final'],
  },
  double: {
    label: 'Double elimination',
    rounds: [
      'Upper Round 1', 'Upper Round 2', 'Upper Round 3', 'Upper Round 4', 'Upper Semi-final', 'Upper Final',
      'Lower Round 1', 'Lower Round 2', 'Lower Round 3', 'Lower Round 4', 'Lower Round 5', 'Lower Round 6', 'Lower Semi-final', 'Lower Final',
      'Grand Final', 'Grand Final Reset',
    ],
  },
};

// Rounds with one match only don't get a match number.
const SINGLE_MATCH = new Set(['Final', '3rd place match', 'Upper Final', 'Lower Final', 'Grand Final', 'Grand Final Reset']);

const startsWithRound = (label, prefix) => label === prefix || label.startsWith(`${prefix} · `);

// The next label for a round: "Upper Round 1 · Match 3" (counting fixtures already in that round).
// ignoreId: the fixture being edited (so it doesn't count itself).
export function nextLabel(prefix, fixtures = [], ignoreId = null) {
  if (SINGLE_MATCH.has(prefix)) return prefix;
  const used = fixtures.filter((f) => f.id !== ignoreId && startsWithRound(String(f.label ?? '').trim(), prefix)).length;
  return `${prefix} · Match ${used + 1}`;
}

// The round a label belongs to, if it starts with one of the elimination prefixes (longest first,
// so "Upper Round 1" wins over "Round 1" and "Grand Final Reset" over "Grand Final").
const ALL = [...new Set([...ELIM_PREFIXES.single.rounds, ...ELIM_PREFIXES.double.rounds])].sort((a, b) => b.length - a.length);
export function elimRound(label) {
  const text = String(label ?? '').trim();
  const lower = text.toLowerCase();
  return ALL.find((p) => lower === p.toLowerCase() || lower.startsWith(`${p.toLowerCase()} · `) || lower.startsWith(`${p.toLowerCase()} `)) ?? null;
}

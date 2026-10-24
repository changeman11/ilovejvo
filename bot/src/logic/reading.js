// From a screenshot reading (stats-read.js) to the stats draft players check in the match thread
// (result.statsDraft.rows). Pure, tested in tests/reading.test.mjs.
import { whoIsWho } from '../site-rules/whois.js';
import { printFromText } from '../site-rules/namepics.js';

// The screenshot to read for a match (as the site's stats-reader.js): from the votes that confirmed
// the score first, newest first; then ones copied from the thread. A still picture before a GIF.
export function shotFor(result, subs) {
  const confirmed = result?.confirmedBy ?? [];
  const votes = subs.filter((v) => v.screenshotPaths?.length)
    .sort((x, y) => Number(confirmed.includes(y.id)) - Number(confirmed.includes(x.id)) || (y.updatedAt ?? 0) - (x.updatedAt ?? 0));
  const all = [...votes.flatMap((v) => v.screenshotPaths), ...(result?.threadShots ?? [])];
  return all.find((p) => !/\.gif$/i.test(p)) ?? null;
}

// Does this match want the bot to read a screenshot? -> the path, or null.
//   tried: Map path -> when the bot last failed on it (tried again after retryMs).
export function shotToRead(result, subs, { tried = new Map(), now = Date.now(), retryMs = 15 * 60 * 1000 } = {}) {
  if (!result || result.forfeit || result.statsStatus !== 'pending') return null;
  const shot = shotFor(result, subs);
  if (!shot) return null;
  const d = result.statsDraft;
  if (d?.shot === shot && (d.rows || d.error)) return null; // read already (by the bot or a browser)
  if (d?.shot === shot && d.reading && now - (d.at ?? 0) < 3 * 60 * 1000) return null; // a browser is on it
  if (tried.has(shot) && now - tried.get(shot) < retryMs) return null;
  return shot;
}

// Stored name pictures: { playerId: ['<print text>', ...] } -> { playerId: [print] }
export function knownPrints(stored) {
  return Object.fromEntries(Object.entries(stored ?? {}).map(([pid, list]) => [pid, (list ?? []).map(printFromText).filter(Boolean)]));
}

// Adds the name pictures of lines PEOPLE said are right (answered in who's who, or the player
// confirmed their line) to the stored ones, newest first, `keep` per player. The reader's own
// guesses aren't added, so a mistake can't teach itself. -> the new store, or null if unchanged.
export function learnPrints(stored, rows, { keep = 6 } = {}) {
  const out = { ...(stored ?? {}) };
  let changed = false;
  for (const r of rows ?? []) {
    if (!r.playerId || r.notPlayer || !r.print) continue;
    if (!r.answeredBy && !r.claimedBy && !r.confirmedBy) continue;
    const list = out[r.playerId] ?? [];
    if (list.includes(r.print)) continue;
    out[r.playerId] = [r.print, ...list].slice(0, keep);
    changed = true;
  }
  return changed ? out : null;
}

// Gives each read line its player.
//   lines: from ShotReader.read; homeTeamId/awayTeamId and the squads (site player profiles);
//   prints: { playerId: [print] } (knownPrints)
// -> rows for result.statsDraft.rows: [{ side: 'left'|'right', nameText, name, print, playerId, matchedBy, stats }]
export function placeLines(lines, { homeTeamId, awayTeamId, homeSquad, awaySquad, prints = {} }) {
  const teams = { [homeTeamId]: homeSquad.map((p) => p.id), [awayTeamId]: awaySquad.map((p) => p.id) };
  const known = Object.fromEntries([...homeSquad, ...awaySquad].map((p) => [p.id, {
    names: [p.displayName, ...(p.gameNames ?? [])].filter(Boolean),
    prints: prints[p.id] ?? [],
  }]));
  const who = whoIsWho(lines.map((l) => ({ side: l.side, text: l.name || l.nameText, print: l.print ? printFromText(l.print) : null })), teams, known);
  return lines.map((l, i) => ({
    side: l.side === 0 ? 'left' : 'right',
    nameText: l.nameText ?? '',
    name: l.name || l.nameText || `line ${i + 1}`,
    print: l.print ?? null,
    playerId: who[i].playerId,
    matchedBy: who[i].playerId ? who[i].why : null,
    stats: l.stats,
  }));
}

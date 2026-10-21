// Made-up sample data for local testing. All names are invented.
// The same random seed always gives the same data, so test results are repeatable.

import { roundRobin } from '../public/js/rules/schedule.js';

function rng(seed) {
  // mulberry32
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEAMS = [
  { id: 'tasman-tide', name: 'Tasman Tide', shortName: 'TAS', color: '#19c9b1', strength: 0.7 },
  { id: 'reef-raiders', name: 'Reef Raiders', shortName: 'REE', color: '#ff7a45', strength: 0.64 },
  { id: 'outback-aces', name: 'Outback Aces', shortName: 'OUT', color: '#ffe200', strength: 0.55 },
  { id: 'harbour-hawks', name: 'Harbour Hawks', shortName: 'HAR', color: '#1438d8', strength: 0.5 },
  { id: 'southern-smash', name: 'Southern Smash', shortName: 'SOU', color: '#e24a7c', strength: 0.42 },
  { id: 'kauri-kings', name: 'Kauri Kings', shortName: 'KAU', color: '#7bd87b', strength: 0.36 },
];

const TAGS = [
  'Wavecrash', 'Lumen', 'Kiri', 'Bluefin', 'Static',
  'Coralyn', 'Riptide', 'Mako', 'Zephyr', 'Nimbus',
  'Dusty', 'Redback', 'Mirage', 'Solace', 'Quokka',
  'Pylon', 'Ferry', 'Gannet', 'Skipjack', 'Lantern',
  'Southerly', 'Volt', 'Cinder', 'Halo', 'Brisk',
  'Totara', 'Fern', 'Moa', 'Kea', 'Rimu',
];

const NOW = Date.UTC(2026, 9, 21);
const DAY = 24 * 60 * 60 * 1000;

function playSet(rand, homeStrength, awayStrength) {
  const homeWins = rand() < 0.5 + (homeStrength - awayStrength);
  const deuce = rand() < 0.18;
  const win = deuce ? 11 + Math.floor(rand() * 3) : 10;
  const lose = deuce ? win - 2 : 2 + Math.floor(rand() * 7);
  return homeWins ? { home: win, away: lose } : { home: lose, away: win };
}

function statLine(rand, sets, won) {
  const n = (max) => Math.floor(rand() * (max + 1) * sets * (won ? 1.1 : 0.9));
  const spk = n(4);
  const blk = n(1);
  const ace = n(1);
  return { pts: spk + blk + ace, spk, blk, ace, rec: n(4), set: n(4), ast: n(2), dig: n(4) };
}

function playResult(rand, homeId, awayId, rosters, toWin, at) {
  const strength = Object.fromEntries(TEAMS.map((t) => [t.id, t.strength]));
  const sets = [];
  let h = 0;
  let a = 0;
  while (h < toWin && a < toWin) {
    const s = playSet(rand, strength[homeId], strength[awayId]);
    sets.push(s);
    if (s.home > s.away) h++;
    else a++;
  }
  const homeWon = h === toWin;
  const playerStats = {};
  for (const [teamId, won] of [[homeId, homeWon], [awayId, !homeWon]]) {
    const ids = [...rosters[teamId].playerIds].sort(() => rand() - 0.5).slice(0, 4);
    for (const pid of ids) playerStats[pid] = { teamId, ...statLine(rand, sets.length, won) };
  }
  const winner = homeWon ? homeId : awayId;
  const mvp = Object.entries(playerStats).filter(([, s]) => s.teamId === winner).sort((x, y) => y[1].pts - x[1].pts)[0][0];
  return { sets, playerStats, mvpPlayerId: mvp, vodUrl: null, screenshots: [], forfeit: null, enteredBy: 'seed', enteredAt: new Date(at + 3600e3) };
}

const eventBase = {
  summary: '', details: '', date: null, timeTbd: true, status: 'upcoming', published: true,
  teamIds: [], teamSize: 4, matchFormat: { bestOf: 3 }, showTable: false,
  formatNote: null, prize: null, signupUrl: null, streamUrl: null,
};

export function buildSampleData() {
  const rand = rng(20261021);
  const teams = TEAMS.map(({ strength, color, ...t }) => ({ ...t, colors: { primary: color } }));
  const players = TAGS.map((tag, i) => ({ id: tag.toLowerCase(), displayName: tag, number: (i * 7) % 99, active: true }));
  const rosters = Object.fromEntries(TEAMS.map((t, ti) => {
    const ids = TAGS.slice(ti * 5, ti * 5 + 5).map((x) => x.toLowerCase());
    return [t.id, { playerIds: ids, captainId: ids[0] }];
  }));

  const events = [];

  // 1. A finished exhibition night with results, so stats have something to show.
  {
    const teamIds = ['tasman-tide', 'reef-raiders', 'outback-aces', 'harbour-hawks'];
    const start = NOW - 11 * DAY + 8 * 3600e3; // 10 Oct, 6pm AEST
    const pairs = [['tasman-tide', 'harbour-hawks'], ['reef-raiders', 'outback-aces'], ['tasman-tide', 'reef-raiders'], ['outback-aces', 'harbour-hawks']];
    const fixtures = pairs.map(([home, away], i) => ({
      id: `m${i + 1}`, label: `Showmatch ${i + 1}`, order: i + 1, homeTeamId: home, awayTeamId: away,
      scheduledAt: new Date(start + i * 40 * 60e3), timeTbd: false, bestOf: null, status: 'completed',
    }));
    const results = Object.fromEntries(fixtures.map((f) => [f.id, playResult(rand, f.homeTeamId, f.awayTeamId, rosters, 2, f.scheduledAt.getTime())]));
    events.push({
      id: 'preseason-showmatches',
      doc: { ...eventBase, type: 'exhibition', title: 'Preseason Showmatches', status: 'finished', date: new Date(start), timeTbd: false, teamIds,
        summary: 'Four community squads, four showmatches, one big warm-up for the season.' },
      fixtures, results, rosters: Object.fromEntries(teamIds.map((id) => [id, rosters[id]])),
    });
  }

  // 2. An upcoming tournament: round robin with TBD dates, then a best-of-5 final.
  {
    const teamIds = TEAMS.map((t) => t.id);
    const games = roundRobin(teamIds);
    const fixtures = games.map((g, i) => ({
      id: `g${String(i + 1).padStart(2, '0')}`, label: `Round ${g.round}`, order: i + 1, homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId,
      scheduledAt: null, timeTbd: true, bestOf: null, status: 'scheduled',
    }));
    fixtures.push({ id: 'final', label: 'Grand final', order: fixtures.length + 1, homeTeamId: null, awayTeamId: null, scheduledAt: null, timeTbd: true, bestOf: 5, status: 'scheduled' });
    events.push({
      id: 'opening-cup',
      doc: { ...eventBase, type: 'tournament', title: 'Opening Cup', teamIds, showTable: true,
        summary: 'Our first open 4v4 tournament. Everyone plays everyone, then the top two meet in a best-of-5 final.',
        details: 'Sign-ups open soon.\n\nFull rules will be posted in the Discord.',
        formatNote: 'Round robin, then a best-of-5 final', prize: 'Discord champion role', signupUrl: 'https://discord.com' },
      fixtures, results: {}, rosters: Object.fromEntries(teamIds.map((id) => [id, rosters[id]])),
    });
  }

  // 3. An announced exhibition night, nothing scheduled yet.
  events.push({
    id: 'all-stars-exhibition',
    doc: { ...eventBase, type: 'exhibition', title: 'All-Stars Exhibition', summary: 'Community-voted all-star teams go head to head.' },
    fixtures: [], results: {}, rosters: {},
  });

  // 4. A draft only admins can see.
  events.push({
    id: 'summer-invitational',
    doc: { ...eventBase, type: 'tournament', title: 'Summer Invitational', published: false, summary: 'Still being planned.' },
    fixtures: [], results: {}, rosters: {},
  });

  return { teams, players, events };
}

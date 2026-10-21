// Builds made-up sample data for local testing. All names are invented.
// Two seasons: a finished "Season 0" and a live "Season 1", with a few players changing clubs.
// The same random seed always produces the same league, so results are repeatable.

import { DEFAULT_FORMAT, DEFAULT_STANDINGS, DEFAULT_STATS } from '../public/js/rules/defaults.js';
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
  { id: 'tasman-tide', name: 'Tasman Tide', shortName: 'TAS', colors: { primary: '#1fb6ff', secondary: '#0b2545' }, strength: 0.72 },
  { id: 'reef-raiders', name: 'Reef Raiders', shortName: 'REE', colors: { primary: '#ff6b35', secondary: '#1a1a2e' }, strength: 0.66 },
  { id: 'outback-aces', name: 'Outback Aces', shortName: 'OUT', colors: { primary: '#f4a261', secondary: '#3d2b1f' }, strength: 0.55 },
  { id: 'harbour-hawks', name: 'Harbour Hawks', shortName: 'HAR', colors: { primary: '#2ec4b6', secondary: '#011627' }, strength: 0.5 },
  { id: 'southern-smash', name: 'Southern Smash', shortName: 'SOU', colors: { primary: '#e71d36', secondary: '#20030a' }, strength: 0.42 },
  { id: 'kauri-kings', name: 'Kauri Kings', shortName: 'KAU', colors: { primary: '#80ed99', secondary: '#0b3d20' }, strength: 0.35 },
];

// Season 1 rosters: 5 players per team, in TEAMS order.
const TAGS = [
  'Wavecrash', 'Lumen', 'Kiri', 'Bluefin', 'Static',
  'Coralyn', 'Riptide', 'Mako', 'Zephyr', 'Nimbus',
  'Dusty', 'Redback', 'Mirage', 'Solace', 'Quokka',
  'Pylon', 'Ferry', 'Gannet', 'Skipjack', 'Lantern',
  'Southerly', 'Volt', 'Cinder', 'Halo', 'Brisk',
  'Totara', 'Fern', 'Moa', 'Kea', 'Rimu',
];

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

function playSet(rand, homeStrength, awayStrength) {
  const homeWins = rand() < 0.5 + (homeStrength - awayStrength);
  const deuce = rand() < 0.18;
  let win, lose;
  if (deuce) {
    win = 11 + Math.floor(rand() * 3); // 11, 12 or 13
    lose = win - 2;
  } else {
    win = 10;
    lose = 2 + Math.floor(rand() * 7); // 2..8
  }
  return homeWins ? { home: win, away: lose } : { home: lose, away: win };
}

function playMatch(rand, home, away) {
  const sets = [];
  let h = 0;
  let a = 0;
  while (h < 2 && a < 2) {
    const s = playSet(rand, home.strength, away.strength);
    sets.push(s);
    if (s.home > s.away) h++;
    else a++;
  }
  return sets;
}

function statLine(rand, setsPlayed, won) {
  const n = (max) => Math.floor(rand() * (max + 1) * setsPlayed * (won ? 1.1 : 0.9));
  const spk = n(4);
  const blk = n(1);
  const ace = n(1);
  const line = { spk, blk, ace, rec: n(4), set: n(4), ast: n(2), dig: n(4) };
  line.pts = spk + blk + ace; // sample data only; the real game reports its own PTS
  return line;
}

// Builds one season's fixtures and results.
function buildSeason(rand, { id, name, status, kickoff, teamIds, rosters, double, roundsPlayed }) {
  const strength = Object.fromEntries(TEAMS.map((t) => [t.id, t]));
  const season = {
    name,
    status,
    kickoffAt: new Date(kickoff),
    divisions: [{ id: 'premier', name: 'Premier', teamIds }],
    format: { ...DEFAULT_FORMAT },
    standings: structuredClone(DEFAULT_STANDINGS),
    stats: structuredClone(DEFAULT_STATS),
    // Table colour bands. Placeholder until JVO decides its playoff format.
    bands: [
      { from: 1, to: 1, label: 'Minor premiers', tone: 'gold' },
      { from: 1, to: 4, label: 'Playoffs', tone: 'accent' },
    ],
    playoffs: null,
  };

  const fixtures = [];
  const results = {};
  const perRound = Math.floor(teamIds.length / 2);
  roundRobin(teamIds, { double }).forEach((f, i) => {
    const fixtureId = `r${String(f.round).padStart(2, '0')}-${f.homeTeamId}-v-${f.awayTeamId}`;
    const slot = i % perRound; // matches 45 minutes apart
    const scheduledAt = new Date(kickoff + (f.round - 1) * WEEK + slot * 45 * 60 * 1000);
    const played = f.round <= roundsPlayed;
    fixtures.push({
      id: fixtureId,
      division: 'premier',
      round: f.round,
      homeTeamId: f.homeTeamId,
      awayTeamId: f.awayTeamId,
      scheduledAt,
      status: played ? 'completed' : 'scheduled',
      stream: null,
    });
    if (!played) return;

    const sets = playMatch(rand, strength[f.homeTeamId], strength[f.awayTeamId]);
    const homeWon = sets.filter((s) => s.home > s.away).length === 2;
    const playerStats = {};
    for (const [teamId, won] of [[f.homeTeamId, homeWon], [f.awayTeamId, !homeWon]]) {
      // 4 of the roster take the court
      const ids = [...rosters[teamId].playerIds].sort(() => rand() - 0.5).slice(0, 4);
      for (const pid of ids) playerStats[pid] = { teamId, ...statLine(rand, sets.length, won) };
    }
    const winnerTeam = homeWon ? f.homeTeamId : f.awayTeamId;
    const mvp = Object.entries(playerStats)
      .filter(([, s]) => s.teamId === winnerTeam)
      .sort((a, b) => b[1].pts - a[1].pts)[0][0];

    results[fixtureId] = {
      sets,
      playerStats,
      mvpPlayerId: mvp,
      vodUrl: null,
      screenshots: [],
      enteredBy: 'seed',
      enteredAt: new Date(scheduledAt.getTime() + 60 * 60 * 1000),
    };
  });

  return { id, season, rosters, fixtures, results };
}

export function buildSampleData() {
  const rand = rng(20260912);
  const teams = TEAMS.map(({ strength, ...t }) => ({ ...t, logoUrl: null, discordRoleId: null }));

  const players = TAGS.map((tag) => ({
    id: tag.toLowerCase(), displayName: tag, discordId: null, position: null, avatarUrl: null, active: true,
  }));

  // Season 1 rosters straight from TAGS
  const s1Rosters = {};
  TEAMS.forEach((team, ti) => {
    const ids = TAGS.slice(ti * 5, ti * 5 + 5).map((t) => t.toLowerCase());
    s1Rosters[team.id] = { playerIds: ids, captainId: ids[0] };
  });

  // Season 0: Kauri Kings didn't exist yet. Totara and Fern played elsewhere,
  // and Redback was at Harbour Hawks before moving to Outback Aces.
  const s0Rosters = structuredClone(s1Rosters);
  delete s0Rosters['kauri-kings'];
  s0Rosters['tasman-tide'].playerIds.push('totara');
  s0Rosters['reef-raiders'].playerIds.push('fern');
  s0Rosters['outback-aces'].playerIds = s0Rosters['outback-aces'].playerIds.filter((p) => p !== 'redback');
  s0Rosters['harbour-hawks'].playerIds.push('redback');

  const s0 = buildSeason(rand, {
    id: 's0',
    name: 'Season 0',
    status: 'finished',
    kickoff: Date.UTC(2026, 5, 6, 8, 0), // Sat 6 Jun 2026, 6pm AEST
    teamIds: Object.keys(s0Rosters),
    rosters: s0Rosters,
    double: false,
    roundsPlayed: Infinity,
  });

  const s1 = buildSeason(rand, {
    id: 's1',
    name: 'Season 1',
    status: 'live',
    kickoff: Date.UTC(2026, 8, 12, 8, 0), // Sat 12 Sep 2026, 6pm AEST
    teamIds: teams.map((t) => t.id),
    rosters: s1Rosters,
    double: true,
    roundsPlayed: 6,
  });

  const settings = {
    leagueName: 'Just Volleyball Oceania',
    shortName: 'JVO',
    currentSeasonId: 's1',
    homeSeasonId: 's1',
    discordInvite: null,
    socials: {},
  };

  return { teams, players, seasons: [s0, s1], settings };
}

// Settings come from environment variables (the .env file next to package.json, or the
// server's environment). Secrets (DISCORD_TOKEN, FIREBASE_BOT_PASSWORD) only ever live there.
import { parseModes } from './logic/modes.js';
import { DEFAULT_K, DEFAULT_START } from './logic/elo.js';

// The live site's public Firebase settings (the same ones as public/js/config.js; not secret).
const LIVE_FIREBASE = { projectId: 'i-love-jvo', apiKey: 'AIzaSyDLQRbRGct6B2LxAjjv6FXznPOzx8f7aHU', storageBucket: 'i-love-jvo.firebasestorage.app' };
const EMULATOR_FIREBASE = { projectId: 'demo-jvo-hub', apiKey: 'demo-key', storageBucket: 'demo-jvo-hub.appspot.com' };

export class ConfigError extends Error {
  constructor(problems) {
    super(`The bot's settings need fixing (see bot/.env.example):\n - ${problems.join('\n - ')}`);
    this.problems = problems;
  }
}

export function loadConfig(env = process.env) {
  const problems = [];
  const text = (key, fallback = '') => String(env[key] ?? '').trim() || fallback;
  const discordId = (key, what, required = true) => {
    const v = text(key);
    if (!v) {
      if (required) problems.push(`${key} is empty: ${what}`);
      return '';
    }
    if (!/^\d{15,22}$/.test(v)) problems.push(`${key} should be a Discord ID (a long number), got "${v}"`);
    return v;
  };
  const number = (key, fallback, min, max) => {
    const raw = text(key);
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max) {
      problems.push(`${key} should be a number from ${min} to ${max}, got "${raw}"`);
      return fallback;
    }
    return n;
  };

  const token = text('DISCORD_TOKEN');
  if (!token) problems.push('DISCORD_TOKEN is empty: the bot token from the Discord Developer Portal (Bot -> Reset Token)');

  const modes = parseModes(text('MODES', '2,3,4,5,6'));
  if (!modes) problems.push('MODES should be team sizes separated by commas, like 2,3,4,5,6');

  const draftOrder = text('DRAFT_ORDER', 'alternate').toLowerCase();
  if (!['alternate', 'snake'].includes(draftOrder)) problems.push('DRAFT_ORDER should be alternate or snake');

  const store = text('STORE', 'file').toLowerCase();
  if (!['file', 'firebase'].includes(store)) problems.push('STORE should be file or firebase');

  const emulator = text('FIREBASE_EMULATOR') === '1';
  const firebaseDefaults = emulator ? EMULATOR_FIREBASE : LIVE_FIREBASE;
  const firebase = {
    projectId: text('FIREBASE_PROJECT_ID', firebaseDefaults.projectId),
    apiKey: text('FIREBASE_API_KEY', firebaseDefaults.apiKey),
    storageBucket: text('FIREBASE_STORAGE_BUCKET', firebaseDefaults.storageBucket),
    email: text('FIREBASE_BOT_EMAIL', 'pickup-bot@users.ilovejvo.com'),
    password: text('FIREBASE_BOT_PASSWORD', emulator ? 'emulator-only-password' : ''),
    emulator: emulator
      ? {
          firestore: `http://${text('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080')}`,
          auth: `http://${text('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099')}`,
          storage: `http://${text('FIREBASE_STORAGE_EMULATOR_HOST', '127.0.0.1:9199')}`,
        }
      : null,
  };
  if (store === 'firebase' && !firebase.password) {
    problems.push('FIREBASE_BOT_PASSWORD is empty: the password of the bot\'s Firebase account (STORE=firebase needs it)');
  }

  const config = {
    token,
    guildId: discordId('GUILD_ID', 'your Discord server ID (right-click the server icon -> Copy Server ID)'),
    pickupChannelId: discordId('PICKUP_CHANNEL_ID', 'the text channel where the bot posts drafts and results'),
    teamCategoryId: discordId('TEAM_CATEGORY_ID', '', false),
    adminRoleIds: text('ADMIN_ROLE_IDS')
      .split(/[\s,]+/)
      .filter(Boolean),
    modes: modes ?? [2, 3, 4, 5, 6],
    draftOrder,
    countdownSeconds: number('COUNTDOWN_SECONDS', 30, 0, 600),
    // Votes on the queue card needed to pick the next mode (otherwise it's random).
    modeVotesNeeded: number('MODE_VOTES_NEEDED', 2, 1, 12),
    pickSeconds: number('PICK_SECONDS', 60, 10, 600),
    readySeconds: number('READY_SECONDS', 60, 10, 600),
    startRating: number('ELO_START', DEFAULT_START, 0, 10000),
    k: number('ELO_K', DEFAULT_K, 1, 200),
    allowTestPlayers: text('ALLOW_TEST_PLAYERS') === '1',
    // Club roles: a cosmetic role per site club, given to its players (needs Manage Roles).
    clubRoles: text('CLUB_ROLES') === '1',
    clubRolesHoist: text('CLUB_ROLES_GROUPED', '1') !== '0',
    clubRolesMinutes: number('CLUB_ROLES_MINUTES', 5, 1, 1440),
    // With club roles on: one more role for every club's captain (manager). CAPTAIN_ROLE=0 = none.
    captainRoleName: text('CAPTAIN_ROLE') === '0' ? '' : text('CAPTAIN_ROLE', 'Captain').slice(0, 100),
    // Stat roles (stat-roles.js): "Top 3 · Points" etc. for the current top STAT_ROLES_TOP of each stat.
    statRoles: text('STAT_ROLES') === '1',
    statRolesMinutes: number('STAT_ROLES_MINUTES', 30, 5, 1440),
    statRolesTop: number('STAT_ROLES_TOP', 3, 1, 10),
    // Community characters (characters.js, needs STORE=firebase): pictures posted in
    // #in-game-characters are cut out and added to the site's Home court.
    characters: text('CHARACTERS') === '1',
    charactersChannel: text('CHARACTERS_CHANNEL', 'in-game-characters'),
    charactersChannelId: discordId('CHARACTERS_CHANNEL_ID', '', false),
    charactersMinutes: number('CHARACTERS_MINUTES', 5, 2, 1440),
    // Match threads (matches.js): a thread per site match in MATCH_CHANNEL_ID (made if empty) once
    // it opens; players vote there, and are pinged again every MATCH_REMIND_MINUTES (at most
    // MATCH_REMIND_MAX times, then admins are pinged) until the score is in.
    matchThreads: text('MATCH_THREADS') === '1',
    matchChannelId: discordId('MATCH_CHANNEL_ID', '', false),
    matchRemindMinutes: number('MATCH_REMIND_MINUTES', 10, 1, 240),
    matchRemindMax: number('MATCH_REMIND_MAX', 6, 0, 50),
    matchCloseMinutes: number('MATCH_CLOSE_MINUTES', 15, 0, 1440),
    // The bot reads each match's end-of-match screenshot itself (stats-read.js) and fills in the
    // stats for players to check in the thread. READ_STATS=0 leaves it to admin browsers again.
    readStats: text('READ_STATS', '1') !== '0',
    // 1v1 ranked queue (ranked.js). Channels are made if these are empty.
    // Welcome new members here (needs the Server Members intent). Empty = no welcomes.
    welcomeChannelId: discordId('WELCOME_CHANNEL_ID', '', false),
    ranked: text('RANKED') === '1',
    rankedChannelId: discordId('RANKED_CHANNEL_ID', '', false),
    rankedResultsChannelId: discordId('RANKED_RESULTS_CHANNEL_ID', '', false),
    rankedReadySeconds: number('RANKED_READY_SECONDS', 300, 30, 3600),
    rankedCloseSeconds: number('RANKED_CLOSE_SECONDS', 15, 0, 600),
    // The website queue: on whenever ratings are in Firestore, unless SITE_QUEUE=0.
    siteQueue: store === 'firebase' && text('SITE_QUEUE') !== '0',
    // The website, for links on the bot's messages (SITE_URL=0 turns the links off).
    siteUrl: text('SITE_URL') === '0' ? '' : text('SITE_URL', 'https://i-love-jvo.web.app').replace(/\/+$/, ''),
    store,
    dataFile: text('DATA_FILE', 'data/pickup.json'),
    firebase,
  };
  // Staff (see the 1v1 results channel, decide disputes): STAFF_ROLE_IDS, or the admin roles.
  config.staffRoleIds = text('STAFF_ROLE_IDS').split(/[\s,]+/).filter(Boolean);
  if (!config.staffRoleIds.length) config.staffRoleIds = [...config.adminRoleIds];
  for (const id of config.staffRoleIds) {
    if (!/^\d{15,22}$/.test(id)) problems.push(`STAFF_ROLE_IDS should be role IDs separated by commas, got "${id}"`);
  }
  for (const id of config.adminRoleIds) {
    if (!/^\d{15,22}$/.test(id)) problems.push(`ADMIN_ROLE_IDS should be role IDs separated by commas, got "${id}"`);
  }
  if (config.matchThreads && store !== 'firebase') problems.push('MATCH_THREADS=1 needs STORE=firebase (votes are saved to the site)');
  if (problems.length) throw new ConfigError(problems);
  return config;
}

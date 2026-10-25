// Bot control panel (added 2026-10-25): admins run the bot from the site's /admin/bot page.
//
// - botControl/settings = { features: { ranked, matchThreads, readStats, characters, statRoles,
//   clubRoles, welcome }, timings: { matchRemindMinutes, ... } } written by admins. Read once at
//   start-up (applySettings, before anything starts) and watched live: a feature switch changes
//   which parts run, so the bot restarts itself (systemd starts it again in ~10 s); timings are
//   applied straight away. A feature can only be on if .env allows it (e.g. welcomes need
//   WELCOME_CHANNEL_ID); .env stays the fallback when the site has no settings.
// - botCommands/{id} = { action, eventId?, status: 'pending' } written by admins; the bot runs it
//   and writes status 'done' | 'failed' and a `result` line.
// - botControl/status = what's running, timings and counts, re-sent every 5 minutes (the site
//   shows "offline" after 12 minutes without one).
//
// Both docs and the commands are public to read (nothing secret in them); only admins write
// settings/commands, only the bot writes status and command results (firestore.rules).
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, collection, doc, onSnapshot } from 'firebase/firestore';

// The switches on the panel: name -> how it maps onto the config, and what .env must have for it.
export const FEATURES = {
  ranked: { label: '1v1 ranked', key: 'ranked' },
  matchThreads: { label: 'Match threads', key: 'matchThreads' },
  readStats: { label: 'Read stats screenshots', key: 'readStats' },
  characters: { label: 'Characters from Discord', key: 'characters' },
  statRoles: { label: 'Award roles (1st/2nd/3rd)', key: 'statRoles' },
  clubRoles: { label: 'Club roles', key: 'clubRoles' },
  welcome: { label: 'Welcome new members', key: 'welcomeChannelId' },
};
// Timings the panel can change live: name -> [min, max].
export const TIMINGS = {
  matchRemindMinutes: [1, 240],
  matchRemindMax: [0, 50],
  matchCloseMinutes: [0, 1440],
  readySeconds: [10, 600],
  pickSeconds: [10, 600],
  rankedReadySeconds: [30, 3600],
};
export const ACTIONS = ['syncRoles', 'repostCards', 'checkThreads', 'closeThreads', 'clearEventThreads', 'restart'];

// Which features .env allows: some need things only .env can give (a channel, Firebase).
export function availableFeatures(env) {
  const firebase = env.store === 'firebase';
  return {
    ranked: true,
    matchThreads: firebase,
    readStats: firebase,
    characters: firebase,
    statRoles: true,
    clubRoles: true,
    welcome: Boolean(env.welcomeChannelId),
  };
}

// Is each feature on in this config? -> { ranked: true, ... }
export function featuresOf(config) {
  return Object.fromEntries(Object.entries(FEATURES).map(([name, f]) => [name, Boolean(config[f.key])]));
}

// Put the site's settings onto the config (changes `config`, returns it). env = the config as .env
// made it. A feature that .env can't support stays off; missing settings keep .env's value.
export function applySettings(config, settings, env) {
  const can = availableFeatures(env);
  for (const [name, f] of Object.entries(FEATURES)) {
    const want = settings?.features?.[name];
    if (typeof want !== 'boolean') continue;
    if (name === 'welcome') config.welcomeChannelId = want && can.welcome ? env.welcomeChannelId : '';
    else config[f.key] = want && can[name];
  }
  for (const [name, [min, max]] of Object.entries(TIMINGS)) {
    const v = Number(settings?.timings?.[name]);
    if (settings?.timings?.[name] === undefined || settings?.timings?.[name] === null || !Number.isFinite(v)) continue;
    config[name] = Math.min(max, Math.max(min, Math.round(v)));
  }
  return config;
}

const HEARTBEAT = 5 * 60 * 1000;
const STALE = 60 * 60 * 1000; // commands older than this when the bot sees them are skipped
let apps = 0;

export class BotControl {
  // modules(): { pickup, ranked, matches, clubRoles, statRoles } as they are now.
  // restart(): ends the process (systemd starts it again). now(): the clock.
  constructor({ rest, firebase, config, env, modules, log = console, restart = () => process.kill(process.pid, 'SIGTERM'), now = () => Date.now(), version = '' }) {
    Object.assign(this, { rest, firebase, config, env, modules, log, restart, now, version });
    this.startedAt = now();
    this.running = featuresOf(config); // what this process started with
    this.handled = new Set();
    this.chain = Promise.resolve();
  }

  start() {
    const app = (this.app = initializeApp({ projectId: this.firebase.projectId, apiKey: this.firebase.apiKey }, `bot-control-${++apps}`));
    const db = getFirestore(app);
    if (this.firebase.emulator) {
      const { hostname, port } = new URL(this.firebase.emulator.firestore);
      connectFirestoreEmulator(db, hostname, Number(port));
    }
    this.unsubSettings = onSnapshot(doc(db, 'botControl', 'settings'), (snap) => this.settingsChanged(snap.exists() ? snap.data() : null),
      (err) => this.log.error('[control] watching settings stopped:', err.message));
    this.unsubCommands = onSnapshot(collection(db, 'botCommands'), (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type === 'removed') continue;
        const d = change.doc.data();
        if (d.status === 'pending') this.queue(change.doc.id, d);
      }
    }, (err) => this.log.error('[control] watching commands stopped:', err.message));
    this.timer = setInterval(() => this.sendStatus(), HEARTBEAT);
    this.timer.unref?.();
    this.log.info?.('[control] the site’s Bot panel is linked');
    return this.sendStatus();
  }

  stop() {
    this.unsubSettings?.();
    this.unsubCommands?.();
    if (this.timer) clearInterval(this.timer);
    if (this.app) deleteApp(this.app).catch(() => {});
  }

  run(fn) {
    const result = this.chain.then(fn);
    this.chain = result.catch((err) => this.log.error('[control]', err.message));
    return result;
  }

  // New settings from the site: timings now; feature switches need a restart.
  settingsChanged(settings) {
    return this.run(async () => {
      const next = applySettings({ ...this.config }, settings, this.env);
      for (const name of Object.keys(TIMINGS)) this.config[name] = next[name];
      const want = featuresOf(next);
      const changed = Object.keys(FEATURES).filter((k) => want[k] !== this.running[k]);
      if (changed.length) {
        this.log.info?.(`[control] switched ${changed.map((k) => `${k} ${want[k] ? 'on' : 'off'}`).join(', ')} on the site: restarting`);
        await this.sendStatus({ restarting: true });
        this.restart();
        return;
      }
      await this.sendStatus();
    });
  }

  queue(id, d) {
    if (this.handled.has(id)) return;
    this.handled.add(id);
    return this.run(() => this.runCommand(id, d));
  }

  async runCommand(id, d) {
    const finish = (status, result) => this.rest.commit([{ path: `botCommands/${id}`, data: { status, result: String(result).slice(0, 300), doneAt: this.now(), updatedBy: 'pickup-bot', updatedAt: this.now() }, mask: ['status', 'result', 'doneAt', 'updatedBy', 'updatedAt'] }])
      .catch((err) => this.log.warn('[control] could not save a command result:', err.message));
    const created = d.createdAt instanceof Date ? d.createdAt.getTime() : typeof d.createdAt === 'number' ? d.createdAt : d.createdAt?.toMillis?.() ?? this.now();
    if (this.now() - created > STALE) return finish('failed', 'Too old: the bot was offline when it was sent. Press it again.');
    try {
      const result = await this.act(d);
      this.log.info?.(`[control] ${d.action}: ${result}`);
      await finish('done', result);
      if (d.action === 'restart') this.restart();
      else await this.sendStatus();
    } catch (err) {
      this.log.warn(`[control] ${d.action} failed:`, err.message);
      await finish('failed', err.message);
    }
  }

  async act(d) {
    const m = this.modules();
    switch (d.action) {
      case 'syncRoles': {
        const done = [];
        if (m.clubRoles) { await m.clubRoles.fullSync(); done.push('club roles'); }
        if (m.statRoles) { await m.statRoles.sync(); done.push('award roles'); }
        if (!done.length) throw new Error('Club roles and award roles are both off.');
        return `Synced ${done.join(' and ')}.`;
      }
      case 'repostCards': {
        await m.pickup?.run(() => m.pickup.renderQueue({ repost: true }));
        if (m.ranked) await m.ranked.run(() => m.ranked.renderCard({ repost: true }));
        return `Posted the queue card${m.ranked ? 's' : ''} again.`;
      }
      case 'checkThreads': {
        if (!m.matches) throw new Error('Match threads are off.');
        await m.matches.sync();
        return 'Checked every match thread.';
      }
      case 'closeThreads': {
        if (!m.matches) throw new Error('Match threads are off.');
        const n = await m.matches.closeAll();
        return `Closed ${n} thread${n === 1 ? '' : 's'}.`;
      }
      case 'clearEventThreads': {
        if (!m.matches) throw new Error('Match threads are off, so the bot can’t reach them. Turn them on first.');
        if (!d.eventId) throw new Error('No event given.');
        const n = await m.matches.clearEvent(String(d.eventId));
        return `Deleted ${n} thread${n === 1 ? '' : 's'}.`;
      }
      case 'restart':
        return 'Restarting (back in about 15 seconds).';
      default:
        throw new Error(`Unknown action ${d.action}.`);
    }
  }

  // What's running, for the panel.
  status() {
    const m = this.modules();
    const threads = m.matches ? [...m.matches.threads.values()] : [];
    const byEvent = {};
    for (const t of threads) {
      const e = (byEvent[t.eventId] ??= { open: 0, total: 0 });
      e.total++;
      if (t.status !== 'closed') e.open++;
    }
    return {
      at: this.now(),
      startedAt: this.startedAt,
      version: this.version,
      features: this.running,
      available: availableFeatures(this.env),
      timings: Object.fromEntries(Object.keys(TIMINGS).map((k) => [k, this.config[k]])),
      counts: {
        queue: m.pickup ? m.pickup.readyList().length : 0,
        games: m.pickup ? [...m.pickup.games.values()].filter((g) => g.status === 'playing' || g.status === 'disputed').length : 0,
        threadsOpen: threads.filter((t) => t.status !== 'closed').length,
        threads: threads.length,
      },
      threadsByEvent: byEvent,
    };
  }

  sendStatus(extra = {}) {
    return this.rest.commit([{ path: 'botControl/status', data: { ...this.status(), ...extra, updatedBy: 'pickup-bot', updatedAt: this.now() } }])
      .catch((err) => this.log.warn('[control] could not send the status:', err.message));
  }
}

// Watches the site's public data live for the match threads (matches.js): published events, and
// for each event that's on or coming up, its fixtures, results and votes; plus every club and
// player. Firebase SDK listeners (like site-queue.js): one read per document at the start, then
// only what changes, so it stays inside the free allowance.
//
//   const site = new SiteWatch({ firebase, onChange, log }); site.start()
//   site.bundles() -> [{ event, fixtures, results: { fixtureId: result }, submissions, checkins, rosters }]
//   site.teams / site.players -> Map id -> doc
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, collection, query, where, onSnapshot } from 'firebase/firestore';

const DAY = 24 * 3600 * 1000;
let apps = 0;

// Firestore timestamps -> milliseconds, like the site's data.js.
export function plain(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
}
const asObj = (d) => ({ id: d.id, ...plain(d.data({ serverTimestamps: 'estimate' })) });

// Events worth watching: not finished or cancelled, starting within a day or started in the last
// three days (or no date yet).
export function activeEvent(e, now) {
  if (!e || e.published !== true || e.status !== 'upcoming') return false;
  if (!e.date) return true;
  return e.date - now < DAY && now - e.date < 3 * DAY;
}

export class SiteWatch {
  constructor({ firebase, onChange = () => {}, log = console, now = () => Date.now() }) {
    Object.assign(this, { firebase, onChange, log, now });
    this.events = new Map();
    this.teams = new Map();
    this.players = new Map();
    this.perEvent = new Map(); // eventId -> { fixtures, results, submissions, stops: [] }
    this.stops = [];
    this.loaded = new Set(); // 'teams', 'players', 'events' once their first snapshot is in
  }

  // Everything has loaded at least once (so a missing match really is missing).
  ready() {
    if (this.loaded.size < 3) return false;
    for (const per of this.perEvent.values()) if (per.loaded.size < 3) return false;
    return true;
  }

  start() {
    const app = (this.app = initializeApp({ projectId: this.firebase.projectId, apiKey: this.firebase.apiKey }, `match-site-${++apps}`));
    const db = (this.db = getFirestore(app));
    if (this.firebase.emulator) {
      const { hostname, port } = new URL(this.firebase.emulator.firestore);
      connectFirestoreEmulator(db, hostname, Number(port));
    }
    const fail = (what) => (err) => this.log.error(`[matches] watching ${what} stopped:`, err.message);
    this.stops.push(onSnapshot(collection(db, 'teams'), (snap) => {
      this.teams = new Map(snap.docs.map((d) => [d.id, asObj(d)]));
      this.loaded.add('teams');
      this.changed();
    }, fail('clubs')));
    this.stops.push(onSnapshot(collection(db, 'players'), (snap) => {
      this.players = new Map(snap.docs.map((d) => [d.id, asObj(d)]));
      this.loaded.add('players');
      this.changed();
    }, fail('players')));
    this.stops.push(onSnapshot(query(collection(db, 'events'), where('published', '==', true)), (snap) => {
      this.events = new Map(snap.docs.map((d) => [d.id, asObj(d)]));
      this.loaded.add('events');
      this.follow();
      this.changed();
    }, fail('events')));
    // Events drift in and out of the window as time passes.
    this.timer = setInterval(() => this.follow(), 10 * 60 * 1000);
    this.timer.unref?.();
  }

  // Start or stop watching each event's fixtures, results and votes.
  follow() {
    const now = this.now();
    for (const [id, e] of this.events) {
      if (!activeEvent(e, now) || this.perEvent.has(id)) continue;
      const per = { fixtures: [], results: {}, submissions: [], checkins: [], rosters: {}, stops: [], loaded: new Set() };
      this.perEvent.set(id, per);
      const watch = (sub, set) => per.stops.push(onSnapshot(collection(this.db, `events/${id}/${sub}`), (snap) => {
        set(snap.docs.map(asObj));
        per.loaded.add(sub);
        this.changed();
      }, (err) => {
        per.loaded.add(sub); // treat it as empty rather than waiting for ever
        this.log.warn(`[matches] watching ${sub} of ${id} stopped:`, err.message);
      }));
      watch('fixtures', (docs) => { per.fixtures = docs.map((f) => ({ ...f, round: f.order ?? 0 })); });
      watch('results', (docs) => { per.results = Object.fromEntries(docs.map((r) => [r.id, r])); });
      watch('submissions', (docs) => { per.submissions = docs; });
      // Check-ins (site-rules/flow.js, once per event) and rosters (mix teams' players).
      watch('checkins', (docs) => { per.checkins = docs; });
      watch('rosters', (docs) => { per.rosters = Object.fromEntries(docs.map((r) => [r.id, r])); });
    }
    for (const [id, per] of [...this.perEvent]) {
      if (activeEvent(this.events.get(id), now)) continue;
      per.stops.forEach((s) => s());
      this.perEvent.delete(id);
      this.changed();
    }
  }

  // Grouped: lots of changes arrive together at the start.
  changed() {
    clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => this.onChange(), 800);
  }

  // Every watched event, once its fixtures, results and votes have all loaded.
  bundles() {
    const out = [];
    for (const [id, per] of this.perEvent) {
      const event = this.events.get(id);
      if (!event || per.loaded.size < 5) continue;
      out.push({ event, fixtures: per.fixtures, results: per.results, submissions: per.submissions, checkins: per.checkins, rosters: per.rosters });
    }
    return out;
  }

  stop() {
    this.stops.forEach((s) => s());
    for (const per of this.perEvent.values()) per.stops.forEach((s) => s());
    clearInterval(this.timer);
    clearTimeout(this.changeTimer);
    if (this.app) deleteApp(this.app).catch(() => {});
  }
}

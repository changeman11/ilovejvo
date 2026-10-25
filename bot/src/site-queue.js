// Links the pickup queue to the I<3JVO website (needs STORE=firebase).
//
// - pickupSignups/{discordId} = { discordId, name, signedUpAt }: one per signed-up player.
//   Players signed in with Discord on the site add or delete their own. The bot watches the
//   collection live: a new doc signs that player up, a deleted doc withdraws them. The bot also
//   writes a doc for Discord sign-ups (so the site can withdraw those too) and deletes the doc
//   whenever someone leaves the queue (withdrew, picked, dropped).
//   A player's mode vote is the doc's `vote` field, and `random: true` is a vote for random teams
//   instead of a draft (they can change both on the site; the bot copies Discord votes there too).
// - pickupControl/mode = { size, once }: the admin-set mode (null size = community votes). Admins
//   set it on the site; /pickup setmode on Discord writes it too.
// - pickupMeta/live = the queue, ready checks, drafts and games on (Pickup.liveState()), for the
//   site's pickup page. Re-sent every 5 minutes so the site can tell the bot is running.
//
// Reads go through the Firebase SDK's live listener (no polling, so reads stay tiny); writes go
// through the bot's own signed-in REST client (store.rest).
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, collection, doc, onSnapshot } from 'firebase/firestore';

const HEARTBEAT = 5 * 60 * 1000;
let apps = 0;

export class SiteQueue {
  constructor({ rest, firebase, log = console }) {
    Object.assign(this, { rest, firebase, log });
    this.docs = new Map(); // discord id -> { vote, random } for everyone with a pickupSignups doc
    this.control = undefined; // the admin-set mode as last seen/written (JSON), undefined = not read yet
    this.pickup = null;
    this.unsubscribe = null;
    this.heartbeat = null;
  }

  attach(pickup) {
    this.pickup = pickup;
  }

  start() {
    const app = (this.app = initializeApp({ projectId: this.firebase.projectId, apiKey: this.firebase.apiKey }, `pickup-site-${++apps}`));
    const db = getFirestore(app);
    if (this.firebase.emulator) {
      const { hostname, port } = new URL(this.firebase.emulator.firestore);
      connectFirestoreEmulator(db, hostname, Number(port));
    }
    this.unsubscribe = onSnapshot(
      collection(db, 'pickupSignups'),
      (snap) => {
        for (const change of snap.docChanges()) {
          const id = change.doc.id;
          const d = change.doc.data();
          const vote = Number.isInteger(d.vote) ? d.vote : null;
          const random = d.random === true;
          if (change.type === 'added') {
            this.docs.set(id, { vote, random });
            if (!this.pickup.queue.has(id)) this.pickup.siteJoin(id, String(d.name ?? id).slice(0, 60), d.signedUpAt?.toMillis?.() ?? Date.now());
            if (vote) this.pickup.siteVote(id, vote);
            if (random) this.pickup.siteRandom?.(id, true);
          } else if (change.type === 'modified') {
            const known = this.docs.get(id);
            if (known && known.vote === vote && known.random === random) continue; // our own write coming back
            this.docs.set(id, { vote, random });
            if (!known || known.vote !== vote) this.pickup.siteVote(id, vote);
            if (!known || known.random !== random) this.pickup.siteRandom?.(id, random);
          } else if (change.type === 'removed') {
            this.docs.delete(id);
            this.pickup.siteLeave(id);
          }
        }
      },
      (err) => this.log.error('[site] watching sign-ups stopped:', err.message),
    );
    // The admin-set mode. Missing doc: the bot's own setting is written there.
    this.unsubscribeControl = onSnapshot(
      doc(db, 'pickupControl', 'mode'),
      (snap) => {
        const d = snap.exists() ? snap.data() : null;
        if (!d) {
          if (this.control === undefined) this.modeSet(this.pickup.fixedMode);
          return;
        }
        const fixed = Number.isInteger(d.size) ? { size: d.size, once: Boolean(d.once) } : null;
        const json = JSON.stringify(fixed);
        if (json === this.control) return;
        this.control = json;
        this.pickup.siteSetMode(fixed);
      },
      (err) => this.log.error('[site] watching the mode setting stopped:', err.message),
    );
    this.heartbeat = setInterval(() => this.pickup.publishNow({ force: true }), HEARTBEAT);
    this.pickup.publishNow({ force: true });
    this.log.info?.('[site] linked to the website queue');
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribeControl?.();
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.app) deleteApp(this.app).catch(() => {});
  }

  // Someone signed up. From Discord: add their doc so the site shows them and can withdraw them.
  joined(entry) {
    if (entry.from !== 'discord' || entry.fake || this.docs.has(entry.id)) return;
    this.docs.set(entry.id, { vote: null, random: false });
    this.write([{ path: `pickupSignups/${entry.id}`, data: { discordId: entry.id, name: entry.name, signedUpAt: entry.joinedAt } }]);
  }

  // Someone is no longer signed up: remove their doc.
  left(id) {
    if (!this.docs.has(id)) return;
    this.docs.delete(id);
    this.write([{ delete: `pickupSignups/${id}` }]);
  }

  // A mode vote changed in the bot: copy it to the player's sign-up doc (if it's different).
  voted(id, size) {
    const known = this.docs.get(id);
    if (!known || known.vote === (size ?? null)) return;
    known.vote = size ?? null;
    this.write([{ path: `pickupSignups/${id}`, data: { vote: size ?? null }, mask: ['vote'] }]);
  }

  // A random-teams vote changed in the bot: copy it to the player's sign-up doc.
  votedRandom(id, on) {
    const known = this.docs.get(id);
    if (!known || known.random === Boolean(on)) return;
    known.random = Boolean(on);
    this.write([{ path: `pickupSignups/${id}`, data: { random: Boolean(on) }, mask: ['random'] }]);
  }

  // The admin-set mode changed in the bot (/pickup setmode, or used up after one game).
  modeSet(fixed) {
    const json = JSON.stringify(fixed ?? null);
    if (json === this.control) return;
    this.control = json;
    this.write([{ path: 'pickupControl/mode', data: { size: fixed?.size ?? null, once: Boolean(fixed?.once), updatedBy: 'pickup-bot', updatedAt: Date.now() } }]);
  }

  publish(state) {
    return this.rest.commit([{ path: 'pickupMeta/live', data: state }]);
  }

  write(writes) {
    this.rest.commit(writes).catch((err) => this.log.warn('[site] could not update sign-ups:', err.message));
  }
}

// The same for the 1v1 ranked queue (ranked.js): rankedSignups/{discordId} = { discordId, name,
// signedUpAt } (players add/delete their own on the site; the bot adds Discord ones and deletes
// anyone who leaves the queue), and pickupMeta/live1v1 = the 1v1 queue and fixtures.
export class RankedSiteQueue {
  constructor({ rest, firebase, log = console }) {
    Object.assign(this, { rest, firebase, log });
    this.docs = new Set();
    this.ranked = null;
  }

  attach(ranked) {
    this.ranked = ranked;
  }

  start() {
    const app = (this.app = initializeApp({ projectId: this.firebase.projectId, apiKey: this.firebase.apiKey }, `ranked-site-${++apps}`));
    const db = getFirestore(app);
    if (this.firebase.emulator) {
      const { hostname, port } = new URL(this.firebase.emulator.firestore);
      connectFirestoreEmulator(db, hostname, Number(port));
    }
    this.unsubscribe = onSnapshot(
      collection(db, 'rankedSignups'),
      (snap) => {
        for (const change of snap.docChanges()) {
          const id = change.doc.id;
          if (change.type === 'added') {
            this.docs.add(id);
            if (!this.ranked.queue.some((p) => p.id === id)) this.ranked.siteJoin(id, String(change.doc.data().name ?? id).slice(0, 60));
          } else if (change.type === 'removed') {
            this.docs.delete(id);
            this.ranked.siteLeave(id);
          }
        }
      },
      (err) => this.log.error('[site] watching 1v1 sign-ups stopped:', err.message),
    );
    this.heartbeat = setInterval(() => this.ranked.publishNow({ force: true }), HEARTBEAT);
    this.ranked.publishNow({ force: true });
  }

  stop() {
    this.unsubscribe?.();
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.app) deleteApp(this.app).catch(() => {});
  }

  joined(entry) {
    if (entry.from !== 'discord' || this.docs.has(entry.id)) return;
    this.docs.add(entry.id);
    this.write([{ path: `rankedSignups/${entry.id}`, data: { discordId: entry.id, name: entry.name, signedUpAt: entry.at } }]);
  }

  left(id) {
    if (!this.docs.has(id)) return;
    this.docs.delete(id);
    this.write([{ delete: `rankedSignups/${id}` }]);
  }

  publish(state) {
    return this.rest.commit([{ path: 'pickupMeta/live1v1', data: state }]);
  }

  write(writes) {
    this.rest.commit(writes).catch((err) => this.log.warn('[site] could not update 1v1 sign-ups:', err.message));
  }
}

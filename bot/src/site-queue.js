// Links the pickup queue to the I<3JVO website (needs STORE=firebase).
//
// - pickupSignups/{discordId} = { discordId, name, signedUpAt }: one per signed-up player.
//   Players signed in with Discord on the site add or delete their own. The bot watches the
//   collection live: a new doc signs that player up, a deleted doc withdraws them. The bot also
//   writes a doc for Discord sign-ups (so the site can withdraw those too) and deletes the doc
//   whenever someone leaves the queue (withdrew, picked, dropped).
// - pickupMeta/live = the queue, ready checks, drafts and games on (Pickup.liveState()), for the
//   site's pickup page. Re-sent every 5 minutes so the site can tell the bot is running.
//
// Reads go through the Firebase SDK's live listener (no polling, so reads stay tiny); writes go
// through the bot's own signed-in REST client (store.rest).
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, collection, onSnapshot } from 'firebase/firestore';

const HEARTBEAT = 5 * 60 * 1000;
let apps = 0;

export class SiteQueue {
  constructor({ rest, firebase, log = console }) {
    Object.assign(this, { rest, firebase, log });
    this.docs = new Set(); // discord ids that have a pickupSignups doc
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
          if (change.type === 'added') {
            this.docs.add(id);
            const d = change.doc.data();
            if (!this.pickup.queue.has(id)) this.pickup.siteJoin(id, String(d.name ?? id).slice(0, 60), d.signedUpAt?.toMillis?.() ?? Date.now());
          } else if (change.type === 'removed') {
            this.docs.delete(id);
            this.pickup.siteLeave(id);
          }
        }
      },
      (err) => this.log.error('[site] watching sign-ups stopped:', err.message),
    );
    this.heartbeat = setInterval(() => this.pickup.publishNow({ force: true }), HEARTBEAT);
    this.pickup.publishNow({ force: true });
    this.log.info?.('[site] linked to the website queue');
  }

  stop() {
    this.unsubscribe?.();
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.app) deleteApp(this.app).catch(() => {});
  }

  // Someone signed up. From Discord: add their doc so the site shows them and can withdraw them.
  joined(entry) {
    if (entry.from !== 'discord' || entry.fake || this.docs.has(entry.id)) return;
    this.docs.add(entry.id);
    this.write([{ path: `pickupSignups/${entry.id}`, data: { discordId: entry.id, name: entry.name, signedUpAt: entry.joinedAt } }]);
  }

  // Someone is no longer signed up: remove their doc.
  left(id) {
    if (!this.docs.has(id)) return;
    this.docs.delete(id);
    this.write([{ delete: `pickupSignups/${id}` }]);
  }

  publish(state) {
    return this.rest.commit([{ path: 'pickupMeta/live', data: state }]);
  }

  write(writes) {
    this.rest.commit(writes).catch((err) => this.log.warn('[site] could not update sign-ups:', err.message));
  }
}

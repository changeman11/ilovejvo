// #transfer-hub (added 2026-11-21, TRANSFER_HUB=0 turns it off): every club move on the site
// (transfers collection: joins, leaves, releases, new clubs, disbands) is posted to a read-only
// channel where members can react but not talk. Checks the site every TRANSFER_HUB_SECONDS (60)
// for transfers newer than the last check (public data, no sign-in).
// The first time, it posts the last few (BACKFILL) so the channel isn't empty, then only new ones.
// Remembered in the store's meta: transferHub = { since: ms, posted: [last 300 ids] }.
//
// io: { post(body) } (discord-io.js transferIo). site: SiteReader (changedSince, list).
import { transferPost, toPost } from './logic/transfer-hub.js';

const BACKFILL = 8;
const SKEW = 2 * 60 * 1000;

export class TransferHub {
  constructor({ io, site, store, config, log = console, now = () => Date.now() }) {
    Object.assign(this, { io, site, store, config, log, now });
    this.chain = Promise.resolve();
  }

  start() {
    this.timer = setInterval(() => this.sync(), (this.config.transferHubSeconds ?? 60) * 1000);
    this.timer.unref?.();
    return this.sync();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  sync() {
    const run = this.chain.then(() => this.syncNow());
    this.chain = run.catch((err) => this.log.warn('[transfer hub]', err.message));
    return run;
  }

  async syncNow() {
    const meta = this.store.getMeta('transferHub');
    const started = this.now();
    let list;
    const seen = new Set(meta?.posted ?? []);
    if (!meta) {
      // First run: the last few moves, so the channel starts with something in it. The older ones
      // count as seen, so they're never posted later.
      const everything = (await this.site.list('transfers')).sort((a, b) => (b.data.at ?? 0) - (a.data.at ?? 0));
      list = everything.slice(0, BACKFILL);
      for (const t of everything.slice(BACKFILL)) seen.add(t.id);
    } else {
      // `since` moves on in memory every check; it's only saved when something was posted.
      list = await this.site.changedSince('transfers', (this.since ?? meta.since) - SKEW);
    }
    const fresh = toPost(list, seen);
    if (fresh.length) {
      const [players, teams] = await Promise.all([this.site.list('players'), this.site.list('teams')]);
      const ctx = {
        players: new Map(players.map((d) => [d.id, d.data])),
        teams: new Map(teams.map((d) => [d.id, d.data])),
        siteUrl: this.config.siteUrl,
        bucket: this.config.firebase?.storageBucket,
      };
      for (const t of fresh) {
        await this.io.post(transferPost({ id: t.id, ...t.data }, ctx));
        seen.add(t.id);
      }
      this.log.info?.(`[transfer hub] posted ${fresh.length} transfer${fresh.length === 1 ? '' : 's'}`);
    }
    this.since = started;
    if (fresh.length || !meta) await this.store.setMeta('transferHub', { since: started, posted: [...seen].slice(-500) });
    return fresh.length;
  }
}

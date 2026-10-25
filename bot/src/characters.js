// Community characters (CHARACTERS=1, needs STORE=firebase): pictures posted in
// #in-game-characters join the site's Home court by themselves. Every CHARACTERS_MINUTES (5) the
// bot reads the channel (so posts made while it was off are picked up too) and:
//   - cuts each new picture out of its plain background (logic/cutout.js, same as the site's
//     scripts/cut-characters.mjs); screenshots, player cards, scenes and black backgrounds are skipped
//   - skips repeats: a small fingerprint is compared with every character already on the site
//   - uploads the cut-out to Storage (characters/discord-<message>-<n>.png), lists it in Firestore
//     (characters/{key}) as 'pending' with ⏳ on the post; an admin approves it on the site
//     (/admin/characters), then the post gets ✅ (or 🚫 if denied)
//   - takes a character off the site when its post is deleted, or a staff member reacts ❌
// Pictures already handled by hand (the site's images/characters/list.json and skipped.json) are
// left alone. What it decided about each picture is remembered in the store meta `charactersSeen`.
import sharp from 'sharp';
import { cutout, printDiff, REPEAT_LIMIT } from './logic/cutout.js';

const HEIGHT = 640;
const IMAGE = /^image\/(png|jpeg|webp)$/;

// The fingerprint: the cut-out on white, shrunk to 12×16 (RGB values).
async function printOf(png) {
  const { data } = await sharp(png).flatten({ background: '#ffffff' }).resize(12, 16, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  return Array.from(data);
}

export class Characters {
  constructor({ io, rest, site, store, config, log = console, fetchFn = fetch }) {
    Object.assign(this, { io, rest, site, store, config, log, fetchFn });
    this.chain = Promise.resolve();
    this.prints = new Map(); // key -> fingerprint of every character on the site
  }

  start() {
    this.timer = setInterval(() => this.sync().catch(() => {}), this.config.charactersMinutes * 60 * 1000);
    this.timer.unref?.();
    return this.sync();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  sync() {
    const run = this.chain.then(() => this.syncNow());
    this.chain = run.catch((err) => this.log.error('[characters]', err.message));
    return run;
  }

  // The hand-made list on the site (and the pictures set aside by hand), with fingerprints.
  async siteLists() {
    const get = async (file) => {
      const res = await this.fetchFn(`${this.config.siteUrl}/images/characters/${file}`).catch(() => null);
      return res?.ok ? res.json().catch(() => []) : [];
    };
    const [list, skipped] = await Promise.all([get('list.json'), get('skipped.json')]);
    for (const name of list) {
      const key = name.replace(/\.png$/, '');
      if (this.prints.has(key)) continue;
      try {
        const res = await this.fetchFn(`${this.config.siteUrl}/images/characters/${name}`);
        if (res.ok) this.prints.set(key, await printOf(Buffer.from(await res.arrayBuffer())));
      } catch { /* try again next time */ }
    }
    return { list: new Set(list.map((n) => n.replace(/\.png$/, ''))), skipped: new Set(skipped.map((n) => n.replace(/\.\w+$/, ''))) };
  }

  // Swaps the bot's reaction on a post (old -> new). Returns what's shown now.
  async mark(channelId, messageId, old, emoji) {
    try {
      if (old) await this.io.unreact?.(channelId, messageId, old);
      await this.io.react(channelId, messageId, emoji);
      return emoji;
    } catch (err) {
      this.log.warn('[characters] could not react:', err.message);
      return old;
    }
  }

  async syncNow() {
    const channelId = this.io.channelId();
    if (!channelId) {
      this.log.warn(`[characters] no #${this.config.charactersChannel} channel found`);
      return { added: 0, removed: 0 };
    }
    const [posts, lists, docs] = await Promise.all([
      this.io.posts(channelId), // throws if the history can't be read: then nothing is removed
      this.siteLists(),
      this.site.list('characters'),
    ]);
    const added = new Map(docs.map((d) => [d.id, d.data]));
    for (const [key, d] of added) if (d.print && !this.prints.has(key)) this.prints.set(key, d.print);
    const seen = { ...(this.store.getMeta('charactersSeen') ?? {}) };
    const bucket = this.config.firebase.storageBucket;
    let addedNow = 0;
    let removedNow = 0;
    let rejectedNow = 0;
    // The reaction on each post follows the admin's decision: ⏳ waiting, ✅ approved, 🚫 denied.
    // Remembered per character (store meta charactersShown); ones added before approvals existed
    // already have ✅.
    const shown = { ...(this.store.getMeta('charactersShown') ?? {}) };

    // Taken off: the post was deleted, or a staff member reacted ❌.
    const byId = new Map(posts.map((p) => [p.id, p]));
    for (const [key, d] of added) {
      const post = byId.get(d.messageId);
      let why = post ? null : 'post deleted';
      if (!why) for (const u of post.crossedBy) if (await this.io.isStaff(u)) { why = 'staff ❌'; break; }
      if (!why) continue;
      try {
        await this.rest.commit([{ delete: `characters/${key}` }]);
        await this.rest.removeFile(bucket, d.path).catch(() => {});
        added.delete(key);
        this.prints.delete(key);
        seen[key] = `removed (${why})`;
        removedNow++;
        this.log.info?.(`[characters] took ${key} off the site (${why})`);
      } catch (err) {
        this.log.warn('[characters] could not remove', key, err.message);
      }
    }

    for (const [key, d] of added) {
      const want = { pending: '⏳', approved: '✅', denied: '🚫' }[d.status ?? 'approved'];
      const have = shown[key] ?? (d.status ? null : '✅');
      if (want && want !== have && byId.has(d.messageId)) shown[key] = await this.mark(channelId, d.messageId, have, want);
    }

    // New pictures, oldest first. Only a staff member's ❌ counts (anyone can react ❌ as a joke).
    const staffCrossed = async (post) => { for (const u of post.crossedBy) if (await this.io.isStaff(u)) return true; return false; };
    for (const post of [...posts].reverse()) {
      if (post.bot) continue;
      const crossed = post.crossedBy.length > 0 && await staffCrossed(post);
      for (const [i, img] of post.images.entries()) {
        const key = `discord-${post.id}-${i}`;
        // (Before 2026-10-25 anyone's ❌ skipped a picture: those are looked at again.)
        const retry = /❌ on the post/.test(seen[key] ?? '') && !crossed;
        if (!IMAGE.test(img.contentType) || added.has(key) || (seen[key] && !retry) || lists.list.has(key) || lists.skipped.has(key)) continue;
        if (crossed) { seen[key] = 'skipped (staff ❌ on the post)'; continue; }
        try {
          const raw = await this.io.download(img.url);
          const { data, info } = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          const cut = cutout({ data, width: info.width, height: info.height });
          if (!cut.ok) { seen[key] = `skipped: ${cut.reason}`; rejectedNow++; continue; }
          for (let p = 0; p < cut.mask.length; p++) if (cut.mask[p]) data[p * 4 + 3] = 0;
          const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
            .extract({ left: cut.box.x, top: cut.box.y, width: cut.box.w, height: cut.box.h })
            .resize({ height: HEIGHT }).png({ compressionLevel: 9 }).toBuffer();
          const print = await printOf(png);
          const twin = [...this.prints].map(([k, q]) => [k, printDiff(print, q)]).sort((a, b) => a[1] - b[1])[0];
          if (twin && twin[1] < REPEAT_LIMIT) { seen[key] = `skipped: repeat of ${twin[0]}`; rejectedNow++; continue; }
          const path = `characters/${key}.png`;
          await this.rest.upload(bucket, path, png, 'image/png');
          // Waits for an admin (/admin/characters) before it shows on the site (2026-10-25).
          const doc = { key, path, messageId: post.id, author: post.authorName ?? null, authorId: post.authorId ?? null, postedAt: post.postedAt, print, status: 'pending' };
          await this.rest.commit([{ path: `characters/${key}`, data: doc, serverTime: ['addedAt'], mustNotExist: true }]);
          added.set(key, doc);
          this.prints.set(key, print);
          seen[key] = 'added';
          addedNow++;
          this.log.info?.(`[characters] added ${key} (posted by ${post.authorName ?? post.authorId})`);
          shown[key] = await this.mark(channelId, post.id, null, '⏳');
        } catch (err) {
          this.log.warn('[characters] could not add', key, err.message); // tried again next time
        }
      }
    }
    if (JSON.stringify(seen) !== JSON.stringify(this.store.getMeta('charactersSeen') ?? {})) await this.store.setMeta('charactersSeen', seen);
    if (JSON.stringify(shown) !== JSON.stringify(this.store.getMeta('charactersShown') ?? {})) await this.store.setMeta('charactersShown', shown);
    if (addedNow || removedNow || rejectedNow) this.log.info?.(`[characters] ${addedNow} added, ${removedNow} taken off, ${rejectedNow} skipped`);
    return { added: addedNow, removed: removedNow, rejected: rejectedNow };
  }
}

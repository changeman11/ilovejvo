import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Characters } from '../src/characters.js';
import { FileStore } from '../src/store/file-store.js';

// A character picture: grey background, a black-outlined coloured body (PNG bytes).
async function picture({ w = 120, h = 180, bg = [58, 58, 64], body = [230, 80, 60] } = {}) {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = x >= 35 && x < 85 && y >= 20 && y < 160;
      const edge = inside && (x < 37 || x >= 83 || y < 22 || y >= 158);
      data.set([...(edge ? [0, 0, 0] : inside ? body : bg), 255], (y * w + x) * 4);
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

function setup({ posts, docs = [], siteList = [], skipped = [] }) {
  const files = new Map();
  const reacted = [];
  const commits = [];
  const removed = [];
  const io = {
    channelId: () => '900000000000000000',
    posts: async () => posts,
    react: async (c, m, e) => { reacted.push([m, e]); },
    isStaff: async (u) => u === 'staff1',
    download: async (url) => files.get(url),
  };
  const rest = {
    upload: async (bucket, path) => path,
    commit: async (writes) => { commits.push(...writes); },
    removeFile: async (bucket, path) => { removed.push(path); },
  };
  const site = { list: async () => docs };
  const json = (body) => ({ ok: true, json: async () => body });
  const fetchFn = async (url) => (url.endsWith('list.json') ? json(siteList) : url.endsWith('skipped.json') ? json(skipped) : { ok: false });
  const store = new FileStore();
  const config = { charactersMinutes: 5, charactersChannel: 'in-game-characters', siteUrl: 'https://site', firebase: { storageBucket: 'b' } };
  const ch = new Characters({ io, rest, site, store, config, fetchFn, log: { info() {}, warn() {}, error() {} } });
  return { ch, files, reacted, commits, removed, store };
}

const post = (id, urls, extra = {}) => ({ id, authorId: 'u1', authorName: 'Fan', postedAt: 1790000000000, images: urls.map((url) => ({ url, contentType: 'image/png' })), crossedBy: [], ...extra });

test('characters: a new picture is cut out, added and ticked; screenshots, repeats and known ones are skipped', async () => {
  const id = (n) => `15634${String(n).padStart(14, '0')}`;
  // Newest first, as Discord returns them.
  const posts = [post(id(4), ['known']), post(id(3), ['again']), post(id(2), ['wide']), post(id(1), ['good'])];
  const { ch, files, reacted, commits, store } = setup({ posts, siteList: [`discord-${id(4)}-0.png`] });
  files.set('good', await picture());
  files.set('wide', await picture({ w: 300, h: 180 }));
  files.set('again', await picture()); // the same character posted again
  files.set('known', await picture({ body: [40, 90, 230] }));
  const r = await ch.sync();
  assert.equal(r.added, 1);
  assert.deepEqual(commits.map((w) => w.path), [`characters/discord-${id(1)}-0`]);
  assert.equal(commits[0].data.path, `characters/discord-${id(1)}-0.png`);
  assert.deepEqual(reacted, [[id(1), '✅']]);
  const seen = store.getMeta('charactersSeen');
  assert.match(seen[`discord-${id(2)}-0`], /wide/);
  assert.match(seen[`discord-${id(3)}-0`], /repeat/);
  assert.equal(seen[`discord-${id(4)}-0`], undefined, 'already on the site by hand: left alone');
  // Nothing new next time.
  assert.equal((await ch.sync()).added, 0);
});

test('characters: taken off when the post is deleted or a staff member reacts ❌ (not anyone else)', async () => {
  const id = (n) => `15635${String(n).padStart(14, '0')}`;
  const docs = [
    { id: `discord-${id(1)}-0`, data: { path: `characters/discord-${id(1)}-0.png`, messageId: id(1) } },
    { id: `discord-${id(2)}-0`, data: { path: `characters/discord-${id(2)}-0.png`, messageId: id(2) } },
    { id: `discord-${id(3)}-0`, data: { path: `characters/discord-${id(3)}-0.png`, messageId: id(3) } },
  ];
  // id(1)'s post is gone; id(2) has a staff ❌; id(3) has a ❌ from someone else.
  const posts = [post(id(2), [], { crossedBy: ['staff1'] }), post(id(3), [], { crossedBy: ['randomFan'] })];
  const { ch, commits, removed } = setup({ posts, docs });
  const r = await ch.sync();
  assert.equal(r.removed, 2);
  assert.deepEqual(commits.map((w) => w.delete).sort(), [`characters/discord-${id(1)}-0`, `characters/discord-${id(2)}-0`]);
  assert.equal(removed.length, 2);
});

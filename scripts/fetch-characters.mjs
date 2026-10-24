// Downloads the character pictures people post in the Discord channel #in-game-characters into
// art-src/community/, ready for scripts/cut-characters.mjs (which cuts them out for the Home court).
// Uses the pickup bot's token and server from bot/.env (never printed). Skips pictures it already has.
//
//   node scripts/fetch-characters.mjs && node scripts/cut-characters.mjs
//
// Then look at the new pictures: anything that isn't one character on a plain (not black) background
// (screenshots, player cards, repeats) goes in art-src/community/skipped/ and its name in skipped.txt.
//
// Options: --channel <name>  (default in-game-characters)
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const env = Object.fromEntries(readFileSync('bot/.env', 'utf8').split(/\r?\n/)
  .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
if (!env.DISCORD_TOKEN || !env.GUILD_ID) throw new Error('bot/.env needs DISCORD_TOKEN and GUILD_ID');
const channelName = process.argv.includes('--channel') ? process.argv[process.argv.indexOf('--channel') + 1] : 'in-game-characters';
const OUT = 'art-src/community';
mkdirSync(OUT, { recursive: true });

const api = async (path) => {
  const res = await fetch(`https://discord.com/api/v10${path}`, { headers: { Authorization: `Bot ${env.DISCORD_TOKEN}` } });
  if (res.status === 429) {
    const wait = ((await res.json()).retry_after ?? 1) * 1000;
    await new Promise((r) => setTimeout(r, wait));
    return api(path);
  }
  if (!res.ok) throw new Error(`${path.replace(/\d{15,}/g, '…')}: ${res.status}`);
  return res.json();
};

const channels = await api(`/guilds/${env.GUILD_ID}/channels`);
const channel = channels.find((c) => c.name === channelName);
if (!channel) throw new Error(`No #${channelName} channel in the server`);

// Every message, oldest last (100 at a time).
const messages = [];
let before = '';
for (;;) {
  const page = await api(`/channels/${channel.id}/messages?limit=100${before ? `&before=${before}` : ''}`);
  messages.push(...page);
  if (page.length < 100) break;
  before = page[page.length - 1].id;
}

// Already here, or looked at and set aside (art-src/community/skipped/: screenshots, cards, repeats).
// skipped.txt lists them by name (the pictures themselves aren't in git).
const skippedList = existsSync(join(OUT, 'skipped.txt')) ? readFileSync(join(OUT, 'skipped.txt'), 'utf8').split(/\r?\n/).filter(Boolean) : [];
const have = new Set([...readdirSync(OUT), ...skippedList, ...(existsSync(join(OUT, 'skipped')) ? readdirSync(join(OUT, 'skipped')) : [])]);
let added = 0;
let skipped = 0;
for (const m of messages) {
  const pics = (m.attachments ?? []).filter((a) => /^image\/(png|jpeg|webp)$/.test(a.content_type ?? ''));
  for (const [i, a] of pics.entries()) {
    const ext = a.content_type === 'image/png' ? 'png' : a.content_type === 'image/webp' ? 'webp' : 'jpg';
    const name = `discord-${m.id}-${i}.${ext}`;
    if (have.has(name) || existsSync(join(OUT, name))) { skipped++; continue; }
    const res = await fetch(a.url);
    if (!res.ok) { console.warn(`Couldn't download ${a.filename} (${res.status})`); continue; }
    writeFileSync(join(OUT, name), Buffer.from(await res.arrayBuffer()));
    console.log(`+ ${name}  (${a.width}×${a.height}, posted by ${m.author?.username ?? '?'})`);
    added++;
  }
}
console.log(`#${channelName}: ${messages.length} messages, ${added} new picture(s), ${skipped} already here.`);

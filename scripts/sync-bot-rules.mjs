// Copies the site's match rules (public/js/rules/) into the bot (bot/src/site-rules/), so the
// Discord match threads work out exactly what the site does: when a match opens, whether the
// votes agree, what a valid score is. Only bot/ is uploaded to the server, hence the copies.
//
//   node scripts/sync-bot-rules.mjs
//
// Run it after changing any of these files; tests/bot-rules-sync.test.mjs fails until you do.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHARED_RULES = ['flow.js', 'votes.js', 'match.js', 'results.js', 'defaults.js', 'season.js', 'standings.js', 'stat-style.js'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const fromDir = join(root, 'public', 'js', 'rules');
export const toDir = join(root, 'bot', 'src', 'site-rules');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(toDir, { recursive: true });
  for (const name of SHARED_RULES) copyFileSync(join(fromDir, name), join(toDir, name));
  console.log(`Copied ${SHARED_RULES.length} rule files to bot/src/site-rules/`);
}

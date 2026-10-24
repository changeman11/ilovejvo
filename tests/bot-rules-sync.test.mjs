// The bot's copies of the site's match rules (bot/src/site-rules/) must match the originals.
// If this fails: node scripts/sync-bot-rules.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHARED_RULES, fromDir, toDir } from '../scripts/sync-bot-rules.mjs';

test('the bot uses the same match rules as the site', () => {
  for (const name of SHARED_RULES) {
    const site = readFileSync(join(fromDir, name), 'utf8').replace(/\r\n/g, '\n');
    const bot = readFileSync(join(toDir, name), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(bot, site, `bot/src/site-rules/${name} is out of date: run node scripts/sync-bot-rules.mjs`);
  }
});

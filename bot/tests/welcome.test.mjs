import { test } from 'node:test';
import assert from 'node:assert/strict';
import { welcomeMessage, welcomeMember } from '../src/welcome.js';

const config = { siteUrl: 'https://i-love-jvo.web.app', welcomeChannelId: 'welcome-ch' };

test('the welcome @mentions the new member and links the site', () => {
  const m = welcomeMessage({ id: '42', name: 'Newbie' }, config);
  assert.match(m.content, /<@42>/);
  assert.deepEqual(m.allowedMentions, { users: ['42'] });
  assert.match(m.embeds[0].description, /https:\/\/i-love-jvo\.web\.app\/me/);
  const urls = m.components[0].components.map((b) => b.url);
  assert.deepEqual(urls, ['https://i-love-jvo.web.app/me', 'https://i-love-jvo.web.app/pickup', 'https://i-love-jvo.web.app/help']);
  assert.ok(m.components[0].components.every((b) => b.style === 5 && !b.custom_id), 'link buttons');
  assert.equal(welcomeMessage({ id: '1', name: 'A bot', bot: true }, config), null, 'bots are not welcomed');
  assert.equal(welcomeMessage({ id: '1', name: 'x' }, { siteUrl: '' }).components.length, 0, 'no site: no links');
});

test('posts to the welcome channel; off when no channel is set; a failure is only logged', async () => {
  const posted = [];
  const io = { async post(m, ch) { posted.push(ch); return 'm1'; } };
  assert.equal(await welcomeMember({ id: '42', name: 'N' }, { io, config }), true);
  assert.deepEqual(posted, ['welcome-ch']);
  assert.equal(await welcomeMember({ id: '42', name: 'N' }, { io, config: { ...config, welcomeChannelId: '' } }), false);
  const warnings = [];
  const broken = { async post() { throw new Error('Missing Access'); } };
  assert.equal(await welcomeMember({ id: '42', name: 'N' }, { io: broken, config, log: { warn: (w) => warnings.push(w) } }), false);
  assert.match(warnings[0], /Missing Access/);
});

import { membersIntentOn } from '../src/login.js';

test('reads whether the Server Members intent is on from the app flags', () => {
  assert.equal(membersIntentOn(0), false);
  assert.equal(membersIntentOn(1 << 14), true);
  assert.equal(membersIntentOn(1 << 15), true, 'the limited flag counts too');
  assert.equal(membersIntentOn((1 << 19) | (1 << 23)), false, 'other flags (message content) do not');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySettings, featuresOf, availableFeatures, BotControl } from '../src/control.js';

const env = { store: 'firebase', ranked: true, matchThreads: true, readStats: true, characters: false, statRoles: true, clubRoles: false, welcomeChannelId: '123456789012345678', matchRemindMinutes: 10, matchRemindMax: 6, matchCloseMinutes: 15, readySeconds: 60, pickSeconds: 60, rankedReadySeconds: 300 };

test('settings from the panel go on top of .env; missing ones keep .env; timings are clamped', () => {
  const c = applySettings({ ...env }, { features: { ranked: false, characters: true, welcome: false }, timings: { matchRemindMinutes: 5, readySeconds: 99999, pickSeconds: null } }, env);
  assert.equal(c.ranked, false);
  assert.equal(c.characters, true);
  assert.equal(c.welcomeChannelId, '', 'welcome off');
  assert.equal(c.matchThreads, true, 'not in settings: .env');
  assert.equal(c.matchRemindMinutes, 5);
  assert.equal(c.readySeconds, 600, 'clamped');
  assert.equal(c.pickSeconds, 60, 'null keeps .env');
  assert.equal(applySettings({ ...env }, { features: { welcome: true } }, env).welcomeChannelId, env.welcomeChannelId);
  // .env can't support it: stays off.
  const fileEnv = { ...env, store: 'file', welcomeChannelId: '' };
  const d = applySettings({ ...fileEnv }, { features: { matchThreads: true, welcome: true } }, fileEnv);
  assert.equal(d.matchThreads, false);
  assert.equal(d.welcomeChannelId, '');
  assert.deepEqual(availableFeatures(fileEnv).matchThreads, false);
  assert.equal(applySettings({ ...env }, null, env).ranked, true, 'no settings = .env');
});

function control({ modules = {}, config = { ...env } } = {}) {
  const writes = [];
  let restarts = 0;
  let t = 1_000_000;
  const c = new BotControl({
    rest: { async commit(w) { writes.push(...w); } },
    firebase: {}, config, env, modules: () => modules,
    log: { info() {}, warn() {}, error() {} },
    restart: () => { restarts++; },
    now: () => t,
  });
  return { c, writes, restarts: () => restarts, tick: (ms) => { t += ms; } };
}

test('panel: a feature switch restarts the bot; timings apply live without a restart', async () => {
  const x = control();
  await x.c.settingsChanged({ timings: { matchCloseMinutes: 30 } });
  assert.equal(x.c.config.matchCloseMinutes, 30);
  assert.equal(x.restarts(), 0);
  await x.c.settingsChanged({ features: { ranked: false } });
  assert.equal(x.restarts(), 1);
  assert.ok(x.writes.some((w) => w.path === 'botControl/status' && w.data.restarting));
});

test('panel commands run once and save their result; stale or unknown ones fail', async () => {
  const calls = [];
  const matches = { threads: new Map([['e__f', { eventId: 'e', status: 'open' }]]), async closeAll() { calls.push('close'); return 2; }, async clearEvent(id) { calls.push(`clear ${id}`); return 3; }, async sync() { calls.push('sync'); } };
  const clubRoles = { async fullSync() { calls.push('club'); } };
  const x = control({ modules: { matches, clubRoles } });
  await x.c.queue('c1', { action: 'clearEventThreads', eventId: 'night', createdAt: 1_000_000 });
  await x.c.queue('c1', { action: 'clearEventThreads', eventId: 'night', createdAt: 1_000_000 }); // seen again: ignored
  await x.c.queue('c2', { action: 'syncRoles', createdAt: 1_000_000 });
  await x.c.queue('c3', { action: 'nope', createdAt: 1_000_000 });
  x.tick(2 * 60 * 60 * 1000);
  await x.c.queue('c4', { action: 'closeThreads', createdAt: 1_000_000 });
  await x.c.queue('c5', { action: 'restart', createdAt: x.c.now() });
  assert.deepEqual(calls, ['clear night', 'club']);
  const result = (id) => x.writes.filter((w) => w.path === `botCommands/${id}`).pop()?.data;
  assert.equal(result('c1').status, 'done');
  assert.match(result('c1').result, /Deleted 3 threads/);
  assert.match(result('c2').result, /club roles/);
  assert.equal(result('c3').status, 'failed');
  assert.match(result('c4').result, /Too old/);
  assert.equal(result('c5').status, 'done');
  assert.equal(x.restarts(), 1);
  const status = x.writes.filter((w) => w.path === 'botControl/status').pop().data;
  assert.deepEqual(status.threadsByEvent, { e: { open: 1, total: 1 } });
  assert.equal(status.features.ranked, true);
  assert.deepEqual(featuresOf(env).welcome, true);
});

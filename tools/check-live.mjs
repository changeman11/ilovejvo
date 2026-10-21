// Runs before `npm run deploy`: stops a deploy that would put a half-configured site online.
// Checks the live settings are filled in. Never prints secret values.

import { readFileSync, existsSync } from 'node:fs';

const problems = [];
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const config = read('public/js/config.js');
const live = config.match(/const liveConfig = \{([\s\S]*?)\};/)?.[1] ?? '';
for (const key of ['apiKey', 'authDomain', 'projectId', 'appId']) {
  if (!new RegExp(`${key}:\\s*'[^']+'`).test(live)) problems.push(`public/js/config.js: liveConfig.${key} is empty`);
}
if (!/discordClientId = '[^']+'/.test(config)) problems.push('public/js/config.js: discordClientId is empty');

const projectId = live.match(/projectId:\s*'([^']+)'/)?.[1];
const rc = JSON.parse(read('.firebaserc'));
if (!rc.projects?.prod) problems.push('.firebaserc: no "prod" project alias');
else if (projectId && rc.projects.prod !== projectId) problems.push(`.firebaserc prod (${rc.projects.prod}) doesn't match config.js projectId (${projectId})`);

const envPath = new URL('../functions/.env', import.meta.url);
if (!existsSync(envPath) || !/^DISCORD_CLIENT_ID=\S+/m.test(readFileSync(envPath, 'utf8'))) {
  problems.push('functions/.env: DISCORD_CLIENT_ID is empty');
}

if (/leagueIsPublic\(\)\s*\{\s*return true/.test(read('firestore.rules'))) {
  console.log('Note: the league is OPEN to the public in firestore.rules.');
}

if (problems.length) {
  console.error('\nNot ready to deploy:\n' + problems.map((p) => `  - ${p}`).join('\n') + '\n');
  process.exit(1);
}
console.log('Live settings look complete.');

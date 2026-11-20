// Transfer news: a public, append-only record of players moving between clubs (transfers/{id}).
// An entry is written in the same save as the move itself, and the security rules check it
// matches the player's club before and after that save, so it can't be made up.
//   kind: 'joined' (a club), 'left' (approved leave), 'released' (by the manager), 'founded' (a new club)

import { newId, serverTimestamp } from './writes.js';

// A save step for commit(): add it to the same commit as the player's teamId change.
// note: an optional message from the player (up to 200 characters, e.g. when they leave), shown
// under the news on the site's ticker and in Discord's #transfer-news.
export function transferOp({ playerId, from = null, to = null, kind, note = '' }) {
  const text = String(note ?? '').trim().slice(0, 200);
  return {
    type: 'set',
    path: `transfers/${newId('transfers')}`,
    data: { playerId, fromTeamId: from ?? null, toTeamId: to ?? null, kind, at: serverTimestamp(), ...(text ? { note: text } : {}) },
  };
}

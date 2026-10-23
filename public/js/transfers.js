// Transfer news: a public, append-only record of players moving between clubs (transfers/{id}).
// An entry is written in the same save as the move itself, and the security rules check it
// matches the player's club before and after that save, so it can't be made up.
//   kind: 'joined' (a club), 'left' (approved leave), 'released' (by the manager), 'founded' (a new club)

import { newId, serverTimestamp } from './writes.js';

// A save step for commit(): add it to the same commit as the player's teamId change.
export function transferOp({ playerId, from = null, to = null, kind }) {
  return {
    type: 'set',
    path: `transfers/${newId('transfers')}`,
    data: { playerId, fromTeamId: from ?? null, toTeamId: to ?? null, kind, at: serverTimestamp() },
  };
}

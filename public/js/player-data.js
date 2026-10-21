// Saves made by players and team managers. The security rules decide what each person may do;
// these just shape the saves the rules expect. Each one also writes an audit entry.

import { commit, newId, serverTimestamp } from './writes.js';
import { invalidate } from './data.js';
import { slugId } from './admin-data.js';

// New profile for a Discord user (id "d<discordId>"), starting as a free agent.
export async function createProfile({ uid, discordId, discordName, avatarUrl, displayName, number }) {
  await commit(uid, [{
    type: 'set',
    path: `players/d${discordId}`,
    data: { displayName, number, bio: '', uid, discordId, discordName: discordName ?? null, avatarUrl: avatarUrl ?? null, teamId: null, active: true },
  }]);
  invalidate();
}

export async function updateProfile({ uid, player, changes }) {
  await commit(uid, [{ type: 'update', path: `players/${player.id}`, before: player, data: changes }]);
  invalidate();
}

// Ask an admin to link an existing profile (e.g. one with stats) to this Discord account.
export async function requestClaim({ uid, discordId, discordName, avatarUrl, playerId, existing }) {
  await commit(uid, [{
    type: 'set',
    path: `claims/${uid}`,
    before: existing,
    data: { playerId, discordId, discordName: discordName ?? null, avatarUrl: avatarUrl ?? null, status: 'pending', createdAt: serverTimestamp() },
  }]);
}

export async function cancelClaim({ uid, claim }) {
  await commit(uid, [{ type: 'delete', path: `claims/${uid}`, before: claim }]);
}

// A free agent registers a new team; it waits for an admin.
export async function registerTeam({ uid, player, name, shortName, color, takenIds }) {
  const id = slugId(name, takenIds);
  await commit(uid, [{
    type: 'set',
    path: `teams/${id}`,
    data: { name, shortName, colors: { primary: color }, status: 'pending', managerUid: uid, managerPlayerId: player.id, createdBy: uid },
  }]);
  invalidate();
  return id;
}

// Manager tidies up their team.
export async function updateTeam({ uid, team, changes }) {
  await commit(uid, [{ type: 'update', path: `teams/${team.id}`, before: team, data: changes }]);
  invalidate();
}

// Manager -> free agent.
export async function sendOffer({ uid, team, player }) {
  await commit(uid, [{
    type: 'set',
    path: `offers/${newId('offers')}`,
    data: { teamId: team.id, playerId: player.id, playerUid: player.uid, fromUid: uid, status: 'pending', createdAt: serverTimestamp() },
  }]);
}

export async function withdrawOffer({ uid, offer }) {
  await commit(uid, [{ type: 'update', path: `offers/${offer.id}`, before: offer, data: { status: 'withdrawn' } }]);
}

// Player answers an offer. Accepting joins the team in the same save (the rules check both).
export async function answerOffer({ uid, offer, player, accept }) {
  const ops = [{ type: 'update', path: `offers/${offer.id}`, before: offer, data: { status: accept ? 'accepted' : 'declined' } }];
  if (accept) ops.push({ type: 'update', path: `players/${player.id}`, before: player, data: { teamId: offer.teamId, joinOfferId: offer.id } });
  await commit(uid, ops);
  invalidate();
}

// Manager releases a player from their team.
export async function releasePlayer({ uid, player }) {
  await commit(uid, [{ type: 'update', path: `players/${player.id}`, before: player, data: { teamId: null } }]);
  invalidate();
}

// Player asks to leave their team; an admin decides.
export async function requestLeave({ uid, player, reason }) {
  await commit(uid, [{
    type: 'set',
    path: `leaveRequests/${newId('leaveRequests')}`,
    data: { playerId: player.id, teamId: player.teamId, uid, reason: reason || '', status: 'pending', createdAt: serverTimestamp() },
  }]);
}

export async function cancelLeave({ uid, request }) {
  await commit(uid, [{ type: 'update', path: `leaveRequests/${request.id}`, before: request, data: { status: 'cancelled' } }]);
}

// Saves made by players and team managers. The security rules decide what each person may do;
// these just shape the saves the rules expect. Each one also writes an audit entry.

import { commit, newId, serverTimestamp, ts } from './writes.js';
import { doc, collection, setDoc, deleteDoc, getDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { invalidate } from './data.js';
import { slugId } from './admin-data.js';
import { transferOp } from './transfers.js';

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

// ---------- Event sign-ups (events/{id}/entries/{teamId}) ----------
// The team's manager signs the club up, or pulls it out, until 10 minutes before the start.

export async function signUpTeam({ uid, eventId, team }) {
  await commit(uid, [{
    type: 'set',
    path: `events/${eventId}/entries/${team.id}`,
    data: { teamId: team.id, managerUid: uid, createdAt: serverTimestamp() },
  }]);
  invalidate(`event:${eventId}`);
}

export async function withdrawTeam({ uid, eventId, entry }) {
  await commit(uid, [{ type: 'delete', path: `events/${eventId}/entries/${entry.id}`, before: entry }]);
  invalidate(`event:${eventId}`);
}

// ---------- Comments (teams/{id}/comments, players/{id}/comments) ----------
// kind: 'team' | 'player'. The rules allow one post every 15 seconds per person.

export async function postComment({ uid, player, kind, targetId, body }) {
  await commit(uid, [
    { type: 'set', path: `commentLimits/${uid}`, data: { lastAt: serverTimestamp() } },
    {
      type: 'set',
      path: `${kind}s/${targetId}/comments/${newId(`${kind}s/${targetId}/comments`)}`,
      data: { body, authorUid: uid, authorPlayerId: player.id, createdAt: serverTimestamp() },
    },
  ]);
}

// Admins delete through their own sign-in (pass admin: true).
export async function deleteComment({ uid, kind, targetId, comment, admin = false }) {
  await commit(uid, [{ type: 'delete', path: `${kind}s/${targetId}/comments/${comment.id}`, before: comment }], { admin });
}

// Manager tidies up their team.
export async function updateTeam({ uid, team, changes }) {
  await commit(uid, [{ type: 'update', path: `teams/${team.id}`, before: team, data: changes }]);
  invalidate();
}

// ---------- Join requests (free agent -> team; the manager decides) ----------

export async function requestToJoin({ uid, player, team, message = '', existing = null }) {
  await commit(uid, [{
    type: 'set',
    path: `joinRequests/${team.id}__${player.id}`,
    before: existing,
    data: { teamId: team.id, playerId: player.id, uid, message: message.slice(0, 300), status: 'pending', createdAt: serverTimestamp() },
  }]);
}

export async function withdrawJoinRequest({ uid, request }) {
  await commit(uid, [{ type: 'update', path: `joinRequests/${request.id}`, before: request, data: { status: 'withdrawn' } }]);
}

// Manager answers a join request. Accepting puts the player on the team in the same save.
export async function answerJoinRequest({ uid, request, player, accept }) {
  const ops = [{ type: 'update', path: `joinRequests/${request.id}`, before: request, data: { status: accept ? 'accepted' : 'declined' } }];
  if (accept) {
    ops.push({ type: 'update', path: `players/${player.id}`, before: player, data: { teamId: request.teamId, joinRequestId: request.id } });
    ops.push(transferOp({ playerId: player.id, from: player.teamId, to: request.teamId, kind: 'joined' }));
  }
  await commit(uid, ops);
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
  if (accept) {
    ops.push({ type: 'update', path: `players/${player.id}`, before: player, data: { teamId: offer.teamId, joinOfferId: offer.id } });
    ops.push(transferOp({ playerId: player.id, from: player.teamId, to: offer.teamId, kind: 'joined' }));
  }
  await commit(uid, ops);
  invalidate();
}

// Manager releases a player from their team.
export async function releasePlayer({ uid, player }) {
  await commit(uid, [
    { type: 'update', path: `players/${player.id}`, before: player, data: { teamId: null } },
    transferOp({ playerId: player.id, from: player.teamId, to: null, kind: 'released' }),
  ]);
  invalidate();
}

// The manager hands the club over to another squad player (they must have signed in with Discord).
export async function handOverClub({ uid, team, player }) {
  await commit(uid, [{ type: 'update', path: `teams/${team.id}`, before: team, data: { managerUid: player.uid, managerPlayerId: player.id } }]);
  invalidate();
}

// ---------- Team chat (teams/{id}/chat): squad only. No audit entry, it's just chat. ----------

// Makes sure playerLinks/{uid} points at this player (the chat rules use it to check squad membership).
export async function ensurePlayerLink({ uid, player }) {
  const ref = doc(db, `playerLinks/${uid}`);
  const snap = await getDoc(ref).catch(() => null);
  if (snap?.exists() && snap.data().playerId === player.id) return;
  await setDoc(ref, { playerId: player.id });
}

export async function sendChat({ uid, player, teamId, body }) {
  const ref = doc(collection(db, `teams/${teamId}/chat`));
  await setDoc(ref, { body, authorUid: uid, authorPlayerId: player.id, createdAt: serverTimestamp() });
}

export async function deleteChat({ teamId, messageId }) {
  await deleteDoc(doc(db, `teams/${teamId}/chat/${messageId}`));
}

// Player asks to leave their team; an admin decides.
export async function requestLeave({ uid, player, reason }) {
  await commit(uid, [{
    type: 'set',
    path: `leaveRequests/${newId('leaveRequests')}`,
    data: { playerId: player.id, teamId: player.teamId, uid, reason: reason || '', status: 'pending', createdAt: serverTimestamp() },
  }]);
}

// A player's vote on a match result (rules/votes.js). If it agrees with the other team's vote,
// `agreed` is the result to publish, saved in the same go (the security rules check the agreement).
export async function submitVote({ uid, eventId, fixtureId, player, sets, playerStats, screenshotPaths = [], existing, agreed = null }) {
  const ops = [{
    type: 'set',
    path: `events/${eventId}/submissions/${fixtureId}__${player.id}`,
    before: existing,
    data: {
      fixtureId, playerId: player.id, uid, teamId: player.teamId, sets, playerStats, screenshotPaths,
      createdAt: existing?.createdAt ? ts(existing.createdAt) : serverTimestamp(),
    },
  }];
  if (agreed) {
    ops.push({
      type: 'set',
      path: `events/${eventId}/results/${fixtureId}`,
      data: { ...agreed, enteredBy: uid, enteredAt: serverTimestamp() },
    });
  }
  await commit(uid, ops);
  invalidate(`event:${eventId}`);
}

export async function cancelLeave({ uid, request }) {
  await commit(uid, [{ type: 'update', path: `leaveRequests/${request.id}`, before: request, data: { status: 'cancelled' } }]);
}

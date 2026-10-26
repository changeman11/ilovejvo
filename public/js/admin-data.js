// Admin writes. Every change is saved together with an audit log entry (see writes.js).

import { commit as save, ts, newId, serverTimestamp } from './writes.js';
import { invalidate, loadPeople, loadAllBundles } from './data.js';
import { deleteImage } from './media.js';
import { transferOp } from './transfers.js';
import { SQUAD_MAX } from './rules/defaults.js';

// Admin saves always go through the admin (password) sign-in.
const commit = (uid, ops) => save(uid, ops, { admin: true });

// Readable ids from names ("Tasman Tide" -> "tasman-tide"), unique among `taken`.
export function slugId(name, taken) {
  const base = String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

// ---------- Events ----------

// Match flow settings (rules/flow.js): its times are saved as timestamps so the rules can compare them.
export function flowToSave(flow) {
  const out = { ...flow };
  for (const k of ['openAt', 'finalsOpenAt']) out[k] = flow[k] ? ts(flow[k]) : null;
  return out;
}

// Changes some match flow settings now (pause, open early, open the finals...). changes: { key: value }
export async function saveFlow({ eventId, uid, event, changes }) {
  await commit(uid, [{ type: 'update', path: `events/${eventId}`, before: event, data: { flow: flowToSave({ ...(event.flow ?? {}), ...changes }) } }]);
  invalidate(`event:${eventId}`);
  invalidate('events');
}

// Staff check a player in for the event (rules/flow.js check-in) when they can't do it themselves.
// teamId: the team they play for here (their club, or a mix team).
export async function staffCheckIn({ uid, eventId, player, teamId, staffName = null }) {
  await commit(uid, [{ type: 'set', path: `events/${eventId}/checkins/${player.id}`, data: {
    playerId: player.id, teamId: teamId ?? '', uid: player.uid ?? null, at: serverTimestamp(), by: 'staff', staffName,
  } }]);
  invalidate(`event:${eventId}`);
}
export async function staffCheckOut({ uid, eventId, checkin }) {
  await commit(uid, [{ type: 'delete', path: `events/${eventId}/checkins/${checkin.id}`, before: checkin }]);
  invalidate(`event:${eventId}`);
}

// Byes in a hand-made elimination bracket (rules/elim-fill.js): event.elimByes = { round: [teamIds] }.
export async function saveElimByes({ uid, event, byes }) {
  await commit(uid, [{ type: 'update', path: `events/${event.id}`, before: event, data: { elimByes: byes } }]);
  invalidate(`event:${event.id}`);
  invalidate('events');
}

// Starts a match without waiting for the check-ins (rules/flow.js): fixture.startedAt.
export async function startMatchNow({ uid, eventId, fixture }) {
  await commit(uid, [{ type: 'update', path: `events/${eventId}/fixtures/${fixture.id}`, before: fixture, data: { startedAt: serverTimestamp() } }]);
  invalidate(`event:${eventId}`);
}

export async function saveEvent({ id, uid, event, existing }) {
  const eventId = id ?? newId('events');
  await commit(uid, [{
    type: 'set',
    path: `events/${eventId}`,
    before: existing,
    data: {
      ...event,
      date: ts(event.date),
      fixturesLockedAt: event.fixturesLockedAt ? ts(event.fixturesLockedAt) : null,
      ...(event.flow ? { flow: flowToSave(event.flow) } : {}),
      createdAt: existing?.createdAt ? ts(existing.createdAt) : serverTimestamp(),
      createdBy: existing?.createdBy ?? uid,
    },
  }]);
  invalidate('event');
  return eventId;
}

// Deletes an event and everything inside it (fixtures, results, rosters).
export async function deleteEvent({ uid, bundle }) {
  const id = bundle.event.id;
  const ops = [
    ...bundle.fixtures.filter((f) => !f.virtual).map((f) => ({ type: 'delete', path: `events/${id}/fixtures/${f.id}`, before: f })),
    ...(bundle.entries ?? []).map((e) => ({ type: 'delete', path: `events/${id}/entries/${e.id}`, before: e })),
    ...Object.values(bundle.results).map((r) => ({ type: 'delete', path: `events/${id}/results/${r.id}`, before: r })),
    ...Object.values(bundle.rosters).map((r) => ({ type: 'delete', path: `events/${id}/rosters/${r.id}`, before: r })),
    { type: 'delete', path: `events/${id}`, before: bundle.event },
    // Mix teams made for this event only go with it.
    ...bundle.teams.filter((t) => t.mix && t.mixEventId === id).map((t) => ({ type: 'delete', path: `teams/${t.id}`, before: t })),
    ...(bundle.solos ?? []).map((x) => ({ type: 'delete', path: `events/${id}/solos/${x.id}`, before: x })),
  ];
  await commit(uid, ops);
  invalidate('event');
}

// ---------- Site settings (FAQ, rules) ----------

// ---------- Bot control panel (/admin/bot) ----------
// Switches and timings for the Discord bot (bot/src/control.js reads them live).
export async function saveBotSettings({ uid, existing, features, timings }) {
  await commit(uid, [{ type: 'set', path: 'botControl/settings', before: existing, data: { features, timings } }]);
}
// An action for the bot to run (it writes the result back on the same doc).
// extra: eventId, matchId, gameNumber, winner, mode, playerId, adminName (only the ones given).
export async function sendBotCommand({ uid, action, ...extra }) {
  const fields = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== null && v !== undefined && v !== ''));
  await commit(uid, [{ type: 'set', path: `botCommands/${newId('botCommands')}`, data: { action, status: 'pending', createdAt: serverTimestamp(), ...fields } }]);
}
export async function clearBotCommands({ uid, commands }) {
  await commit(uid, commands.map((c) => ({ type: 'delete', path: `botCommands/${c.id}`, before: c })));
}
// Discord match threads on/off for one event (event.matchThreads; missing = on).
export async function setEventThreads({ uid, event, on }) {
  await commit(uid, [{ type: 'update', path: `events/${event.id}`, before: event, data: { matchThreads: on } }]);
  invalidate(`event:${event.id}`);
  invalidate('events');
}

export async function saveSetting({ uid, id, existing, data }) {
  await commit(uid, [{ type: 'set', path: `settings/${id}`, before: existing, data }]);
  invalidate(`setting:${id}`);
}

// ---------- Teams and players ----------

// joinPlayer: a player to put on this team in the same save (e.g. the manager when a team is approved).
export async function saveTeam({ id, uid, team, existing, joinPlayer = null }) {
  const ops = [{ type: 'set', path: `teams/${id}`, before: existing, data: team }];
  if (joinPlayer && joinPlayer.teamId !== id) {
    ops.push({ type: 'update', path: `players/${joinPlayer.id}`, before: joinPlayer, data: { teamId: id } });
    ops.push(transferOp({ playerId: joinPlayer.id, from: joinPlayer.teamId, to: id, kind: 'joined' }));
  }
  await commit(uid, ops);
  invalidate();
}
export async function deleteTeam({ id, uid, existing }) {
  await commit(uid, [{ type: 'delete', path: `teams/${id}`, before: existing }]);
  invalidate();
}
export async function savePlayer({ id, uid, player, existing }) {
  const ops = [{ type: 'set', path: `players/${id}`, before: existing, data: player }];
  // An admin moving a player between clubs shows in the transfer news too.
  const from = existing?.teamId ?? null;
  const to = player.teamId ?? null;
  if (from !== to) {
    ops.push(transferOp({ playerId: id, from, to, kind: to ? 'joined' : 'left' }));
    if (from) ops.push(...await disbandIfEmpty({ teamId: from, leavingPlayerId: id }));
  }
  await commit(uid, ops);
  invalidate();
}
export async function deletePlayer({ id, uid, existing }) {
  await commit(uid, [{ type: 'delete', path: `players/${id}`, before: existing }]);
  invalidate();
}

// In-game names an admin matched to players from end-of-match screenshots (e.g. after a Steam
// name change). Stored on the player as `gameNames` so the next screenshot matches by itself.
export async function rememberGameNames({ uid, aliases, playersById }) {
  const byPlayer = new Map();
  for (const { playerId, name } of aliases) {
    if (!byPlayer.has(playerId)) byPlayer.set(playerId, new Set(playersById[playerId]?.gameNames ?? []));
    byPlayer.get(playerId).add(name);
  }
  const ops = [...byPlayer.entries()].map(([playerId, names]) => ({
    type: 'update',
    path: `players/${playerId}`,
    before: playersById[playerId],
    data: { gameNames: [...names].slice(-10) },
  }));
  if (ops.length) await commit(uid, ops);
  invalidate();
}

// ---------- Profile moderation ----------

// Takes down one uploaded image (logo, picture, banner or background) and deletes the file.
// owner: 'teams' | 'players'
export async function removeProfileImage({ uid, owner, doc, kind }) {
  const field = `${kind}Path`;
  const path = doc[field];
  await commit(uid, [{ type: 'update', path: `${owner}/${doc.id}`, before: doc, data: { [field]: null } }]);
  await deleteImage(path, { admin: true });
  invalidate();
}

// Clears a profile's tagline, bio and links (for anything unsuitable).
export async function clearProfileText({ uid, owner, doc }) {
  await commit(uid, [{ type: 'update', path: `${owner}/${doc.id}`, before: doc, data: { tagline: null, bio: '', socials: null } }]);
  invalidate();
}

// ---------- Inside an event ----------

export async function saveRoster({ eventId, teamId, uid, roster, existing }) {
  await commit(uid, [{ type: 'set', path: `events/${eventId}/rosters/${teamId}`, before: existing, data: roster }]);
  invalidate(`event:${eventId}`);
}

// A fixture as stored: without the fields pages add while showing it.
export function storedFixture(fixture) {
  const { id: _id, round: _round, virtual: _v, homePlaceholder: _hp, awayPlaceholder: _ap, ...data } = fixture;
  return data;
}

export async function saveFixture({ eventId, id, uid, fixture, existing }) {
  const fixtureId = id ?? newId(`events/${eventId}/fixtures`);
  await commit(uid, [{
    type: 'set',
    path: `events/${eventId}/fixtures/${fixtureId}`,
    before: existing?.virtual ? null : existing,
    data: { ...storedFixture(fixture), scheduledAt: ts(fixture.scheduledAt) },
  }]);
  invalidate(`event:${eventId}`);
  return fixtureId;
}

// "Clear fixtures": deletes the given fixtures (ones without a result), any result votes on them,
// and unlocks the schedule so the automatic fixtures are worked out again from the current teams.
export async function clearFixtures({ eventId, uid, fixtures, event, submissions = [] }) {
  const ids = new Set(fixtures.map((f) => f.id));
  const ops = [
    ...submissions.filter((s) => ids.has(s.fixtureId)).map((s) => ({ type: 'delete', path: `events/${eventId}/submissions/${s.id}`, before: s })),
    ...fixtures.map((f) => ({ type: 'delete', path: `events/${eventId}/fixtures/${f.id}`, before: f })),
  ];
  if (event.fixturesLockedAt) ops.push({ type: 'update', path: `events/${eventId}`, before: event, data: { fixturesLockedAt: null } });
  if (ops.length) await commit(uid, ops);
  invalidate(`event:${eventId}`);
}

// An admin signs a club up to an event (same record a manager would make).
export async function adminAddEntry({ eventId, uid, teamId }) {
  await commit(uid, [{ type: 'set', path: `events/${eventId}/entries/${teamId}`, data: { teamId, managerUid: uid, createdAt: serverTimestamp() } }]);
  invalidate(`event:${eventId}`);
}

// Takes a club that signed itself up out of an event.
export async function removeEntry({ eventId, uid, entry }) {
  await commit(uid, [{ type: 'delete', path: `events/${eventId}/entries/${entry.id}`, before: entry }]);
  invalidate(`event:${eventId}`);
}

// Saves the worked-out schedule (rules/autofix.js schedulePlan().toSave) with its own ids.
// lockGroup: also mark the round robin as fixed, so it stops following sign-ups.
// draw: { teamId: group letter } to save with the lock (so the groups can't change afterwards).
export async function saveSchedule({ eventId, uid, fixtures, lockGroup, event, draw = null }) {
  const ops = fixtures.map((f) => ({
    type: 'set',
    path: `events/${eventId}/fixtures/${f.id}`,
    data: { ...storedFixture(f), scheduledAt: ts(f.scheduledAt) },
  }));
  if (lockGroup && !event.fixturesLockedAt) {
    const data = { fixturesLockedAt: serverTimestamp() };
    if (draw) data.groups = { ...(event.groups ?? {}), assign: draw };
    ops.push({ type: 'update', path: `events/${eventId}`, before: event, data });
  }
  if (ops.length) await commit(uid, ops);
  invalidate(`event:${eventId}`);
}

// Several new fixtures in one save (auto-generated schedules).
export async function addFixtures({ eventId, uid, fixtures }) {
  await commit(uid, fixtures.map((fixture) => ({
    type: 'set',
    path: `events/${eventId}/fixtures/${newId(`events/${eventId}/fixtures`)}`,
    data: { ...fixture, scheduledAt: ts(fixture.scheduledAt) },
  })));
  invalidate(`event:${eventId}`);
}

// Deleting a fixture also deletes its result.
export async function deleteFixture({ eventId, uid, fixture, result }) {
  const ops = [{ type: 'delete', path: `events/${eventId}/fixtures/${fixture.id}`, before: fixture }];
  if (result) ops.unshift({ type: 'delete', path: `events/${eventId}/results/${fixture.id}`, before: result });
  await commit(uid, ops);
  invalidate(`event:${eventId}`);
}

// Saves a result and marks the fixture completed, together.
// swapTeams: { homeTeamId, awayTeamId } if the admin swapped home/away.
// closeFixes: players' open fixes for this match (rules/corrections.js), closed in the same save.
export async function saveResult({ eventId, fixture, uid, result, existing, swapTeams = null, closeFixes = [] }) {
  const fixtureData = storedFixture(fixture);
  await commit(uid, [
    ...closeFixes.map((c) => ({ type: 'update', path: `events/${eventId}/corrections/${c.id}`, before: c, data: { status: 'done' } })),
    {
      type: 'set',
      path: `events/${eventId}/results/${fixture.id}`,
      before: existing,
      data: {
        ...result,
        enteredBy: existing?.enteredBy ?? uid,
        enteredAt: existing?.enteredAt ? ts(existing.enteredAt) : serverTimestamp(),
      },
    },
    {
      type: 'set',
      path: `events/${eventId}/fixtures/${fixture.id}`,
      before: fixture,
      data: { ...fixtureData, scheduledAt: ts(fixture.scheduledAt), status: 'completed', ...(swapTeams ?? {}) },
    },
  ]);
  invalidate(`event:${eventId}`);
}

// ---------- Mix teams from solo sign-ups ----------
// Event-only teams an admin makes from players who signed up solo. The players go on the event's
// roster for that team; their own club (players.teamId) doesn't change. Mix teams are marked
// `mix: true` and hidden from the Teams list and search.
const MIX_COLOURS = ['#19c9b1', '#ff6b57', '#7c5cff', '#2f6bff', '#f472b6', '#ff8a1f', '#22c55e', '#ffe200'];

// groups: [{ name, playerIds }]. One save for all of them.
export async function makeMixTeams({ uid, event, groups, takenIds }) {
  const taken = new Set(takenIds);
  const ids = [];
  const ops = [];
  groups.forEach((g, i) => {
    const id = slugId(`${g.name} ${event.id.slice(0, 4)}`, taken);
    taken.add(id);
    ids.push(id);
    const initials = g.name.replace(/[^A-Za-z0-9 ]/g, '').split(/s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase() || 'MIX';
    ops.push({ type: 'set', path: `teams/${id}`, data: { name: g.name, shortName: initials, colors: { primary: MIX_COLOURS[i % MIX_COLOURS.length] }, status: 'approved', mix: true, mixEventId: event.id } });
    ops.push({ type: 'set', path: `events/${event.id}/rosters/${id}`, data: { playerIds: g.playerIds, captainId: null } });
  });
  ops.push({ type: 'update', path: `events/${event.id}`, before: event, data: { teamIds: [...(event.teamIds ?? []), ...ids] } });
  await commit(uid, ops);
  invalidate();
}

// Takes a mix team out of the event (its players go back to the solo list) and deletes it.
export async function breakUpMixTeam({ uid, event, team, roster }) {
  const ops = [
    { type: 'update', path: `events/${event.id}`, before: event, data: { teamIds: (event.teamIds ?? []).filter((t) => t !== team.id) } },
    { type: 'delete', path: `teams/${team.id}`, before: team },
  ];
  if (roster) ops.push({ type: 'delete', path: `events/${event.id}/rosters/${team.id}`, before: roster });
  await commit(uid, ops);
  invalidate();
}

// ---------- Disbanding: a club with no players left ----------
// When a club's last player leaves, the club is marked 'disbanded' (not deleted: past results still
// show its name and logo), its manager is cleared, it's taken out of upcoming events it signed up to,
// and the transfer news says so. Returns the save steps to add to the same commit ([] if players remain).
export async function disbandIfEmpty({ teamId, leavingPlayerId }) {
  const people = await loadPeople({ fresh: true, admin: true });
  const team = people.teamsById[teamId];
  if (!team || team.status === 'disbanded') return [];
  if (people.players.some((p) => p.teamId === teamId && p.id !== leavingPlayerId)) return [];
  const ops = [
    { type: 'update', path: `teams/${teamId}`, before: team, data: { status: 'disbanded', managerUid: null, managerPlayerId: null, disbandedAt: serverTimestamp() } },
    transferOp({ playerId: leavingPlayerId, from: teamId, to: null, kind: 'disbanded' }),
  ];
  const bundles = await loadAllBundles({ includeDrafts: true, fresh: true }).catch(() => []);
  for (const b of bundles) {
    if (b.event.status !== 'upcoming' || b.event.fixturesLockedAt) continue;
    const entry = b.entries.find((e) => e.teamId === teamId);
    if (entry) ops.push({ type: 'delete', path: `events/${b.event.id}/entries/${entry.id}`, before: entry });
  }
  return ops;
}

// ---------- Requests from players (team registrations, leave requests, profile claims) ----------

export async function decideTeam({ uid, team, approve }) {
  const ops = [{ type: 'update', path: `teams/${team.id}`, before: team, data: { status: approve ? 'approved' : 'rejected' } }];
  // The player who registered it becomes its manager and first squad member.
  if (approve && team.managerPlayerId) {
    ops.push({ type: 'update', path: `players/${team.managerPlayerId}`, data: { teamId: team.id } });
    ops.push(transferOp({ playerId: team.managerPlayerId, to: team.id, kind: 'founded' }));
  }
  // Invites the founder picked when registering: sent now, from them (the new manager), to the
  // players who are still free agents.
  if (approve && team.invitePlayerIds?.length && team.managerUid) {
    const people = await loadPeople({ fresh: true, admin: true });
    for (const pid of team.invitePlayerIds.slice(0, SQUAD_MAX - 1)) {
      const p = people.playersById[pid];
      if (!p?.uid || p.teamId || pid === team.managerPlayerId) continue;
      ops.push({
        type: 'set',
        path: `offers/${newId('offers')}`,
        data: { teamId: team.id, playerId: pid, playerUid: p.uid, fromUid: team.managerUid, status: 'pending', createdAt: serverTimestamp() },
      });
    }
  }
  await commit(uid, ops);
  invalidate();
}

export async function decideLeave({ uid, request, approve, team }) {
  const ops = [{ type: 'update', path: `leaveRequests/${request.id}`, before: request, data: { status: approve ? 'approved' : 'declined', decidedBy: uid } }];
  if (approve) {
    ops.push({ type: 'update', path: `players/${request.playerId}`, data: { teamId: null } });
    ops.push(transferOp({ playerId: request.playerId, from: request.teamId, to: null, kind: 'left' }));
    // Last one out: the club disbands. Otherwise a manager who leaves stops being the manager
    // (an admin picks the next one).
    const disband = await disbandIfEmpty({ teamId: request.teamId, leavingPlayerId: request.playerId });
    if (disband.length) ops.push(...disband);
    else if (team?.managerPlayerId === request.playerId) {
      ops.push({ type: 'update', path: `teams/${team.id}`, before: team, data: { managerUid: null, managerPlayerId: null } });
    }
  }
  await commit(uid, ops);
  invalidate();
}

export async function decideClaim({ uid, claim, approve }) {
  const ops = [{ type: 'update', path: `claims/${claim.id}`, before: claim, data: { status: approve ? 'approved' : 'declined' } }];
  if (approve) {
    ops.push({
      type: 'update',
      path: `players/${claim.playerId}`,
      data: { uid: claim.id, discordId: claim.discordId, discordName: claim.discordName ?? null, avatarUrl: claim.avatarUrl ?? null },
    });
  }
  await commit(uid, ops);
  invalidate();
}

export async function deleteResult({ eventId, fixture, uid, existing }) {
  const fixtureData = storedFixture(fixture);
  await commit(uid, [
    { type: 'delete', path: `events/${eventId}/results/${fixture.id}`, before: existing },
    {
      type: 'set',
      path: `events/${eventId}/fixtures/${fixture.id}`,
      before: fixture,
      data: { ...fixtureData, scheduledAt: ts(fixture.scheduledAt), status: 'scheduled' },
    },
  ]);
  invalidate(`event:${eventId}`);
}

// ---------- Community characters (/admin/characters) ----------
// The bot's characters: approve, deny or take off the court (status on characters/{key}).
// Close (or reopen) one player's result fix from the Requests inbox.
export async function setFixStatus({ uid, eventId, fix, status }) {
  await commit(uid, [{ type: 'update', path: `events/${eventId}/corrections/${fix.id}`, before: fix, data: { status } }]);
  invalidate(`event:${eventId}`);
}

export async function setCharacterStatus({ uid, character, status }) {
  await commit(uid, [{ type: 'update', path: `characters/${character.key}`, before: character.doc, data: { status } }]);
  invalidate('col:characters');
}
// The hand-made ones (images/characters/list.json): hidden or shown again via settings/characters.
export async function setHandCharacterHidden({ uid, name, hidden, setting }) {
  const list = new Set(setting?.hidden ?? []);
  if (hidden) list.add(name); else list.delete(name);
  await saveSetting({ uid, id: 'characters', existing: setting ?? null, data: { hidden: [...list].sort() } });
}

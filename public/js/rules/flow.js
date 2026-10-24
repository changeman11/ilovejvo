// Match flow: how an event runs itself on the night (no server: every browser works it out the
// same way from the saved data).
//
// - At the start time (event.date, or event.flow.openAt if an admin opened it early) each team's
//   first match opens for result votes.
// - Per team: a match opens once both teams have a confirmed score for all their earlier matches
//   (order: group/round order, or the fixture time if admins set one).
// - When every group-stage match has a score, the event goes on a break. Finals open by themselves
//   breakMinutes after the last group score (admins can open them early); with breakMinutes null
//   they wait for an admin. An admin browser saves that time as event.flow.finalsOpenAt.
// - Admins can pause everything (flow.paused).
// - A match is "stuck" (admins are pinged) when the teams' votes disagree, or only one team has
//   voted, for stuckMinutes after the latest vote; or when nobody has voted matchMinutes +
//   stuckMinutes after it opened.
//
// event.flow = { on, breakMinutes, stuckMinutes, matchMinutes, paused, openAt, finalsOpenAt }
// (all optional; times in ms here, Firestore timestamps when saved). on: false = the old way
// (every saved match open at once, no break).

import { tallyVotes } from './votes.js';

export const FLOW_DEFAULTS = { on: true, breakMinutes: 15, stuckMinutes: 10, matchMinutes: 20 };

// Ready-up (flow.readyUp, added 2026-10-24; off unless switched on, so events already running
// aren't affected): a match whose teams are free waits until enough players from each team have
// pressed Ready on its match page (events/{e}/ready/{fixtureId}__{playerId}), then opens (reporting,
// Discord thread). flow.readyCount, else the event's team size, else 4. An admin can start it
// anyway (fixture.startedAt). A match that already has a score vote counts as started.
export const readyNeeded = (event) => Number(event?.flow?.readyCount) || Number(event?.teamSize) || 4;
export function readyState(b, f) {
  const ready = (b.ready ?? []).filter((r) => r.fixtureId === f.id);
  const side = (teamId) => ready.filter((r) => r.teamId === teamId).sort((x, y) => (x.at ?? 0) - (y.at ?? 0));
  return { need: readyNeeded(b.event), home: side(f.homeTeamId), away: side(f.awayTeamId) };
}
const MIN = 60000;

export function flowOf(event) {
  const f = { ...FLOW_DEFAULTS, ...(event?.flow ?? {}) };
  return f.on === false ? null : f;
}

const isKo = (f) => f.stage === 'playoffs';
const hasResult = (b, f) => Boolean(b.results?.[f.id]);
const resultAt = (b, f) => b.results?.[f.id]?.enteredAt ?? b.results?.[f.id]?.updatedAt ?? 0;

// When matches open: an admin's "open now", else the start time (none = as soon as fixtures exist).
export function startAt(event) {
  const flow = flowOf(event);
  if (flow?.openAt) return flow.openAt;
  return event?.date && !event.timeTbd ? event.date : null;
}

// The order a team plays its matches in.
const playOrder = (x, y) => (isKo(x) ? 1 : 0) - (isKo(y) ? 1 : 0)
  || (x.scheduledAt ?? 0) - (y.scheduledAt ?? 0)
  || (x.order ?? x.round ?? 0) - (y.order ?? y.round ?? 0)
  || String(x.id).localeCompare(String(y.id));

const realFixtures = (b) => b.fixtures.filter((f) => !f.virtual && f.homeTeamId && f.awayTeamId);

// The event's stage right now:
// { phase: 'off'|'before'|'paused'|'groups'|'break'|'finals'|'done', startsAt, breakEndsAt, lastGroupAt }
export function eventPhase(b, now) {
  const e = b.event;
  const flow = flowOf(e);
  if (!flow) return { phase: 'off' };
  if (e.status === 'finished' || e.status === 'cancelled') return { phase: 'done' };
  const starts = startAt(e);
  if (starts && now < starts) return { phase: 'before', startsAt: starts };
  if (flow.paused) return { phase: 'paused' };
  // Group-stage matches include unsaved drafts: they aren't done either.
  // (A match without both teams yet, e.g. a hand-made "Grand final", isn't playable: left out.)
  const group = b.fixtures.filter((f) => !isKo(f) && f.homeTeamId && f.awayTeamId);
  const ko = b.fixtures.filter(isKo);
  const groupsDone = group.length > 0 && group.every((f) => hasResult(b, f));
  if (group.length && !groupsDone) return { phase: 'groups' };
  if (!group.length && !ko.length) return { phase: 'groups' }; // nothing scheduled yet
  const hasFinals = (e.finals?.type ?? 'none') !== 'none' || ko.length > 0;
  if (!hasFinals) return { phase: 'done' };
  const final = ko.find((f) => f.id === 'finals-final') ?? null;
  if (final && hasResult(b, final)) return { phase: 'done' };
  const lastGroupAt = group.length ? Math.max(starts ?? 0, ...group.map((f) => resultAt(b, f))) : (starts ?? 0);
  if (!group.length) return { phase: 'finals', lastGroupAt }; // knockout only: no break
  const breakEndsAt = finalsOpenAt(e, lastGroupAt);
  if (breakEndsAt && now >= breakEndsAt) return { phase: 'finals', lastGroupAt, breakEndsAt };
  return { phase: 'break', lastGroupAt, breakEndsAt };
}

// When the finals open: saved by an admin (or "open early"), else worked out from the break length.
export function finalsOpenAt(event, lastGroupAt) {
  const flow = flowOf(event);
  if (!flow) return null;
  if (flow.finalsOpenAt) return flow.finalsOpenAt;
  return flow.breakMinutes == null || !lastGroupAt ? null : lastGroupAt + flow.breakMinutes * MIN;
}

// The finals opening time an admin browser should save now (or null): once the group stage is
// done and nothing is saved yet. Saved so the database rules can check it too.
export function finalsOpenToSave(b, now) {
  const flow = flowOf(b.event);
  if (!flow || flow.finalsOpenAt || flow.breakMinutes == null) return null;
  const p = eventPhase(b, now);
  if (p.phase !== 'break' && p.phase !== 'finals') return null;
  return p.lastGroupAt ? p.lastGroupAt + flow.breakMinutes * MIN : null;
}

// One match's state:
// { state: 'done'|'draft'|'before'|'paused'|'break'|'waiting'|'open', opensAt?, since?, waitingOn?, stuck?, votes? }
// waitingOn: [{ teamId, fixture }] the earlier matches still being played.
export function matchState(b, f, now) {
  if (hasResult(b, f)) return { state: 'done' };
  if (f.virtual || !f.homeTeamId || !f.awayTeamId) return { state: 'draft' };
  const flow = flowOf(b.event);
  if (!flow) return { state: 'open', legacy: true };
  const phase = eventPhase(b, now);
  if (phase.phase === 'before') return { state: 'before', opensAt: phase.startsAt };
  if (phase.phase === 'paused') return { state: 'paused' };
  if (isKo(f) && phase.phase === 'break') return { state: 'break', opensAt: phase.breakEndsAt ?? null };

  const fixtures = realFixtures(b);
  const waitingOn = [];
  let since = startAt(b.event) ?? 0;
  if (isKo(f) && phase.breakEndsAt) since = Math.max(since, phase.breakEndsAt);
  for (const teamId of [f.homeTeamId, f.awayTeamId]) {
    const mine = fixtures.filter((x) => x.homeTeamId === teamId || x.awayTeamId === teamId).sort(playOrder);
    for (const x of mine) {
      if (x.id === f.id) break;
      if (!hasResult(b, x)) { waitingOn.push({ teamId, fixture: x }); break; }
      since = Math.max(since, resultAt(b, x));
    }
  }
  if (waitingOn.length) return { state: 'waiting', waitingOn };

  const subs = (b.submissions ?? []).filter((s) => s.fixtureId === f.id);
  if (flow.readyUp === true && !f.startedAt && !subs.length) {
    const r = readyState(b, f);
    if (r.home.length < r.need || r.away.length < r.need) return { state: 'ready', since, ...r };
    // Open since the last player needed pressed Ready.
    since = Math.max(since, r.home[r.need - 1].at ?? 0, r.away[r.need - 1].at ?? 0);
  }
  if (f.startedAt) since = Math.max(since, f.startedAt);
  const votes = tallyVotes(subs, f);
  const lastVote = Math.max(0, ...subs.map((s) => s.updatedAt ?? s.createdAt ?? 0));
  const stuckAfter = flow.stuckMinutes * MIN;
  let stuck = null;
  if ((votes.status === 'disputed' || votes.status === 'waiting') && now - lastVote >= stuckAfter) stuck = votes.status;
  else if (votes.status === 'none' && since && now - since >= (flow.matchMinutes + flow.stuckMinutes) * MIN) stuck = 'no-votes';
  return { state: 'open', since, stuck, votes: votes.status };
}

// Everything the Live panels need for one event, or null when it isn't running:
// { phase..., open: [f], recent: [f] (newest first), stuck: [{ f, why }] }
export function liveSummary(b, now) {
  const phase = eventPhase(b, now);
  if (!['groups', 'break', 'finals', 'paused'].includes(phase.phase)) return null;
  const fixtures = realFixtures(b);
  const states = fixtures.map((f) => ({ f, s: matchState(b, f, now) }));
  return {
    ...phase,
    open: states.filter(({ s }) => s.state === 'open').map(({ f }) => f),
    readying: states.filter(({ s }) => s.state === 'ready').map(({ f }) => f),
    stuck: states.filter(({ s }) => s.stuck).map(({ f, s }) => ({ f, why: s.stuck })),
    recent: fixtures.filter((f) => hasResult(b, f)).sort((x, y) => resultAt(b, y) - resultAt(b, x)),
    left: fixtures.filter((f) => !hasResult(b, f)).length,
  };
}

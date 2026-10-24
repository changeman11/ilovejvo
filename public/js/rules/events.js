// Exhibition nights and tournaments. Pure helpers, no Firebase.
//
// An event: { id, type, title, summary, details, date (ms or null = TBD), timeTbd,
//             status, published, streamUrl, signupUrl, format, teamSize, prize }

export const EVENT_TYPES = {
  exhibition: { label: 'Exhibition night', plural: 'Exhibition nights', path: '/exhibitions' },
  tournament: { label: 'Tournament', plural: 'Tournaments', path: '/tournaments' },
};

export const EVENT_STATUSES = {
  upcoming: 'Upcoming',
  finished: 'Finished',
  cancelled: 'Cancelled',
};

const dayFmt = (locale, timeZone) => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone });
const timeFmt = (locale, timeZone) => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });

// Times are always shown in the viewer's own time zone, named so they know: "AEDT", "NZDT"... or,
// where the browser only knows "GMT+11" (e.g. US English settings), the city: "Sydney time".
// locale / timeZone default to the viewer's (they're passed in tests).
export function zoneLabel(ms, locale = undefined, timeZone = undefined) {
  const tz = new Intl.DateTimeFormat(locale, { timeZoneName: 'short', timeZone }).formatToParts(ms).find((p) => p.type === 'timeZoneName')?.value ?? '';
  if (tz && !/^(GMT|UTC)/.test(tz)) return tz;
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  return zone.includes('/') ? `${zone.split('/').pop().replace(/_/g, ' ')} time` : tz;
}

// "Date TBD", "Sat, 14 Nov 2026 · Time TBD" or "Sat, 14 Nov 2026 · 7:00 pm AEDT".
export function eventDateLabel(event, locale = undefined, timeZone = undefined) {
  if (!event?.date) return 'Date TBD';
  const day = dayFmt(locale, timeZone).format(event.date);
  return event.timeTbd ? `${day} · Time TBD` : `${day} · ${timeFmt(locale, timeZone).format(event.date)} ${zoneLabel(event.date, locale, timeZone)}`;
}

// Time left until `ms`: { live, parts: [[value, label]...], short }. Used by the FEATURED! card.
// short: "1:39:12" (under a day) or "2d 04h 15m"; live once it has started.
const pad2 = (n) => String(n).padStart(2, '0');
export function countdownParts(ms, now) {
  const left = ms - now;
  if (left <= 0) return { live: true, parts: [], short: 'live now' };
  const s = Math.floor(left / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const parts = [...(days ? [[days, days === 1 ? 'day' : 'days']] : []), [pad2(hours), 'hrs'], [pad2(mins), 'min'], [pad2(secs), 'sec']];
  const short = days ? `${days}d ${pad2(hours)}h ${pad2(mins)}m` : `${hours}:${pad2(mins)}:${pad2(secs)}`;
  return { live: false, parts, short };
}

export const isUpcoming = (e) => (e.status ?? 'upcoming') === 'upcoming';

// Upcoming first: dated events soonest first, then TBD ones (newest added first).
// Then finished/cancelled, most recent first.
export function sortEvents(events) {
  const upcoming = events.filter(isUpcoming).sort((a, b) => {
    if (a.date && b.date) return a.date - b.date;
    if (a.date) return -1;
    if (b.date) return 1;
    return (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });
  const past = events.filter((e) => !isUpcoming(e)).sort((a, b) => (b.date ?? b.createdAt ?? 0) - (a.date ?? a.createdAt ?? 0));
  return { upcoming, past };
}

const isWebUrl = (u) => {
  try {
    return ['http:', 'https:'].includes(new URL(u).protocol);
  } catch {
    return false;
  }
};

// Checks an admin's draft. Returns a list of problems (empty = OK to save).
export function validateEvent(e) {
  const problems = [];
  if (!EVENT_TYPES[e.type]) problems.push('Pick exhibition night or tournament');
  if (!e.title?.trim()) problems.push('Give it a title');
  if ((e.title ?? '').length > 120) problems.push('Title is too long (120 characters max)');
  if ((e.summary ?? '').length > 280) problems.push('Summary is too long (280 characters max)');
  if (!EVENT_STATUSES[e.status]) problems.push('Pick a status');
  if (e.date != null && !Number.isFinite(e.date)) problems.push('That date isn’t valid');
  for (const [field, name] of [['streamUrl', 'Stream link'], ['signupUrl', 'Sign-up link']]) {
    if (e[field] && !isWebUrl(e[field])) problems.push(`${name} must be a full web address starting with https://`);
  }
  if (e.type === 'tournament' && e.teamSize != null && (!Number.isInteger(e.teamSize) || e.teamSize < 1 || e.teamSize > 12)) {
    problems.push('Team size must be a whole number from 1 to 12');
  }
  return problems;
}

// Date from the admin form's date + time boxes. Empty date = TBD (null).
// No time = noon, so the day doesn't shift for viewers elsewhere in Oceania.
export function dateFromInputs(dateStr, timeStr) {
  if (!dateStr) return { date: null, timeTbd: true };
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!timeStr) return { date: new Date(y, m - 1, d, 12, 0).getTime(), timeTbd: true };
  const [hh, mm] = timeStr.split(':').map(Number);
  return { date: new Date(y, m - 1, d, hh, mm).getTime(), timeTbd: false };
}

// The reverse, for filling the form when editing.
export function inputsFromDate(date, timeTbd) {
  if (!date) return { dateStr: '', timeStr: '' };
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    dateStr: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    timeStr: timeTbd ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

// Club moves (leaving, accepting a join) pause while any event is running (owner's call,
// 2026-10-24): from 10 minutes before its start (the fixture lock) until it's marked finished,
// its match flow says it's done, or 12 hours have passed (in case nobody marks it finished).
// Only dated, published, upcoming events count. `phaseOf(event)`: optional, the match flow phase.
// Returns the running event, or null.
export const MOVES_PAUSE = { beforeMs: 10 * 60000, maxMs: 12 * 3600000 };
export function eventBlockingMoves(events, now, phaseOf = () => null) {
  return events.find((e) => e?.published && (e.status ?? 'upcoming') === 'upcoming' && e.date && !e.timeTbd
    && now >= e.date - MOVES_PAUSE.beforeMs && now < e.date + MOVES_PAUSE.maxMs
    && phaseOf(e) !== 'done') ?? null;
}

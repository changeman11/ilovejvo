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

const dayFmt = (locale) => new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = (locale) => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

// "Date TBD", "Sat, 14 Nov 2026 · Time TBD" or "Sat, 14 Nov 2026 · 7:00 pm AEDT".
export function eventDateLabel(event, locale = undefined) {
  if (!event?.date) return 'Date TBD';
  const day = dayFmt(locale).format(event.date);
  return event.timeTbd ? `${day} · Time TBD` : `${day} · ${timeFmt(locale).format(event.date)}`;
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

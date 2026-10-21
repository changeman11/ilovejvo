// Small shared helpers for building page HTML safely.

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only allow http(s) links from the database (blocks javascript: and similar).
export function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

export function fmtRatio(r) {
  if (r === Infinity) return 'MAX';
  return r.toFixed(3);
}

// Whole numbers stay whole; averages get `digits` decimals.
export function fmtNum(n, digits = 1) {
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

// 1 -> "1st", 2 -> "2nd", 11 -> "11th", 23 -> "23rd"
export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function pct(part, whole) {
  return whole ? `${Math.round((part / whole) * 100)}%` : '–';
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const longDayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export const fmtDay = (ms) => (ms ? dayFmt.format(ms) : 'TBC');
export const fmtLongDay = (ms) => (ms ? longDayFmt.format(ms) : 'Date TBC');
export const fmtTime = (ms) => (ms ? timeFmt.format(ms) : '');

// URLs for each kind of page, so links are built the same way everywhere.
export const urls = {
  match: (seasonId, fixtureId) => `/match/${encodeURIComponent(seasonId)}/${encodeURIComponent(fixtureId)}`,
  team: (teamId) => `/team/${encodeURIComponent(teamId)}`,
  player: (playerId) => `/player/${encodeURIComponent(playerId)}`,
};

export function teamChip(team, size = '') {
  const colour = team?.colors?.primary ?? 'var(--muted)';
  return `<i class="chip ${size}" style="background:${esc(colour)}"></i>`;
}

export function teamLink(team, { short = false } = {}) {
  if (!team) return '<span class="team">TBC</span>';
  return `<a class="team" href="${urls.team(team.id)}" data-link>${teamChip(team)}<span>${esc(short ? team.shortName ?? team.name : team.name)}</span></a>`;
}

export function playerLink(player, fallbackId = '') {
  const name = player?.displayName ?? fallbackId;
  const id = player?.id ?? fallbackId;
  return `<a class="plink" href="${urls.player(id)}" data-link>${esc(name)}</a>`;
}

export function formPills(form) {
  return `<span class="form">${form
    .map((f) => `<i class="${f.result}" title="${f.result === 'W' ? 'Won' : 'Lost'} ${esc(f.score)}">${f.result}</i>`)
    .join('')}</span>`;
}

export function skeleton(heights) {
  return heights.map((h) => `<div class="skeleton" style="height:${h}px"></div>`).join('');
}

export function notice(title, body = '') {
  return `<div class="notice"><strong>${esc(title)}</strong>${esc(body)}</div>`;
}

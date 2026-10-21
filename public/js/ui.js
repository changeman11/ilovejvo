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

// Whole numbers stay whole; averages get `digits` decimals.
export const fmtNum = (n, digits = 1) => (Number.isInteger(n) ? String(n) : n.toFixed(digits));
export const pct = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
export const fmtDay = (ms) => (ms ? dayFmt.format(ms) : 'Date TBD');
export const fmtTime = (ms) => (ms ? timeFmt.format(ms) : '');

export const urls = {
  event: (id) => `/event/${encodeURIComponent(id)}`,
  match: (eventId, fixtureId) => `/match/${encodeURIComponent(eventId)}/${encodeURIComponent(fixtureId)}`,
  player: (id) => `/player/${encodeURIComponent(id)}`,
  adminEvent: (id, tab = '') => `/admin/event/${encodeURIComponent(id)}${tab ? `?tab=${tab}` : ''}`,
  adminResult: (eventId, fixtureId) => `/admin/result/${encodeURIComponent(eventId)}/${encodeURIComponent(fixtureId)}`,
};

// Team colour dot (outlined, like the game's art).
export function teamDot(team, size = '') {
  return `<i class="dot ${size}" style="background:${esc(team?.colors?.primary ?? '#ffffff')}"></i>`;
}

export function playerLink(player, fallbackId = '') {
  const id = player?.id ?? fallbackId;
  return `<a class="plink" href="${urls.player(id)}" data-link>${esc(player?.displayName ?? fallbackId)}</a>`;
}

export function skeleton(heights) {
  return `<div class="stack">${heights.map((h) => `<div class="skeleton" style="height:${h}px"></div>`).join('')}</div>`;
}

// Game characters (public/images/art, made by scripts/make-art.ps1). Decoration only.
// Names: green, teal, blond, pink, x
export function sticker(name, size = '') {
  return `<img class="sticker${size ? ` ${size}` : ''}" src="/images/art/face-${name}.jpg" alt="" width="200" height="200" loading="lazy" decoding="async">`;
}

// A page title with a character sticker beside it.
export function pageTitle(title, sub, art) {
  return `<div class="titled">${sticker(art)}<div><h1>${title}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div></div>`;
}

// `art`: show a character above the message (used for empty states).
export function notice(title, body = '', art = '') {
  return `<div class="notice">${art ? sticker(art, 'lg') : ''}<strong>${esc(title)}</strong>${esc(body)}</div>`;
}

// Plain text with blank lines between paragraphs -> safe HTML paragraphs.
export function paragraphs(text) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

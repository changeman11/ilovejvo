// Small shared helpers for building page HTML safely.

import { mediaUrl } from './media.js';

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
  team: (id) => `/team/${encodeURIComponent(id)}`,
  adminEvent: (id, tab = '') => `/admin/event/${encodeURIComponent(id)}${tab ? `?tab=${tab}` : ''}`,
  adminResult: (eventId, fixtureId) => `/admin/result/${encodeURIComponent(eventId)}/${encodeURIComponent(fixtureId)}`,
};

// ---------- Picture framing (crop / zoom / move, chosen in the profile editor) ----------
// A frame is { x, y, zoom }: the point to centre on (0-100 % across and down) and how far to zoom
// in (1-4). It's applied when showing the picture, so animated GIFs keep moving.
export function validFrame(f) {
  return Boolean(f) && typeof f === 'object' && [f.x, f.y, f.zoom].every((n) => typeof n === 'number' && Number.isFinite(n))
    && f.x >= 0 && f.x <= 100 && f.y >= 0 && f.y <= 100 && f.zoom >= 1 && f.zoom <= 4;
}
export function frameStyle(f) {
  if (!validFrame(f)) return '';
  return `object-fit:cover;object-position:${f.x}% ${f.y}%;transform:scale(${f.zoom});transform-origin:${f.x}% ${f.y}%`;
}
// A picture inside a box that clips it, so zooming stays inside the box. Without a frame it's a
// plain <img> with the given class, exactly as before.
export function framedImg({ src, cls = '', frame = null, lazy = true }) {
  const attrs = `src="${esc(src)}" alt=""${lazy ? ' loading="lazy"' : ''} decoding="async"`;
  if (!validFrame(frame)) return `<img class="${cls}" ${attrs}>`;
  return `<span class="${cls} framed"><img ${attrs} style="${frameStyle(frame)}"></span>`;
}

// Team mark: its logo if it has one, otherwise a colour dot (outlined, like the game's art).
export function teamDot(team, size = '') {
  const logo = mediaUrl(team?.logoPath);
  if (logo) return framedImg({ src: logo, cls: `dot logo ${size}`, frame: team.logoFrame });
  return `<i class="dot ${size}" style="background:${esc(team?.colors?.primary ?? '#ffffff')}"></i>`;
}

// Team name linking to its profile (approved teams only; others show plain).
export function teamLink(team, { dot = true, size = '' } = {}) {
  if (!team) return '<span class="team">TBC</span>';
  const inner = `${dot ? teamDot(team, size) : ''}<span>${esc(team.name)}</span>`;
  return (team.status ?? 'approved') === 'approved'
    ? `<a class="team" href="${urls.team(team.id)}" data-link>${inner}</a>`
    : `<span class="team">${inner}</span>`;
}

// A player's picture: uploaded one, else Discord's, else their first letter.
export function avatarImg(player, cls = 'avatar') {
  const uploaded = mediaUrl(player?.avatarPath);
  const src = uploaded ?? safeUrl(player?.avatarUrl);
  if (src) return framedImg({ src, cls: `${cls} has-img`, frame: uploaded ? player.avatarFrame : null });
  return `<span class="${cls}">${esc((player?.displayName ?? '?').trim().charAt(0).toUpperCase())}</span>`;
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

// The "Manager" tag shown next to club managers everywhere (squads, player pages, lists).
export const managerTag = (label = 'Manager') => `<span class="mgr-tag" title="Club manager"><span aria-hidden="true">👑</span> ${label}</span>`;

// "LFT" (looking for a team) tag, shown for free agents who switched it on.
export const isLft = (player) => Boolean(player?.lft) && !player?.teamId;
export const lftTag = () => '<span class="lft-tag" title="Looking for a team">LFT</span>';

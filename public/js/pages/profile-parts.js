// Steam-style profile layout shared by team and player pages:
// page background, banner, logo/picture, level, tagline, socials, showcase stats and badges.
// Everything a team or player can customise is optional; sensible defaults fill the gaps.

import { esc, safeUrl, paragraphs, fmtNum, pct, frameStyle } from '../ui.js';
import { mediaUrl } from '../media.js';

export const SOCIALS = [
  { key: 'discord', label: 'Discord', hint: 'https://discord.gg/…' },
  { key: 'youtube', label: 'YouTube', hint: 'https://youtube.com/@…' },
  { key: 'twitch', label: 'Twitch', hint: 'https://twitch.tv/…' },
  { key: 'tiktok', label: 'TikTok', hint: 'https://tiktok.com/@…' },
  { key: 'x', label: 'X', hint: 'https://x.com/…' },
];

export const validTheme = (c) => (/^#[0-9a-f]{6}$/i.test(c ?? '') ? c : null);

// ---------- Showcase: the big stat boxes the owner picks (up to 4) ----------

export const DEFAULT_SHOWCASE = {
  player: ['matches', 'winRate', 'avg:pts', 'mvps'],
  team: ['matches', 'wins', 'winRate', 'sweeps'],
};

// Choices for the showcase pickers.
export function showcaseOptions(kind, statDefs) {
  const common = [
    { id: 'matches', label: 'Matches played' },
    { id: 'wins', label: 'Wins' },
    { id: 'winRate', label: 'Win rate' },
    { id: 'sweeps', label: 'Clean sweeps (2–0 wins)' },
    { id: 'level', label: 'Level' },
  ];
  const extra = kind === 'player'
    ? [{ id: 'mvps', label: 'MVPs' }, ...statDefs.flatMap((d) => [
      { id: `total:${d.key}`, label: `${d.name} (total)` },
      { id: `avg:${d.key}`, label: `${d.name} per match` },
    ])]
    : [{ id: 'events', label: 'Events played' }, { id: 'bestStreak', label: 'Best win streak' }, { id: 'setsWon', label: 'Sets won' },
      ...statDefs.map((d) => ({ id: `total:${d.key}`, label: `${d.name} (team total)` }))];
  return [...common, ...extra];
}

// ctx: { matches, wins, mvps, sweeps, level, events, bestStreak, setsWon, totals }
function showcaseValue(id, ctx) {
  const [kind, key] = id.split(':');
  if (kind === 'total') return fmtNum(ctx.totals?.[key] ?? 0);
  if (kind === 'avg') return ctx.matches ? fmtNum((ctx.totals?.[key] ?? 0) / ctx.matches, 1) : '–';
  if (id === 'winRate') return pct(ctx.wins ?? 0, ctx.matches ?? 0);
  return fmtNum(ctx[id] ?? 0);
}

export function showcaseTiles(kind, picked, statDefs, ctx) {
  const options = showcaseOptions(kind, statDefs);
  const ids = (picked?.length ? picked : DEFAULT_SHOWCASE[kind]).filter((id) => options.some((o) => o.id === id)).slice(0, 4);
  if (!ids.length) return '';
  return `<div class="pro-show">${ids.map((id) => {
    const label = options.find((o) => o.id === id).label.replace(/ \((total|team total)\)$/, '');
    return `<div class="pro-tile"><b class="num">${showcaseValue(id, ctx)}</b><span>${esc(label)}</span></div>`;
  }).join('')}</div>`;
}

// ---------- Badges ----------

export function badgesBlock(badges, emptyText) {
  if (!badges.length) return `<p class="muted small">${esc(emptyText)}</p>`;
  return `<ul class="badges">${badges.map((b) => `
    <li class="bdg t${b.tier}" title="${esc(b.title)}"><span class="bdg-mark" aria-hidden="true">${'★'.repeat(Math.min(3, Math.ceil(b.tier / 2)))}</span><span>${esc(b.title)}</span></li>`).join('')}
  </ul>`;
}

// ---------- The page frame ----------

function socialsRow(socials) {
  const links = SOCIALS
    .map((s) => ({ ...s, url: safeUrl(socials?.[s.key]) }))
    .filter((s) => s.url?.startsWith('https://'));
  if (!links.length) return '';
  return `<div class="socials">${links.map((s) => `<a class="social social-${s.key}" href="${esc(s.url)}" target="_blank" rel="noopener nofollow">${s.label}</a>`).join('')}</div>`;
}

// doc: the team or player (for banner/background/theme/tagline/socials/bio)
// mark: logo or picture HTML. sub: line under the name (HTML). lvl: { level, xp, next }
export function profileShell({ doc, fallbackTheme, mark, name, nameTag = '', sub, lvl, main, side }) {
  const theme = validTheme(doc.theme) ?? validTheme(fallbackTheme) ?? '#1438d8';
  const background = mediaUrl(doc.backgroundPath);
  const banner = mediaUrl(doc.bannerPath);
  const progress = lvl ? Math.round(((lvl.xp - lvl.from) / (lvl.next - lvl.from)) * 100) : 0;
  return `
    <div class="pro" style="--theme:${theme}">
      ${background ? `<div class="pro-bg-wrap"><img class="pro-bg" src="${esc(background)}" alt="" decoding="async" style="${frameStyle(doc.backgroundFrame)}"></div>` : ''}
      <section class="panel pro-head">
        <div class="pro-banner">${banner ? `<img src="${esc(banner)}" alt="" decoding="async" style="${frameStyle(doc.bannerFrame)}">` : ''}</div>
        <div class="pro-id">
          ${mark}
          <div class="pro-name">
            <h1>${esc(name)}${nameTag}</h1>
            <p class="muted">${sub}</p>
            ${doc.tagline ? `<p class="pro-tagline">${esc(doc.tagline)}</p>` : ''}
          </div>
          ${lvl ? `<div class="pro-level" title="${lvl.xp} XP · ${lvl.next - lvl.xp} XP to level ${lvl.level + 1}" style="--progress:${progress}%">
            <b class="num">${lvl.level}</b><span>Level</span></div>` : ''}
        </div>
        ${socialsRow(doc.socials)}
      </section>
      <div class="cols pro-cols">
        <div class="stack">${main}</div>
        <div class="stack">${side}</div>
      </div>
    </div>`;
}

export const aboutBlock = (text) => (text?.trim()
  ? `<section class="panel"><h2 class="pro-h">About</h2><div class="prose">${paragraphs(text)}</div></section>`
  : '');

export const sideBlock = (title, body) => `<section class="panel"><h2 class="pro-h">${title}</h2>${body}</section>`;

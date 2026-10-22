// The results reel: a strip along the bottom of the screen that scrolls through the latest
// results (like a sports ticker). Tap a score for the match page. "×" hides it for this visit.
// Worked out from the same cached event data as the pages.

import { loadAllBundles } from './data.js';
import { allFixtures, resultOf } from './pages/parts.js';
import { esc, urls, teamDot } from './ui.js';

const HIDE_KEY = 'jvo.reelHidden';
const SHOW = 12; // newest results shown
let el = null;
let drawnKey = null;

const hidden = () => { try { return sessionStorage.getItem(HIDE_KEY) === '1'; } catch { return false; } };

function item(b, f, check) {
  const home = b.teamsById[f.homeTeamId];
  const away = b.teamsById[f.awayTeamId];
  const short = (t) => esc(t?.shortName ?? t?.name ?? 'TBC');
  const homeWon = check.winner === 'home';
  return `<a class="reel-item" href="${urls.match(b.event.id, f.id)}" data-link title="${esc(`${home?.name ?? 'TBC'} v ${away?.name ?? 'TBC'} · ${b.event.title}`)}">
    ${teamDot(home)}<span class="${homeWon ? 'won' : ''}">${short(home)}</span>
    <b class="num">${check.homeSets}–${check.awaySets}</b>
    <span class="${homeWon ? '' : 'won'}">${short(away)}</span>${teamDot(away)}
  </a>`;
}

export async function updateReel() {
  if (hidden()) {
    el?.remove();
    el = null;
    document.body.classList.remove('has-reel');
    return;
  }
  let bundles;
  try { bundles = await loadAllBundles(); } catch { return; }
  const latest = allFixtures(bundles)
    .map(({ b, f }) => ({ b, f, check: resultOf(b, f).check }))
    .filter((x) => x.check?.ok)
    .reverse()
    .slice(0, SHOW);
  const key = latest.map(({ b, f }) => `${b.event.id}/${f.id}`).join(',');
  if (!latest.length) {
    el?.remove();
    el = null;
    document.body.classList.remove('has-reel');
    return;
  }
  if (key === drawnKey && el) return;
  drawnKey = key;

  const items = latest.map(({ b, f, check }) => item(b, f, check)).join('<i class="reel-sep" aria-hidden="true">•</i>');
  el ??= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'reel' }));
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Latest results');
  // The list is there twice so the scroll can loop without a gap; the copy is hidden from screen readers.
  el.innerHTML = `
    <a class="reel-label" href="/fixtures?view=results" data-link>results</a>
    <div class="reel-window"><div class="reel-track" style="--reel-time:${Math.max(25, latest.length * 6)}s">
      <div class="reel-set">${items}<i class="reel-sep" aria-hidden="true">•</i></div>
      <div class="reel-set" aria-hidden="true">${items.replaceAll('data-link', 'data-link tabindex="-1"')}<i class="reel-sep">•</i></div>
    </div></div>
    <button class="reel-close" type="button" aria-label="Hide the results reel" title="Hide">×</button>`;
  document.body.classList.add('has-reel');
  el.querySelector('.reel-close').addEventListener('click', () => {
    try { sessionStorage.setItem(HIDE_KEY, '1'); } catch { /* fine */ }
    updateReel();
  });
}

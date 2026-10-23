// The ticker along the bottom of the screen, with two tabs:
// - results: the latest scores (tap one for the match page)
// - transfers: transfer news (players joining, leaving or being released, new clubs)
// It scrolls like a sports ticker and pauses on hover. "×" hides it for this visit; the chosen tab
// is remembered on the device.

import { loadAllBundles, loadPeople, loadTransfers } from './data.js';
import { allFixtures, resultOf } from './pages/parts.js';
import { esc, urls, teamDot, fmtDay } from './ui.js';

const HIDE_KEY = 'jvo.reelHidden';
const TAB_KEY = 'jvo.reelTab';
const SHOW = 12; // newest items shown
let el = null;
let drawnKey = null;

const hidden = () => { try { return sessionStorage.getItem(HIDE_KEY) === '1'; } catch { return false; } };
const getTab = () => { try { return localStorage.getItem(TAB_KEY) === 'transfers' ? 'transfers' : 'results'; } catch { return 'results'; } };
const setTab = (t) => { try { localStorage.setItem(TAB_KEY, t); } catch { /* fine */ } };

function resultItem(b, f, check) {
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

function transferItem(t, people) {
  const p = people.playersById[t.playerId];
  const from = people.teamsById[t.fromTeamId];
  const to = people.teamsById[t.toTeamId];
  const who = `<b class="won">${esc(p?.displayName ?? 'A player')}</b>`;
  const club = (c) => (c ? `${teamDot(c)}<span>${esc(c.name)}</span>` : '<span>a club</span>');
  const text = {
    founded: `🆕 ${who} <span>started</span> ${club(to)}`,
    joined: from ? `🔁 ${who} ${club(from)} <b>→</b> ${club(to)}` : `✍️ ${who} <span>joined</span> ${club(to)}`,
    left: `👋 ${who} <span>left</span> ${club(from)}`,
    released: `✂️ ${club(from)} <span>released</span> ${who}`,
  }[t.kind] ?? `${who}`;
  const href = to ? urls.team(to.id) : p ? urls.player(p.id) : '/teams';
  return `<a class="reel-item" href="${href}" data-link>${text}${t.at ? `<small class="reel-when">${esc(fmtDay(t.at))}</small>` : ''}</a>`;
}

const sep = '<i class="reel-sep" aria-hidden="true">•</i>';

export async function updateReel() {
  if (hidden()) {
    el?.remove();
    el = null;
    drawnKey = null;
    document.body.classList.remove('has-reel');
    return;
  }
  let bundles;
  let transfers;
  let people;
  try {
    [bundles, transfers, people] = await Promise.all([loadAllBundles(), loadTransfers().catch(() => []), loadPeople()]);
  } catch { return; }
  const results = allFixtures(bundles)
    .map(({ b, f }) => ({ b, f, check: resultOf(b, f).check }))
    .filter((x) => x.check?.ok)
    .reverse()
    .slice(0, SHOW);
  const news = transfers.slice(0, SHOW);
  if (!results.length && !news.length) {
    el?.remove();
    el = null;
    drawnKey = null;
    document.body.classList.remove('has-reel');
    return;
  }
  const tab = getTab();
  const key = `${tab}|${results.map(({ b, f }) => `${b.event.id}/${f.id}`).join(',')}|${news.map((t) => t.id).join(',')}`;
  if (key === drawnKey && el) return;
  drawnKey = key;

  const items = tab === 'transfers'
    ? news.map((t) => transferItem(t, people)).join(sep)
    : results.map(({ b, f, check }) => resultItem(b, f, check)).join(sep);
  const count = tab === 'transfers' ? news.length : results.length;
  el ??= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'reel' }));
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', tab === 'transfers' ? 'Transfer news' : 'Latest results');
  // The list is there twice so the scroll can loop without a gap; the copy is hidden from screen readers.
  el.innerHTML = `
    <div class="reel-tabs" role="tablist">
      <button type="button" role="tab" data-reel-tab="results" aria-selected="${tab === 'results'}">results</button>
      <button type="button" role="tab" data-reel-tab="transfers" aria-selected="${tab === 'transfers'}">transfers</button>
    </div>
    <div class="reel-window">${count ? `<div class="reel-track" style="--reel-time:${Math.max(25, count * (tab === 'transfers' ? 8 : 6))}s">
      <div class="reel-set">${items}${sep}</div>
      <div class="reel-set" aria-hidden="true">${items.replaceAll('data-link', 'data-link tabindex="-1"')}${sep}</div>
    </div>` : `<span class="reel-empty">${tab === 'transfers' ? 'No transfers yet. Moves between clubs show up here.' : 'No results yet.'}</span>`}</div>
    <button class="reel-close" type="button" aria-label="Hide the ticker" title="Hide">×</button>`;
  document.body.classList.add('has-reel');
  el.querySelector('.reel-close').addEventListener('click', () => {
    try { sessionStorage.setItem(HIDE_KEY, '1'); } catch { /* fine */ }
    updateReel();
  });
  el.querySelectorAll('[data-reel-tab]').forEach((b) => b.addEventListener('click', () => {
    setTab(b.dataset.reelTab);
    updateReel();
  }));
}

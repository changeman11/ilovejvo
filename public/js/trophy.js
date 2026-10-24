// Trophy announcement, on the right side of every page: the podium of the latest event that has one
// (rules/podium.js). 1st place gets the spotlight (big logo, gold shine, sparkles); 2nd and 3rd below.
// Wide screens (≥1800px): a full card under the FEATURED! card. Smaller screens: a gold
// "🏆 Champions" tab at the top right that opens the card. "×" folds it to the tab (per event, on
// this device).
import { loadAllBundles } from './data.js';
import { esc, urls, teamDot } from './ui.js';
import { latestPodium } from './rules/podium.js';

const FOLD_KEY = 'jvo.trophyFolded'; // event id folded on wide screens
const store = { get: (k) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } }, set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* fine */ } } };
let el = null;
let openFor = ''; // smaller screens: the card is open until the page changes (not remembered)
let lastPath = location.pathname;

const wide = () => matchMedia('(min-width: 1800px)').matches;

// Sit under the FEATURED! card on wide screens.
function place() {
  if (!el) return;
  const featured = document.querySelector('.featured:not(.folded)');
  el.style.top = wide() && featured ? `${Math.round(featured.getBoundingClientRect().bottom + 14)}px` : '';
}

export async function updateTrophy() {
  let bundles;
  try { bundles = await loadAllBundles(); } catch { return; }
  const latest = latestPodium(bundles);
  if (!latest) { el?.remove(); el = null; return; }
  const { b, podium } = latest;
  const e = b.event;
  const team = (id) => b.teamsById[id];
  const name = (id) => esc(team(id)?.name ?? 'TBC');
  const [first, second, third] = [1, 2, 3].map((n) => podium.places.find((p) => p.place === n)?.teamIds ?? []);
  const champ = first[0];

  el ??= document.body.appendChild(Object.assign(document.createElement('aside'), { className: 'trophy' }));
  el.setAttribute('aria-label', `Champions of ${e.title}`);
  if (location.pathname !== lastPath) { openFor = ''; lastPath = location.pathname; }
  const open = wide() ? store.get(FOLD_KEY) !== e.id : openFor === e.id;
  el.classList.toggle('open', open);

  const other = (ids, medal, label) => (ids.length ? `
    <div class="tr-place">
      <span class="tr-medal" aria-hidden="true">${medal}</span>
      <span class="tr-teams">${ids.map((id) => `<a href="${urls.team(id)}" data-link>${teamDot(team(id))}<span>${name(id)}</span></a>`).join('')}</span>
      <small>${label}${ids.length > 1 ? ' (shared)' : ''}</small>
    </div>` : '');

  const html = `
    <button class="tr-tab" type="button" aria-expanded="${open}" title="${esc(e.title)} champions">🏆 <span>Champions</span> <b>${name(champ)}</b></button>
    <div class="tr-card">
      <button class="tr-close" type="button" aria-label="Close" title="Close">×</button>
      <span class="tr-ribbon">🏆 Champions</span>
      <a class="tr-event" href="${urls.event(e.id)}" data-link>${esc(e.title)}</a>
      <a class="tr-first" href="${urls.team(champ)}" data-link>
        <span class="tr-sparkles" aria-hidden="true"><i>✦</i><i>✧</i><i>✦</i><i>✧</i><i>✦</i></span>
        <span class="tr-cup" aria-hidden="true">🏆</span>
        ${teamDot(team(champ), 'xl')}
        <b class="tr-champ">${name(champ)}</b>
        <span class="tr-firstlabel">1st place</span>
      </a>
      ${other(second, '🥈', '2nd place')}
      ${other(third, '🥉', '3rd place')}
      <a class="tr-more" href="${urls.event(e.id)}" data-link>See the finals →</a>
    </div>`;
  // Only rebuilt when something in it changed: the site redraws on every live update, and
  // rebuilding each time reloaded the logos (they flickered).
  if (el.dataset.html !== html) {
    el.innerHTML = html;
    el.dataset.html = html;
  }
  el.dataset.eventId = e.id;
  if (!el.dataset.bound) {
    el.dataset.bound = '1';
    el.addEventListener('click', (ev) => {
      const id = el.dataset.eventId;
      if (ev.target.closest('.tr-tab')) {
        if (wide()) store.set(FOLD_KEY, ''); else openFor = el.classList.contains('open') ? '' : id;
        updateTrophy();
      } else if (ev.target.closest('.tr-close')) {
        if (wide()) store.set(FOLD_KEY, id); else openFor = '';
        updateTrophy();
      }
    });
  }
  place();
  requestAnimationFrame(place); // after the featured card has drawn
}

addEventListener('resize', () => { if (el) updateTrophy(); });

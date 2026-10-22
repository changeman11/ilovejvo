// Search box in the top bar: find players and teams by name. Press "/" to jump to it.
// Uses the same cached player/team lists as the pages, so typing is instant.

import { loadPeople, isApprovedTeam } from './data.js';
import { esc, avatarImg, teamDot, urls } from './ui.js';
import { navigate } from './nav.js';

const box = document.querySelector('[data-search]');
const input = box?.querySelector('input');
const list = box?.querySelector('.search-results');
const MAX = 8;
let people = null;
let active = -1;

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

// Best matches first: names that start with the text, then names containing it.
function find(q) {
  const t = norm(q.trim());
  if (!t || !people) return [];
  const score = (name) => {
    const n = norm(name);
    if (n === t) return 0;
    if (n.startsWith(t)) return 1;
    if (n.split(/\s+/).some((w) => w.startsWith(t))) return 2;
    return n.includes(t) ? 3 : -1;
  };
  const items = [
    ...people.teams.filter(isApprovedTeam).map((team) => ({ kind: 'team', team, s: Math.min(...[team.name, team.shortName].filter(Boolean).map(score).map((x) => (x < 0 ? 99 : x))) })),
    ...people.players.filter((p) => p.active !== false).map((player) => ({ kind: 'player', player, s: score(player.displayName) })),
  ].filter((i) => i.s >= 0 && i.s < 99);
  return items
    .sort((a, b) => a.s - b.s || (a.kind === 'team' ? a.team.name : a.player.displayName).localeCompare(b.kind === 'team' ? b.team.name : b.player.displayName))
    .slice(0, MAX);
}

function row(item, i) {
  if (item.kind === 'team') {
    return `<a class="sr${i === active ? ' on' : ''}" href="${urls.team(item.team.id)}" data-link role="option">
      ${teamDot(item.team, 'lg')}<span class="sr-main"><b>${esc(item.team.name)}</b><small>team</small></span></a>`;
  }
  const p = item.player;
  const team = p.teamId ? people.teamsById[p.teamId] : null;
  return `<a class="sr${i === active ? ' on' : ''}" href="${urls.player(p.id)}" data-link role="option">
    ${avatarImg(p, 'avatar sm')}<span class="sr-main"><b>${esc(p.displayName)}</b><small>${isApprovedTeam(team) ? esc(team.name) : 'free agent'}</small></span></a>`;
}

let results = [];
function draw() {
  const q = input.value.trim();
  results = find(q);
  if (!q) {
    list.hidden = true;
    return;
  }
  list.innerHTML = results.length ? results.map(row).join('') : `<p class="sr-empty">No players or teams called “${esc(q)}”.</p>`;
  list.hidden = false;
}

// loadPeople is cached by data.js (and refreshed there after any save), so this is cheap.
async function ensurePeople() {
  try {
    people = await loadPeople();
  } catch {
    people = null;
  }
}

function close() {
  list.hidden = true;
  active = -1;
}

if (box) {
  input.addEventListener('focus', async () => {
    await ensurePeople();
    if (input.value.trim()) draw();
  });
  input.addEventListener('input', async () => {
    active = -1;
    await ensurePeople();
    draw();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
      draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = results[active >= 0 ? active : 0];
      if (!pick) return;
      navigate(pick.kind === 'team' ? urls.team(pick.team.id) : urls.player(pick.player.id));
      input.value = '';
      input.blur();
      close();
    } else if (e.key === 'Escape') {
      e.preventDefault(); // don't also trigger the page's "back"
      input.value = '';
      close();
      input.blur();
    }
  });
  // Picking a result: the site's link handler navigates; then tidy up.
  list.addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      input.value = '';
      close();
    }
  });
  document.addEventListener('click', (e) => {
    if (!box.contains(e.target)) close();
  });
  // "/" anywhere (except while typing) jumps to search.
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    input.focus();
  });
}

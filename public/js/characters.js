// Community characters taking turns on the Home page court (desktop: standing on the court
// behind the menu; phones: in the banner). Pictures: public/images/characters (list.json),
// cut out by scripts/cut-characters.mjs), plus the ones the Discord bot adds from #in-game-characters
// (Firestore `characters`, pictures in Storage; bot/src/characters.js). Switch off with
// `cyclingCharacters` in config.js.

import { cyclingCharacters } from './config.js';
import { getDocs, collection } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db } from './firebase.js';
import { mediaUrl } from './media.js';

const DIR = '/images/characters/';
const EVERY_MS = 6000;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

// The court without anyone on it, when characters are switched on (CSS swaps the background).
if (cyclingCharacters) document.documentElement.classList.add('chars-on');

export const charactersOn = cyclingCharacters;

// Markup for a spot where characters appear: two stacked pictures that cross-fade, and the
// game's volleyball at their feet.
export const characterSpot = (cls) => (cyclingCharacters
  ? `<div class="char-spot ${cls}" data-char-spot aria-hidden="true"><img alt="" decoding="async"><img alt="" decoding="async"><img class="char-ball" src="/images/art/ball.png" alt="" decoding="async"></div>`
  : '');

// Pictures that already show a ball (named "...ball...") don't get a second one.
const hasOwnBall = (name) => /ball/i.test(name);

// name -> picture address. Hand-made ones are files here; the bot's are in Storage.
const srcs = new Map();
const srcOf = (name) => srcs.get(name) ?? `${DIR}${name}`;

let list = null;
async function loadList() {
  if (!list) {
    const [files, added] = await Promise.all([
      fetch(`${DIR}list.json`).then((r) => r.json()).catch(() => []),
      getDocs(collection(db, 'characters')).then((s) => s.docs.map((d) => d.data())).catch(() => []),
    ]);
    for (const c of added) if (c.path) srcs.set(`${c.key}.png`, mediaUrl(c.path));
    list = [...files, ...added.filter((c) => c.path).map((c) => `${c.key}.png`)];
  }
  return list;
}

const shuffled = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// The player's favourite character (file name), or '' to let them take turns. Saved on this device.
const PICK_KEY = 'jvo.character';
const getPick = () => { try { return localStorage.getItem(PICK_KEY) ?? ''; } catch { return ''; } };
const setPick = (name) => { try { localStorage.setItem(PICK_KEY, name); } catch { /* fine */ } };

// The "character" button (bottom right of the Home court / phone banner) and its menu.
export const characterPicker = (cls) => (cyclingCharacters
  ? `<div class="char-pick ${cls}" data-char-pick>
      <button class="char-pick-btn" type="button" aria-haspopup="listbox" aria-expanded="false"><span aria-hidden="true">🏐</span> character <span aria-hidden="true">▾</span></button>
      <div class="char-menu" role="listbox" aria-label="Choose a character" hidden></div>
    </div>`
  : '');

function drawMenu(menu, names, chosen) {
  const item = (name, label) => `<button type="button" role="option" class="char-opt${name === chosen ? ' on' : ''}" aria-selected="${name === chosen}" data-char="${name}" title="${label}">${name
    ? `<img src="${srcOf(name)}" alt="" loading="lazy" decoding="async">`
    : '<span class="char-shuffle" aria-hidden="true">🔀</span>'}<span class="sr-only">${label}</span></button>`;
  menu.innerHTML = `<p class="char-menu-title">Pick your character</p>
    <div class="char-grid">${item('', 'Shuffle all')}${names.map((n, k) => item(n, `Character ${k + 1}`)).join('')}</div>`;
}

let timer = null;

// Starts every character spot inside `root`. Stops by itself when the page changes.
export async function startCharacters(root) {
  const spots = [...root.querySelectorAll('[data-char-spot]')];
  if (!spots.length) return;
  const all = await loadList();
  const names = shuffled(all);
  if (!names.length) return;

  // Character picker(s): choose one to keep, or shuffle.
  for (const pick of root.querySelectorAll('[data-char-pick]')) {
    const btn = pick.querySelector('.char-pick-btn');
    const menu = pick.querySelector('.char-menu');
    const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', () => {
      const opening = menu.hidden;
      if (opening) drawMenu(menu, all, getPick());
      menu.hidden = !opening;
      btn.setAttribute('aria-expanded', String(opening));
    });
    menu.addEventListener('click', (e) => {
      const opt = e.target.closest('[data-char]');
      if (!opt) return;
      setPick(opt.dataset.char);
      close();
      run();
    });
    document.addEventListener('click', (e) => { if (!pick.contains(e.target) && !menu.hidden) close(); });
    pick.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { e.stopPropagation(); close(); btn.focus(); } });
  }

  let i = 0;
  const show = (spot, name) => {
    const [a, b] = spot.querySelectorAll('img:not(.char-ball)');
    const [front, back] = a.classList.contains('on') ? [a, b] : [b, a];
    back.onload = () => {
      back.classList.add('on');
      front.classList.remove('on');
      spot.classList.toggle('own-ball', hasOwnBall(name));
    };
    back.src = srcOf(name);
  };
  // A chosen character stays put; otherwise they take turns.
  function run() {
    clearInterval(timer);
    const chosen = getPick();
    if (chosen && all.includes(chosen)) {
      spots.forEach((s) => show(s, chosen));
      return;
    }
    spots.forEach((s) => show(s, names[i]));
    if (names.length < 2 || reduceMotion.matches) return;
    timer = setInterval(() => {
      if (!spots[0].isConnected) return clearInterval(timer); // left the page
      if (document.hidden) return; // don't change while nobody's looking
      i = (i + 1) % names.length;
      new Image().src = srcOf(names[(i + 1) % names.length]); // get the next one ready
      spots.forEach((s) => show(s, names[i]));
    }, EVERY_MS);
  }
  run();
}

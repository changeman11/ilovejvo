// Community characters taking turns on the Home page court (desktop: standing on the court
// behind the menu; phones: in the banner). Pictures: public/images/characters (list.json),
// cut out by scripts/cut-characters.mjs. Switch off with `cyclingCharacters` in config.js.

import { cyclingCharacters } from './config.js';

const DIR = '/images/characters/';
const EVERY_MS = 6000;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

// The court without anyone on it, when characters are switched on (CSS swaps the background).
if (cyclingCharacters) document.documentElement.classList.add('chars-on');

export const charactersOn = cyclingCharacters;

// Markup for a spot where characters appear: two stacked pictures that cross-fade.
export const characterSpot = (cls) => (cyclingCharacters
  ? `<div class="char-spot ${cls}" data-char-spot aria-hidden="true"><img alt="" decoding="async"><img alt="" decoding="async"></div>`
  : '');

let list = null;
async function loadList() {
  if (!list) {
    try {
      list = await (await fetch(`${DIR}list.json`)).json();
    } catch {
      list = [];
    }
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

// Starts every character spot inside `root`. Stops by itself when the page changes.
export async function startCharacters(root) {
  const spots = [...root.querySelectorAll('[data-char-spot]')];
  if (!spots.length) return;
  const names = shuffled(await loadList());
  if (!names.length) return;
  let i = 0;
  const show = (spot, name) => {
    const [a, b] = spot.querySelectorAll('img');
    const [front, back] = a.classList.contains('on') ? [a, b] : [b, a];
    back.onload = () => {
      back.classList.add('on');
      front.classList.remove('on');
    };
    back.src = `${DIR}${name}`;
  };
  spots.forEach((s) => show(s, names[0]));
  if (names.length < 2 || reduceMotion.matches) return;
  const timer = setInterval(() => {
    if (!spots[0].isConnected) return clearInterval(timer); // left the page
    if (document.hidden) return; // don't change while nobody's looking
    i = (i + 1) % names.length;
    new Image().src = `${DIR}${names[(i + 1) % names.length]}`; // get the next one ready
    spots.forEach((s) => show(s, names[i]));
  }, EVERY_MS);
}

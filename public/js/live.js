// Live pages: watches an event's sign-ups, fixtures, results and settings, and quietly redraws the
// page when any of them change (e.g. a club joins or pulls out, so the draft fixtures update).
// app.js stops every watch when the page changes.

import { onSnapshot, collection, doc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { db, adminDatabase } from './firebase.js';
import { invalidate } from './data.js';
import { refreshQuietly } from './nav.js';

let stops = [];

export function stopLive() {
  for (const stop of stops) stop();
  stops = [];
}

// Any other listener a page opens (e.g. the team chat), stopped with the rest when the page changes.
export function keepUntilPageChanges(stop) {
  stops.push(stop);
}

// Don't redraw under someone who's typing; try again shortly.
function typing() {
  const el = document.activeElement;
  return Boolean(el && el.closest('main') && el.matches('input, textarea, select'));
}

export function watchEvent(eventId, { admin = false } = {}) {
  const database = admin ? adminDatabase() : db;
  let timer = null;
  const redraw = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (typing()) return redraw();
      invalidate(`event:${eventId}`);
      refreshQuietly();
    }, 400);
  };
  const watch = (ref) => {
    let first = true; // the first snapshot is what's already on screen
    stops.push(onSnapshot(ref, () => {
      if (first) { first = false; return; }
      redraw();
    }, () => { /* not allowed to watch (e.g. a draft): just don't update live */ }));
  };
  watch(doc(database, `events/${eventId}`));
  for (const sub of ['entries', 'fixtures', 'results']) watch(collection(database, `events/${eventId}/${sub}`));
  stops.push(() => clearTimeout(timer));
}

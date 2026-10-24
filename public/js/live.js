// Live pages. Since 2026-10-24 every read in data.js is a live listener, and app.js redraws the
// page (plus the bell, the bars, the reel and the featured card) whenever any of it changes, so
// pages don't watch the database by hand any more. What's left here:
// - listeners and timers a page opens itself, stopped when the page is redrawn or left
// - parts of a page that should survive a redraw (data-keep, e.g. the team chat), so their own
//   listener isn't closed and opened again (that would re-read every message each time)

let stops = [];

export function stopLive() {
  for (const stop of stops) stop();
  stops = [];
}

// Any other listener or timer a page opens, stopped with the rest when the page is redrawn or left.
export function keepUntilPageChanges(stop) {
  stops.push(stop);
}

// ---------- Kept parts (data-keep="<key>") ----------
// When the same page is redrawn, an element with the same data-keep key is moved into the new page
// as it is (app.js swapKept), so whatever runs inside it carries on. Its stop functions run once
// it's no longer on the page.
const kept = new Map(); // element -> [stop]

export function keepWhileShown(el, stop) {
  if (!kept.has(el)) kept.set(el, []);
  kept.get(el).push(stop);
}

// Before a redraw: the kept elements now on the page, by key.
export function keptNow(root) {
  return new Map([...root.querySelectorAll('[data-keep]')].map((el) => [el.dataset.keep, el]));
}

// After a redraw: put the old elements back in place of their new copies, then stop whatever
// belonged to elements that are gone.
export function swapKept(root, before) {
  for (const el of root.querySelectorAll('[data-keep]')) {
    const old = before.get(el.dataset.keep);
    if (old && old !== el) el.replaceWith(old);
  }
  for (const [el, list] of [...kept]) {
    if (el.isConnected) continue;
    list.forEach((stop) => stop());
    kept.delete(el);
  }
}

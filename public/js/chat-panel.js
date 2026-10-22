// The chat panel: slides in from the right edge of every page with an arrow tab (Clash of Clans
// style). Two tabs: Global (everyone) and Club (your squad). A red count on the tab shows new
// messages while it's closed. Open/closed and the swear filter are remembered on this device.

import { currentUser, currentAdmin } from './auth.js';
import { loadPeople, isApprovedTeam } from './data.js';
import { ensurePlayerLink } from './player-data.js';
import { chatboxHtml, mountChatbox, filterOn, setFilter } from './chatbox.js';
import { esc } from './ui.js';

const OPEN_KEY = 'jvo.chatOpen';
const TAB_KEY = 'jvo.chatTab';
const SEEN_KEY = 'jvo.chatSeen';
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* fine */ } },
};

let dock = null;
let stops = [];
let state = { open: false, tab: 'global', latest: { global: 0, club: 0 }, mineUid: null, unread: { global: 0, club: 0 } };

const seen = (tab) => Number(store.get(`${SEEN_KEY}.${tab}`, 0));
const markSeen = (tab) => store.set(`${SEEN_KEY}.${tab}`, String(Math.max(state.latest[tab], Date.now())));

function skeleton() {
  const el = document.createElement('aside');
  el.className = 'chat-dock';
  el.setAttribute('aria-label', 'Chat');
  el.innerHTML = `
    <button class="chat-handle" type="button" data-chat-toggle aria-expanded="false" aria-controls="chat-drawer">
      <span class="chat-arrow" aria-hidden="true">◀</span><span class="chat-handle-label">chat</span><span class="chat-unread" hidden></span>
    </button>
    <div class="chat-drawer" id="chat-drawer">
      <div class="chat-head">
        <nav class="chat-tabs" role="tablist">
          <button type="button" role="tab" data-chat-tab="global">Global<span class="chat-unread small" hidden></span></button>
          <button type="button" role="tab" data-chat-tab="club">Club<span class="chat-unread small" hidden></span></button>
        </nav>
        <label class="chat-filter" title="Star out swear words"><input type="checkbox" data-chat-filter> Filter</label>
        <button class="chat-close" type="button" data-chat-toggle aria-label="Close chat">▶</button>
      </div>
      <div class="chat-pane" data-pane="global"></div>
      <div class="chat-pane" data-pane="club" hidden></div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-chat-toggle]')) return setOpen(!state.open);
    const tab = e.target.closest('[data-chat-tab]');
    if (tab) return setTab(tab.dataset.chatTab);
    if (e.target.closest('a[data-link]') && matchMedia('(max-width: 759px)').matches) setOpen(false); // phones: follow the link
  });
  el.querySelector('[data-chat-filter]').addEventListener('change', (e) => setFilter(e.target.checked));
  // Links elsewhere (e.g. the admin bell) can open the global chat.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-open-chat]')) return;
    e.preventDefault();
    setTab('global');
    setOpen(true);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.open && el.contains(document.activeElement)) setOpen(false); });
  return el;
}

function setOpen(open) {
  state.open = open;
  store.set(OPEN_KEY, open ? '1' : '0');
  dock.classList.toggle('open', open);
  dock.querySelectorAll('[data-chat-toggle]').forEach((b) => b.setAttribute('aria-expanded', String(open)));
  dock.querySelector('.chat-arrow').textContent = open ? '▶' : '◀';
  if (open) {
    markSeen(state.tab);
    state.unread[state.tab] = 0;
    const log = dock.querySelector(`[data-pane="${state.tab}"] [data-chat-log]`);
    if (log) log.scrollTop = log.scrollHeight;
  }
  drawCounts();
}

function setTab(tab) {
  state.tab = tab;
  store.set(TAB_KEY, tab);
  dock.querySelectorAll('[data-chat-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.chatTab === tab)));
  dock.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
  if (state.open) { markSeen(tab); state.unread[tab] = 0; }
  const log = dock.querySelector(`[data-pane="${tab}"] [data-chat-log]`);
  if (log) log.scrollTop = log.scrollHeight;
  drawCounts();
}

function drawCounts() {
  const total = state.unread.global + state.unread.club;
  const set = (el, n) => { el.hidden = !n; el.textContent = n > 9 ? '9+' : String(n); };
  set(dock.querySelector('.chat-handle .chat-unread'), state.open ? 0 : total);
  set(dock.querySelector('[data-chat-tab="global"] .chat-unread'), state.unread.global);
  set(dock.querySelector('[data-chat-tab="club"] .chat-unread'), state.unread.club);
}

// Counts messages from other people since this tab was last looked at.
const counter = (tab) => (messages) => {
  state.latest[tab] = messages.at(-1)?.createdAt ?? state.latest[tab];
  const looking = state.open && state.tab === tab && !document.hidden;
  if (looking) { markSeen(tab); state.unread[tab] = 0; } else {
    const since = seen(tab);
    state.unread[tab] = messages.filter((m) => (m.createdAt ?? 0) > since && m.authorUid !== state.mineUid).length;
  }
  drawCounts();
};

// (Re)builds both panes for whoever is signed in. Called on start and whenever the sign-in changes.
let runId = 0;
export async function startChatPanel() {
  dock ??= skeleton();
  const id = ++runId;
  const [user, adminState, people] = await Promise.all([
    currentUser().catch(() => null), currentAdmin().catch(() => null), loadPeople().catch(() => ({ players: [], teamsById: {} })),
  ]);
  if (id !== runId) return; // a newer start (sign-in changed again) takes over
  for (const stop of stops) stop();
  stops = [];
  const player = user ? people.players.find((p) => p.uid === user.uid) ?? null : null;
  const adminUid = adminState?.admin ? adminState.user.uid : null;
  state.mineUid = user?.uid ?? null;
  dock.querySelector('[data-chat-filter]').checked = filterOn();

  // Global
  const globalPane = dock.querySelector('[data-pane="global"]');
  const note = user
    ? (player ? '' : '<p class="chat-note small"><a href="/me" data-link>Make your profile</a> to chat.</p>')
    : '<p class="chat-note small"><button class="btn btn-sm" type="button" data-discord-signin>Sign in with Discord</button> to chat.</p>';
  globalPane.innerHTML = chatboxHtml({ placeholder: 'Chat with everyone', maxLength: 300, signInNote: note });
  stops.push(mountChatbox(globalPane, { path: 'chat', user, player, adminUid, rateLimit: true, show: 60, onMessages: counter('global') }));

  // Club
  const clubPane = dock.querySelector('[data-pane="club"]');
  const team = player?.teamId && isApprovedTeam(people.teamsById[player.teamId]) ? people.teamsById[player.teamId] : null;
  state.unread.club = 0;
  if (!team) {
    clubPane.innerHTML = `<p class="chat-note small">${player ? 'Join a club to chat with your squad here. <a href="/club" data-link>Find a club</a>' : 'Your club’s chat shows here once you’re in a club.'}</p>`;
  } else {
    clubPane.innerHTML = `<p class="chat-club-name small"><b>${esc(team.name)}</b> · only your squad sees this</p>${chatboxHtml({ placeholder: 'Message your squad', maxLength: 500 })}`;
    let stopped = false;
    stops.push(() => { stopped = true; });
    ensurePlayerLink({ uid: user.uid, player }).catch(() => {}).then(() => {
      if (stopped) return;
      stops.push(mountChatbox(clubPane, {
        path: `teams/${team.id}/chat`, user, player, adminUid, canDelete: () => team.managerUid === user.uid, show: 60, onMessages: counter('club'),
      }));
    });
  }

  setTab(store.get(TAB_KEY, 'global') === 'club' && team ? 'club' : 'global');
  setOpen(store.get(OPEN_KEY, '0') === '1');
}

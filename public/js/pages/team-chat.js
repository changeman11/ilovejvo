// Team chat in the Club hub: the squad's own chat, live. Stored in teams/{teamId}/chat; only squad
// members and admins can read it (firestore.rules inSquad). Uses the shared chat box (chatbox.js),
// so slurs are blocked and swearing is starred out like the global chat.

import { ensurePlayerLink } from '../player-data.js';
import { keepWhileShown } from '../live.js';
import { chatboxHtml, mountChatbox } from '../chatbox.js';
import { esc } from '../ui.js';

// data-keep: when the Club hub redraws itself (live updates), the chat box stays as it is.
export function chatBlock(team, player) {
  return `
    <section class="team-chat" data-chat data-keep="team-chat-${esc(team.id)}-${esc(player?.uid ?? '')}">
      <div class="section-head"><h2>${esc(team.name)} chat</h2><span class="muted small">Only your squad can see this</span></div>
      <div class="panel chat-panel">${chatboxHtml({ placeholder: 'Message your squad', maxLength: 500 })}</div>
    </section>`;
}

// ctx: { user, player, team, isManager }
export function mountChat(el, ctx) {
  const box = el.querySelector('[data-chat]');
  if (!box || box.dataset.mounted) return; // kept from before a redraw: already running
  box.dataset.mounted = '1';
  let stopped = false;
  keepWhileShown(box, () => { stopped = true; });
  // The rules recognise squad members through playerLinks/{uid}; make sure it exists first.
  ensurePlayerLink({ uid: ctx.user.uid, player: ctx.player }).catch((e) => console.warn('Chat link:', e)).then(() => {
    if (stopped) return;
    keepWhileShown(box, mountChatbox(box, {
      path: `teams/${ctx.team.id}/chat`,
      user: ctx.user,
      player: ctx.player,
      canDelete: () => ctx.isManager,
      show: 80,
    }));
  });
}

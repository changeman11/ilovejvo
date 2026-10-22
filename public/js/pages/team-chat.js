// Team chat in the Club hub: the squad's own chat, live. Stored in teams/{teamId}/chat; only squad
// members and admins can read it (firestore.rules inSquad). Uses the shared chat box (chatbox.js),
// so slurs are blocked and swearing is starred out like the global chat.

import { ensurePlayerLink } from '../player-data.js';
import { keepUntilPageChanges } from '../live.js';
import { chatboxHtml, mountChatbox } from '../chatbox.js';
import { esc } from '../ui.js';

export function chatBlock(team) {
  return `
    <section class="team-chat" data-chat>
      <div class="section-head"><h2>${esc(team.name)} chat</h2><span class="muted small">Only your squad can see this</span></div>
      <div class="panel chat-panel">${chatboxHtml({ placeholder: 'Message your squad', maxLength: 500 })}</div>
    </section>`;
}

// ctx: { user, player, team, isManager }
export function mountChat(el, ctx) {
  const box = el.querySelector('[data-chat]');
  if (!box) return;
  let stopped = false;
  keepUntilPageChanges(() => { stopped = true; });
  // The rules recognise squad members through playerLinks/{uid}; make sure it exists first.
  ensurePlayerLink({ uid: ctx.user.uid, player: ctx.player }).catch((e) => console.warn('Chat link:', e)).then(() => {
    if (stopped) return;
    keepUntilPageChanges(mountChatbox(box, {
      path: `teams/${ctx.team.id}/chat`,
      user: ctx.user,
      player: ctx.player,
      canDelete: () => ctx.isManager,
      show: 80,
    }));
  });
}

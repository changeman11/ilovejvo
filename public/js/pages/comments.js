// Comments on team and player pages ("Steam profile" style). Newest first.
// Players with a profile can post; the writer, the page owner and admins can delete.
// Pages call commentsBlock() in render() and mountComments() in mount().

import { loadComments, loadPeople } from '../data.js';
import { currentUser, currentAdmin, discordOf } from '../auth.js';
import { postComment, deleteComment } from '../player-data.js';
import { esc, avatarImg, urls, fmtDay, fmtTime, staffTag } from '../ui.js';

const SHOW = 50;
let ctx = null; // { kind, targetId, ownerUid, user, me, adminUid }

function when(ms) {
  if (!ms) return '';
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${fmtDay(ms)} ${fmtTime(ms)}`;
}

function listHtml(comments, playersById) {
  if (!comments.length) return '<p class="muted small comments-empty">No comments yet. Say something nice!</p>';
  return `<ul class="comment-list">${comments.slice(0, SHOW).map((c) => {
    const author = playersById[c.authorPlayerId];
    const canDelete = Boolean(ctx.adminUid) || (ctx.user && (c.authorUid === ctx.user.uid || ctx.ownerUid === ctx.user.uid));
    return `
      <li>
        ${author ? `<a href="${urls.player(author.id)}" data-link>${avatarImg(author, 'avatar')}</a>` : avatarImg({ displayName: '?' }, 'avatar')}
        <div class="comment-main">
          <div class="comment-head">
            ${author ? `<a href="${urls.player(author.id)}" data-link><b>${esc(author.displayName)}</b></a>${staffTag(author, { label: true })}` : '<b>Removed player</b>'}
            <span class="muted small">${esc(when(c.createdAt))}</span>
            ${canDelete ? `<button class="link-btn small" type="button" data-del-comment="${esc(c.id)}">Delete</button>` : ''}
          </div>
          <p>${esc(c.body).replace(/\n/g, '<br>')}</p>
        </div>
      </li>`;
  }).join('')}</ul>${comments.length > SHOW ? `<p class="muted small">Showing the newest ${SHOW} of ${comments.length}.</p>` : ''}`;
}

async function inner() {
  const [comments, people] = await Promise.all([loadComments(ctx.kind, ctx.targetId), loadPeople()]);
  ctx.comments = comments;
  let form;
  if (ctx.me) {
    form = `<form class="comment-form" data-form="comment">
      <textarea name="body" rows="2" maxlength="500" placeholder="Leave a comment" required></textarea>
      <div class="comment-actions"><span class="muted small" data-count>0 / 500</span><button class="btn btn-primary btn-sm" type="submit">Post</button></div>
      <p class="form-error" role="alert" hidden></p>
    </form>`;
  } else if (ctx.signedIn) {
    form = '<p class="muted small"><a href="/me" data-link>Make your profile</a> to comment.</p>';
  } else {
    form = '<p class="muted small"><button class="link-btn" type="button" data-discord-signin>Sign in with Discord</button> to comment.</p>';
  }
  return `
    <div class="section-head"><h2>Comments</h2><span class="muted small">${comments.length || ''}</span></div>
    <div class="panel">${form}${listHtml(comments, people.playersById)}</div>`;
}

// kind: 'team' | 'player'. ownerUid: who owns the page (the player, or the team's manager).
export async function commentsBlock({ kind, targetId, ownerUid = null }) {
  const [user, admin] = await Promise.all([currentUser().catch(() => null), currentAdmin().catch(() => null)]);
  const discord = user ? await discordOf(user).catch(() => null) : null;
  const people = await loadPeople();
  const me = discord ? people.players.find((p) => p.uid === user.uid) ?? null : null;
  ctx = { kind, targetId, ownerUid, user: discord ? user : null, signedIn: Boolean(discord), me, adminUid: admin?.admin ? admin.user.uid : null };
  return `<section class="comments" data-comments>${await inner()}</section>`;
}

export function mountComments(el) {
  const box = el.querySelector('[data-comments]');
  if (!box || !ctx) return;
  const redraw = async () => { box.innerHTML = await inner(); };

  box.addEventListener('input', (e) => {
    if (e.target.name !== 'body') return;
    const count = box.querySelector('[data-count]');
    if (count) count.textContent = `${e.target.value.length} / 500`;
  });

  box.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form="comment"]');
    if (!form) return;
    e.preventDefault();
    const body = form.body.value.trim();
    if (!body) return;
    const btn = form.querySelector('[type=submit]');
    const err = form.querySelector('.form-error');
    btn.disabled = true;
    err.hidden = true;
    try {
      await postComment({ uid: ctx.user.uid, player: ctx.me, kind: ctx.kind, targetId: ctx.targetId, body });
      await redraw();
    } catch (error) {
      console.error(error);
      err.textContent = error.code === 'permission-denied'
        ? 'Slow down a little: you can post once every 15 seconds.'
        : 'That didn’t post. Check your connection and try again.';
      err.hidden = false;
      btn.disabled = false;
    }
  });

  box.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del-comment]');
    if (!btn) return;
    const comment = ctx.comments.find((c) => c.id === btn.dataset.delComment);
    if (!comment || !window.confirm('Delete this comment?')) return;
    btn.disabled = true;
    try {
      const mine = ctx.user && (comment.authorUid === ctx.user.uid || ctx.ownerUid === ctx.user.uid);
      await deleteComment({
        uid: mine ? ctx.user.uid : ctx.adminUid, kind: ctx.kind, targetId: ctx.targetId, comment, admin: !mine,
      });
      await redraw();
    } catch (error) {
      console.error(error);
      btn.disabled = false;
      window.alert('That couldn’t be deleted. Refresh and try again.');
    }
  });
}

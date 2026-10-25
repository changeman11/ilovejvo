// "Something wrong with this result?" on the match page, once a score is in (rules/corrections.js).
// A player or captain on either team sends the right set scores, screenshots that were never posted,
// and/or a note. Same new score from both teams = the score changes straight away; anything else
// goes to the admins (bell + Requests).

import { currentUser } from '../auth.js';
import { isApprovedTeam } from '../data.js';
import { esc, teamDot, playerLink } from '../ui.js';
import { formatFor } from '../rules/season.js';
import { checkResult } from '../rules/match.js';
import { voteLabel, sameSets } from '../rules/votes.js';
import { fixesFor, fixPending, agreeingFix, correctedResult, fixesToAgree } from '../rules/corrections.js';
import { submitFix, withdrawFix } from '../player-data.js';
import { refresh } from '../nav.js';
import { prepareImage, uploadImage, deleteImage, FriendlyError } from '../media.js';
import { shotThumbs } from './report.js';

let ctx = null; // { b, f, result, player, team, mine, format, user, agreeable }
let flash = '';
const MAX_SHOTS = 3;

function fixStatus(c, result) {
  if ((c.status ?? 'open') === 'done') return '<span class="tag">closed by an admin</span>';
  if (c.sets?.length && sameSets(c.sets, result.sets)) return fixPending(c, result) ? '<span class="tag tag-live">score fixed</span> <span class="tag tag-draft">with the admins</span>' : '<span class="tag tag-live">score fixed</span>';
  if (c.sets?.length) return '<span class="tag tag-draft">waiting for the other team, or an admin</span>';
  return '<span class="tag tag-draft">with the admins</span>';
}

// Everyone sees the fixes sent for this match.
function fixList(b, f, result) {
  const { home, away } = fixesFor(b.corrections, f, result);
  if (!home.length && !away.length) return '';
  const row = (c) => `
    <li>
      ${playerLink(b.playersById[c.playerId], c.playerId)} ${teamDot(b.teamsById[c.teamId])}
      ${c.sets?.length ? `says it was <b class="num">${esc(voteLabel(c.sets))}</b>` : 'says the score is right'}
      ${c.screenshotPaths?.length ? `<span class="vote-shots">${shotThumbs(c.screenshotPaths)}</span>` : ''}
      ${c.note ? `<q class="small">${esc(c.note)}</q>` : ''}
      ${fixStatus(c, result)}
    </li>`;
  return `<ul class="fix-list">${[...home, ...away].map(row).join('')}</ul>`;
}

export async function fixPanel(b, f, result) {
  ctx = null;
  if (!result || result.forfeit) return '';
  const list = fixList(b, f, result);
  const user = await currentUser().catch(() => null);
  const player = user ? Object.values(b.playersById).find((p) => p.uid === user.uid) : null;
  const team = player?.teamId ? b.teamsById[player.teamId] : null;
  const onMatch = player && isApprovedTeam(team) && (team.id === f.homeTeamId || team.id === f.awayTeamId);
  if (!onMatch) return list ? `<section class="panel"><h2 class="pro-h">Result fixes</h2>${list}</section>` : '';

  const format = formatFor(b.season, f);
  const mine = (b.corrections ?? []).find((c) => c.id === `${f.id}__${player.id}`) ?? null;
  const captain = Boolean(team.managerUid && team.managerUid === user.uid);
  const agreeable = fixesToAgree({ corrections: b.corrections, fixture: f, result, teamId: team.id });
  ctx = { b, f, result, player, team, mine, format, user, agreeable };
  const home = b.teamsById[f.homeTeamId];
  const away = b.teamsById[f.awayTeamId];
  const other = team.id === f.homeTeamId ? away : home;
  const startSets = mine?.sets?.length ? mine.sets : result.sets;
  const setRows = Array.from({ length: format.bestOf }, (_, i) => {
    const s = startSets[i];
    return `<div class="set-row"><span>Set ${i + 1}</span>
      <input type="number" inputmode="numeric" min="0" name="fix-${i}-home" value="${esc(s?.home ?? '')}" aria-label="Set ${i + 1} ${esc(home?.name)}">
      <input type="number" inputmode="numeric" min="0" name="fix-${i}-away" value="${esc(s?.away ?? '')}" aria-label="Set ${i + 1} ${esc(away?.name)}"></div>`;
  }).join('');
  const scoreWrong = Boolean(mine?.sets?.length);
  const open = Boolean(mine) || agreeable.length || location.hash === '#fix';

  const agreeBox = agreeable.length ? `
    <div class="captain-confirm">
      <b>${esc(other?.name ?? 'The other team')} says the real score was</b>
      ${agreeable.map((c, i) => `<div class="cc-row"><span class="num">${esc(voteLabel(c.sets))}</span>
        <button class="btn btn-sm btn-primary" type="button" data-agree-fix="${i}">✓ Yes, that’s right</button></div>`).join('')}
      <p class="muted small" style="margin:0">${captain ? 'As captain, one tap fixes the score for everyone.' : 'One tap from your team fixes the score for everyone.'}</p>
    </div>` : '';

  return `
    <section class="panel fix-panel" id="fix">
      <h2 class="pro-h">Something wrong with this result?</h2>
      ${flash ? `<p class="report-flash">${esc(flash)}</p>` : ''}
      ${list}
      ${agreeBox}
      <details ${open ? 'open' : ''}>
        <summary class="btn btn-sm">${mine ? '✏️ Change your fix' : '🛠 Fix this result'}</summary>
        <form class="report" data-form="fix" novalidate>
          <p class="muted small">Typed the wrong score in Discord, or forgot the screenshot? Fix it here. If a player from <b>${esc(other?.name ?? 'the other team')}</b> sends the same score, it changes straight away. Anything else goes to the admins.</p>
          <label class="check"><input type="checkbox" name="scoreWrong" ${scoreWrong ? 'checked' : ''}> The score is wrong</label>
          <div class="sets-entry" data-fix-sets ${scoreWrong ? '' : 'hidden'}>
            <div class="set-row set-head"><span></span><span>${esc(home?.shortName ?? 'Home')}</span><span>${esc(away?.shortName ?? 'Away')}</span></div>
            ${setRows}
            <p class="muted small">The real score. Leave unplayed sets empty.</p>
          </div>
          <div class="field">
            <span>End-of-match screenshot (up to ${MAX_SHOTS})</span>
            ${mine?.screenshotPaths?.length ? `<div class="vote-shots">${shotThumbs(mine.screenshotPaths)}</div>` : ''}
            <label class="btn btn-sm" style="justify-self:start">${mine?.screenshotPaths?.length ? 'Replace screenshots…' : 'Add screenshot…'}
              <input type="file" name="shots" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden></label>
            <span class="muted small" data-shots-picked></span>
          </div>
          <label class="field"><span>Anything the admins should know? <span class="muted">(optional)</span></span>
            <textarea name="note" maxlength="500" rows="2" placeholder="e.g. we swapped teams by mistake in the thread">${esc(mine?.note ?? '')}</textarea></label>
          <div class="actions" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <button class="btn btn-primary" type="submit">${mine ? 'Update my fix' : 'Send fix'}</button>
            ${mine ? '<button class="link-btn" type="button" data-act="withdraw-fix">Take it back</button>' : ''}
          </div>
          <p class="form-error" role="alert" hidden></p>
        </form>
      </details>
    </section>`;
}

function readSets(form) {
  const sets = [];
  for (let i = 0; i < ctx.format.bestOf; i++) {
    const h = form.querySelector(`[name="fix-${i}-home"]`).value.trim();
    const a = form.querySelector(`[name="fix-${i}-away"]`).value.trim();
    if (h === '' && a === '') continue;
    sets.push({ home: Number(h), away: Number(a) });
  }
  return sets;
}

export function mountFix(root) {
  const panel = root.querySelector('.fix-panel');
  const form = panel?.querySelector('form[data-form="fix"]');
  if (!form || !ctx) return;
  flash = '';
  if (location.hash === '#fix') panel.scrollIntoView({ block: 'start' });
  const error = form.querySelector('.form-error');
  const showError = (msg) => { error.textContent = msg; error.hidden = false; };

  form.addEventListener('change', (e) => {
    if (e.target.matches('[name=scoreWrong]')) form.querySelector('[data-fix-sets]').hidden = !e.target.checked;
    if (e.target.matches('[name=shots]')) {
      const n = e.target.files.length;
      form.querySelector('[data-shots-picked]').textContent = n > MAX_SHOTS ? `Only the first ${MAX_SHOTS} will be used.` : n ? `${n} picked.` : '';
    }
  });

  // One tap: agree with the other team's score fix (fills in the score and sends).
  panel.addEventListener('click', async (e) => {
    const agree = e.target.closest('[data-agree-fix]');
    if (agree) {
      const c = ctx.agreeable[Number(agree.dataset.agreeFix)];
      if (!c) return;
      panel.querySelector('details').open = true;
      form.querySelector('[name=scoreWrong]').checked = true;
      form.querySelector('[data-fix-sets]').hidden = false;
      for (let i = 0; i < ctx.format.bestOf; i++) {
        form.querySelector(`[name="fix-${i}-home"]`).value = c.sets[i]?.home ?? '';
        form.querySelector(`[name="fix-${i}-away"]`).value = c.sets[i]?.away ?? '';
      }
      agree.disabled = true;
      form.requestSubmit();
      return;
    }
    if (e.target.closest('[data-act="withdraw-fix"]')) {
      if (!window.confirm('Take back your fix?')) return;
      try {
        await withdrawFix({ uid: ctx.user.uid, eventId: ctx.b.event.id, fix: ctx.mine });
        for (const p of ctx.mine.screenshotPaths ?? []) deleteImage(p);
        flash = 'Your fix was taken back.';
        refresh();
      } catch (err) {
        console.error(err);
        showError('That didn’t work. Check your connection and try again.');
      }
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const { b, f, result, player, mine, format, user } = ctx;
    const scoreWrong = form.querySelector('[name=scoreWrong]').checked;
    const sets = scoreWrong ? readSets(form) : [];
    if (scoreWrong) {
      const check = checkResult(sets, format);
      if (!check.ok) return showError(`Check the scores: ${check.errors[0]}.`);
      if (sameSets(sets, result.sets)) return showError('That’s the score that’s already in. Change it, or untick “The score is wrong”.');
    }
    const files = [...(form.querySelector('[name=shots]')?.files ?? [])].slice(0, MAX_SHOTS);
    const note = form.querySelector('[name=note]').value.trim().slice(0, 500);
    if (!sets.length && !files.length && !mine?.screenshotPaths?.length && !note) {
      return showError('Tick “The score is wrong”, add a screenshot, or write a note for the admins.');
    }

    const myFix = { id: `${f.id}__${player.id}`, fixtureId: f.id, teamId: player.teamId, sets };
    const other = agreeingFix({ corrections: b.corrections, fixture: f, result, mine: myFix });
    const applied = other ? correctedResult({ fixture: f, mine: myFix, other }) : null;

    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      let screenshotPaths = mine?.screenshotPaths ?? [];
      if (files.length) {
        button.textContent = 'Uploading screenshots…';
        screenshotPaths = [];
        for (const file of files) {
          const image = await prepareImage(file, 'shot');
          screenshotPaths.push(await uploadImage({ owner: 'players', id: player.id, kind: 'shot', image }));
        }
        button.textContent = 'Saving…';
      }
      await submitFix({ uid: user.uid, eventId: b.event.id, fixtureId: f.id, player, sets, screenshotPaths, note, existing: mine, applied, result });
      if (files.length) for (const old of mine?.screenshotPaths ?? []) deleteImage(old);
      flash = applied ? '✓ Both teams agree: the score is fixed.'
        : sets.length ? 'Sent. The score changes as soon as a player from the other team sends the same, or an admin checks it.'
          : 'Sent to the admins.';
      refresh();
    } catch (err) {
      console.error(err);
      button.disabled = false;
      button.textContent = mine ? 'Update my fix' : 'Send fix';
      showError(err instanceof FriendlyError ? err.message : err.code === 'permission-denied'
        ? 'That couldn’t be saved. You may not be on this team any more. Refresh and try again.'
        : 'Something went wrong. Check your connection and try again.');
    }
  });
}

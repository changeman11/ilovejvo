// Players report a match result by voting (rules/votes.js): the set scores plus their own team's stats.
// Shown on the match page until a result exists. When a player from each team has entered the same
// set scores, the result goes live straight away; otherwise it waits (or goes to an admin if they differ).

import { currentUser } from '../auth.js';
import { isApprovedTeam } from '../data.js';
import { esc, teamDot, playerLink } from '../ui.js';
import { formatFor } from '../rules/season.js';
import { checkResult } from '../rules/match.js';
import { cleanStatLine } from '../rules/results.js';
import { tallyVotes, resultFromVotes, sameSets, voteLabel } from '../rules/votes.js';
import { submitVote } from '../player-data.js';
import { refresh } from '../nav.js';
import { mediaUrl, prepareImage, uploadImage, deleteImage, FriendlyError } from '../media.js';

let ctx = null; // { b, f, player, team, mine, format }
let flash = ''; // message shown after a save
const MAX_SHOTS = 3;

// Small screenshot previews that open the full picture.
export const shotThumbs = (paths) => (paths ?? []).map((p, i) => {
  const url = mediaUrl(p);
  return `<a href="${esc(url)}" target="_blank" rel="noopener" title="Screenshot ${i + 1}"><img src="${esc(url)}" alt="Screenshot ${i + 1}" loading="lazy"></a>`;
}).join('');

// Everyone sees who has voted what (so teams can sort out a mismatch themselves).
export function votesSummary(b, f) {
  const subs = (b.submissions ?? []).filter((s) => s.fixtureId === f.id);
  if (!subs.length) return '';
  const tally = tallyVotes(subs, f);
  const side = (teamId, votes) => `
    <div class="vote-side">
      <b>${teamDot(b.teamsById[teamId])} ${esc(b.teamsById[teamId]?.name ?? 'TBC')}</b>
      ${votes.length ? votes.map((v) => `<span class="vote${tally.pair && (tally.pair.home.id === v.id || tally.pair.away.id === v.id) ? ' ok' : ''}">${playerLink(b.playersById[v.playerId], v.playerId)} says <b class="num">${esc(voteLabel(v.sets))}</b>
        ${v.screenshotPaths?.length ? `<span class="vote-shots">${shotThumbs(v.screenshotPaths)}</span>` : ''}</span>`).join('')
        : '<span class="muted small">no vote yet</span>'}
    </div>`;
  const status = {
    waiting: 'Waiting for the other team to vote.',
    agreed: 'Both teams agree.',
    disputed: 'The teams’ scores don’t match yet. Check the scores, or an admin will decide.',
  }[tally.status] ?? '';
  return `
    <section class="panel votes ${tally.status}">
      <h2 class="pro-h">Result votes</h2>
      <div class="vote-sides">${side(f.homeTeamId, tally.home)}${side(f.awayTeamId, tally.away)}</div>
      <p class="small vote-status">${status}</p>
    </section>`;
}

// A team's matches that still need a result: [{ b, f, voted }] (voted = this player already voted).
export function matchesToReport(bundles, player) {
  if (!player?.teamId) return [];
  return bundles
    .filter((b) => b.event.status !== 'cancelled')
    .flatMap((b) => b.fixtures
      .filter((f) => (f.homeTeamId === player.teamId || f.awayTeamId === player.teamId) && !b.results[f.id])
      .map((f) => ({ b, f, voted: (b.submissions ?? []).some((s) => s.id === `${f.id}__${player.id}`) })))
    .sort((x, y) => (x.f.scheduledAt ?? Infinity) - (y.f.scheduledAt ?? Infinity) || (x.f.order ?? 0) - (y.f.order ?? 0));
}

// The form, for a signed-in player on one of the two teams. Returns '' for everyone else.
export async function reportBlock(b, f) {
  ctx = null;
  if (b.results[f.id]) return '';
  const user = await currentUser().catch(() => null);
  if (!user) return '';
  const player = Object.values(b.playersById).find((p) => p.uid === user.uid);
  const team = player?.teamId ? b.teamsById[player.teamId] : null;
  if (!player || !isApprovedTeam(team) || (team.id !== f.homeTeamId && team.id !== f.awayTeamId)) return '';

  const format = formatFor(b.season, f);
  const mine = (b.submissions ?? []).find((s) => s.id === `${f.id}__${player.id}`) ?? null;
  ctx = { b, f, player, team, mine, format, user };

  const home = b.teamsById[f.homeTeamId];
  const away = b.teamsById[f.awayTeamId];
  const other = team.id === f.homeTeamId ? away : home;
  const defs = b.season.stats ?? [];
  // Rows: everyone on the team now, plus anyone already in my vote.
  const ids = new Set(Object.values(b.playersById).filter((p) => p.teamId === team.id).map((p) => p.id));
  for (const pid of Object.keys(mine?.playerStats ?? {})) ids.add(pid);
  const rows = [...ids].map((pid) => {
    const line = mine?.playerStats?.[pid];
    const on = mine ? Boolean(line) : true;
    const name = b.playersById[pid]?.displayName ?? pid;
    return `<tr data-pid="${esc(pid)}" class="${on ? '' : 'off'}">
      <td class="first"><label class="played-toggle"><input type="checkbox" data-played ${on ? 'checked' : ''}> ${esc(name)}</label></td>
      ${defs.map((d) => `<td><input type="number" inputmode="numeric" min="0" data-stat="${esc(d.key)}" value="${esc(line?.[d.key] ?? '')}" aria-label="${esc(name)} ${esc(d.name)}"></td>`).join('')}
    </tr>`;
  }).join('');
  const setRows = Array.from({ length: format.bestOf }, (_, i) => {
    const s = mine?.sets?.[i];
    return `<div class="set-row"><span>Set ${i + 1}</span>
      <input type="number" inputmode="numeric" min="0" name="set-${i}-home" value="${esc(s?.home ?? '')}" aria-label="Set ${i + 1} ${esc(home?.name)}">
      <input type="number" inputmode="numeric" min="0" name="set-${i}-away" value="${esc(s?.away ?? '')}" aria-label="Set ${i + 1} ${esc(away?.name)}"></div>`;
  }).join('');

  return `
    <form class="panel report" data-form="vote" novalidate>
      <h2 class="pro-h">${mine ? 'Your vote' : 'Report the result'}</h2>
      ${flash ? `<p class="report-flash">${esc(flash)}</p>` : ''}
      <p class="muted small" style="margin-bottom:12px">Enter the set scores from the end-of-match screen and your team’s stats.
        When a player from <b>${esc(other?.name ?? 'the other team')}</b> enters the same scores, the result goes live.</p>
      <div class="sets-entry">
        <div class="set-row set-head"><span></span><span>${esc(home?.shortName ?? 'Home')}</span><span>${esc(away?.shortName ?? 'Away')}</span></div>
        ${setRows}
      </div>
      <p class="muted small" style="margin:6px 0 14px">Leave unplayed sets empty.</p>
      <h3 style="margin-bottom:6px">${teamDot(team)} ${esc(team.name)} stats</h3>
      <p class="muted small" style="margin-bottom:8px">Untick anyone who didn’t play. Blank boxes count as 0.</p>
      <div class="table-wrap"><table class="data entry">
        <thead><tr><th class="first">Player</th>${defs.map((d) => `<th title="${esc(d.name)}">${esc(d.label)}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="field" style="margin-top:14px">
        <span>Screenshot of the end-of-match screen (recommended, up to ${MAX_SHOTS})</span>
        ${mine?.screenshotPaths?.length ? `<div class="vote-shots">${shotThumbs(mine.screenshotPaths)}</div>` : ''}
        <label class="btn btn-sm" style="justify-self:start">${mine?.screenshotPaths?.length ? 'Replace screenshots…' : 'Add screenshots…'}
          <input type="file" name="shots" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden></label>
        <span class="muted small" data-shots-picked></span>
        <span class="muted small">It’s proof if the teams don’t agree.</span>
      </div>
      <div class="actions" style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn btn-primary" type="submit">${mine ? 'Update my vote' : 'Submit my vote'}</button>
      </div>
      <p class="form-error" role="alert" hidden></p>
    </form>`;
}

function readSets(form) {
  const sets = [];
  for (let i = 0; i < ctx.format.bestOf; i++) {
    const h = form.querySelector(`[name="set-${i}-home"]`).value.trim();
    const a = form.querySelector(`[name="set-${i}-away"]`).value.trim();
    if (h === '' && a === '') continue;
    sets.push({ home: Number(h), away: Number(a) });
  }
  return sets;
}

export function mountReport(root) {
  const form = root.querySelector('form[data-form="vote"]');
  if (!form || !ctx) return;
  flash = '';
  form.addEventListener('change', (e) => {
    if (e.target.matches('[data-played]')) e.target.closest('tr').classList.toggle('off', !e.target.checked);
    if (e.target.matches('[name=shots]')) {
      const n = e.target.files.length;
      form.querySelector('[data-shots-picked]').textContent = n > MAX_SHOTS
        ? `Only the first ${MAX_SHOTS} will be used.` : n ? `${n} picked.` : '';
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { b, f, player, team, mine, format, user } = ctx;
    const error = form.querySelector('.form-error');
    const showError = (msg) => { error.textContent = msg; error.hidden = false; };
    error.hidden = true;

    const sets = readSets(form);
    const check = checkResult(sets, format);
    if (!check.ok) return showError(`Check the scores: ${check.errors[0]}.`);
    const keys = (b.season.stats ?? []).map((d) => d.key);
    const playerStats = {};
    for (const tr of form.querySelectorAll('tbody tr')) {
      if (!tr.querySelector('[data-played]').checked) continue;
      const raw = Object.fromEntries([...tr.querySelectorAll('[data-stat]')].map((i) => [i.dataset.stat, i.value]));
      playerStats[tr.dataset.pid] = { teamId: team.id, ...cleanStatLine(raw, keys) };
    }

    // Does my vote agree with a vote from the other team? Then publish the result in the same save.
    const myVote = { id: `${f.id}__${player.id}`, teamId: team.id, playerId: player.id, sets, playerStats, updatedAt: Date.now() };
    const oppTeam = team.id === f.homeTeamId ? f.awayTeamId : f.homeTeamId;
    const match = (b.submissions ?? [])
      .filter((s) => s.fixtureId === f.id && s.teamId === oppTeam)
      .sort((x, y) => (y.updatedAt ?? 0) - (x.updatedAt ?? 0))
      .find((s) => sameSets(s.sets, sets));
    const pair = match ? (team.id === f.homeTeamId ? { home: myVote, away: match } : { home: match, away: myVote }) : null;
    const agreed = pair ? resultFromVotes(pair, f, format) : null;

    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      // Screenshots: newly picked ones replace the old; otherwise keep what the vote had.
      const files = [...(form.querySelector('[name=shots]')?.files ?? [])].slice(0, MAX_SHOTS);
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
      await submitVote({ uid: user.uid, eventId: b.event.id, fixtureId: f.id, player, sets, playerStats, screenshotPaths, existing: mine, agreed });
      if (files.length) for (const old of mine?.screenshotPaths ?? []) deleteImage(old);
      const others = tallyVotes([...(b.submissions ?? []).filter((s) => s.fixtureId === f.id && s.id !== myVote.id), myVote], f);
      flash = agreed ? '' : others.status === 'disputed'
        ? 'Saved. Your scores don’t match the other team’s vote yet. Double-check them, or an admin will decide.'
        : 'Saved. The result goes live as soon as a player from the other team enters the same scores.';
      refresh();
    } catch (err) {
      console.error(err);
      button.disabled = false;
      button.textContent = mine ? 'Update my vote' : 'Submit my vote';
      showError(err instanceof FriendlyError ? err.message : err.code === 'permission-denied'
        ? 'That couldn’t be saved. The result may already be in, or you’re not on this team any more. Refresh and try again.'
        : 'Something went wrong. Check your connection and try again.');
    }
  });
}

// Admin: teams and players (shared by every event).
// /admin/people[?edit=team:<id>|team:new|player:<id>|player:new]

import { loadPeople, loadAllBundles } from '../../data.js';
import { saveTeam, deleteTeam, savePlayer, deletePlayer, slugId, removeProfileImage, clearProfileText } from '../../admin-data.js';
import { navigate } from '../../nav.js';
import { esc, skeleton, teamDot, urls } from '../../ui.js';
import { mediaUrl, MEDIA, inFirebase, copyOldImage } from '../../media.js';
import { adminGate, adminBar, bindAuthActions } from './gate.js';

export const title = 'Teams & players';

export function loading() {
  return skeleton([50, 300, 300]);
}

let page = null; // { people, used: { teams:Set, players:Set }, user }

const strip = (o) => {
  if (!o) return {};
  const { id, updatedAt, updatedBy, ...rest } = o;
  return rest;
};

const IMAGE_KINDS = { teams: ['logo', 'banner', 'background'], players: ['avatar', 'banner', 'background'] };
// Every picture path in use (teams and players).
const allImagePaths = (people) => [
  ...people.teams.flatMap((t) => IMAGE_KINDS.teams.map((k) => t[`${k}Path`])),
  ...people.players.flatMap((p) => IMAGE_KINDS.players.map((k) => p[`${k}Path`])),
].filter(Boolean);
const hasImages = (owner, d) => IMAGE_KINDS[owner].some((k) => d[`${k}Path`]);
const hasText = (d) => Boolean(d.tagline || d.bio || Object.values(d.socials ?? {}).some(Boolean));

// Uploaded images and profile text, with take-down buttons.
function moderation(owner, d) {
  if (!d || (!hasImages(owner, d) && !hasText(d))) return '';
  const thumbs = IMAGE_KINDS[owner].filter((k) => d[`${k}Path`]).map((k) => `
    <div class="mod-thumb">
      <a href="${esc(mediaUrl(d[`${k}Path`]))}" target="_blank" rel="noopener"><img src="${esc(mediaUrl(d[`${k}Path`]))}" alt="${esc(MEDIA[k].label)}" loading="lazy"></a>
      <button type="button" class="btn btn-sm btn-danger" data-act="remove-image" data-owner="${owner}" data-id="${esc(d.id)}" data-kind="${k}">Remove ${esc(MEDIA[k].label.toLowerCase())}</button>
    </div>`).join('');
  return `
    <div class="mod">
      <span class="field-label">Profile images &amp; text</span>
      ${thumbs ? `<div class="mod-thumbs">${thumbs}</div>` : ''}
      ${hasText(d) ? `<p class="small">${d.tagline ? `<b>${esc(d.tagline)}</b> ` : ''}${esc((d.bio ?? '').slice(0, 160))}${(d.bio ?? '').length > 160 ? '…' : ''}</p>
        <button type="button" class="btn btn-sm btn-danger" data-act="clear-text" data-owner="${owner}" data-id="${esc(d.id)}">Clear tagline, bio &amp; links</button>` : ''}
    </div>`;
}

function teamForm(t) {
  return `
    <form class="inline-form" data-form="team" data-id="${esc(t?.id ?? '')}" novalidate>
      <div class="field-row">
        <label class="field"><span>Team name</span><input type="text" name="name" maxlength="60" value="${esc(t?.name ?? '')}" required></label>
        <label class="field"><span>Short name (3–4 letters)</span><input type="text" name="shortName" maxlength="5" value="${esc(t?.shortName ?? '')}" placeholder="e.g. TAS"></label>
      </div>
      <label class="field"><span>Colour</span><input type="color" name="color" value="${esc(t?.colors?.primary ?? '#19c9b1')}" style="width:80px;min-height:40px;padding:2px"></label>
      <div class="field-row">
        <label class="field"><span>Status</span><select name="status">${[['approved', 'Approved'], ['pending', 'Waiting for approval'], ['rejected', 'Rejected']].map(([v, l]) => `<option value="${v}"${(t?.status ?? 'approved') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span>Manager (squad players with Discord)</span><select name="manager"><option value="">No manager</option>${(t ? page.people.players.filter((p) => p.uid && (p.teamId === t.id || p.id === t.managerPlayerId)) : []).map((p) => `<option value="${esc(p.id)}"${t?.managerPlayerId === p.id ? ' selected' : ''}>${esc(p.displayName)}</option>`).join('')}</select></label>
      </div>
      ${moderation('teams', t)}
      <div class="actions">
        <button type="submit" class="btn btn-primary btn-sm">${t ? 'Save team' : 'Add team'}</button>
        ${t && !page.used.teams.has(t.id) ? '<button type="button" class="btn btn-sm btn-danger" data-act="delete-team">Delete team</button>' : ''}
        <a class="link-btn" href="/admin/people" data-link data-keep-scroll>Cancel</a>
      </div>
      ${t && page.used.teams.has(t.id) ? '<p class="muted small">This team has played, so it can’t be deleted (its results would lose their name).</p>' : ''}
      <p class="form-error" role="alert" hidden></p>
    </form>`;
}

function playerForm(p) {
  return `
    <form class="inline-form" data-form="player" data-id="${esc(p?.id ?? '')}" novalidate>
      <div class="field-row">
        <label class="field"><span>Player name (as in game)</span><input type="text" name="displayName" maxlength="60" value="${esc(p?.displayName ?? '')}" required></label>
        <label class="field"><span>Jersey number (optional)</span><input type="number" name="number" min="0" max="99" inputmode="numeric" value="${esc(p?.number ?? '')}"></label>
      </div>
      <label class="field"><span>Team</span><select name="teamId"><option value="">Free agent</option>${page.people.teams.filter((t) => (t.status ?? 'approved') === 'approved').sort((a, b) => a.name.localeCompare(b.name)).map((t) => `<option value="${esc(t.id)}"${p?.teamId === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="active" ${p?.active === false ? '' : 'checked'}> Active</label>
      ${p?.uid ? `<label class="check"><input type="checkbox" name="unlink"> Unlink Discord account ${esc(p.discordName ?? '')} (ID ${esc(p.discordId ?? '')})</label>` : ''}
      ${moderation('players', p)}
      <div class="actions">
        <button type="submit" class="btn btn-primary btn-sm">${p ? 'Save player' : 'Add player'}</button>
        ${p && !page.used.players.has(p.id) ? '<button type="button" class="btn btn-sm btn-danger" data-act="delete-player">Delete player</button>' : ''}
        <a class="link-btn" href="/admin/people" data-link data-keep-scroll>Cancel</a>
      </div>
      ${p && page.used.players.has(p.id) ? '<p class="muted small">This player has stats, so they can’t be deleted. Untick “Active” instead.</p>' : ''}
      <p class="form-error" role="alert" hidden></p>
    </form>`;
}

export async function render() {
  const gate = await adminGate();
  if (gate.html) return { title: 'Admin sign-in', html: `<div class="admin-root">${gate.html}</div>` };

  const [people, bundles] = await Promise.all([loadPeople({ fresh: true, admin: true }), loadAllBundles({ includeDrafts: true })]);
  // Teams/players that appear in any result or fixture can't be deleted.
  const used = { teams: new Set(), players: new Set() };
  for (const b of bundles) {
    for (const f of b.fixtures) { used.teams.add(f.homeTeamId); used.teams.add(f.awayTeamId); }
    for (const r of Object.values(b.results)) for (const pid of Object.keys(r.playerStats ?? {})) used.players.add(pid);
  }
  page = { people, used, user: gate.user };

  const edit = new URLSearchParams(location.search).get('edit') ?? '';
  const [kind, id] = edit.split(':');
  const teams = [...people.teams].sort((a, b) => a.name.localeCompare(b.name));
  const players = [...people.players].sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Newest custom profiles first, so admins can glance over what's been uploaded lately.
  const custom = [
    ...people.teams.filter((t) => hasImages('teams', t) || hasText(t)).map((d) => ({ owner: 'teams', d, name: d.name })),
    ...people.players.filter((p) => hasImages('players', p) || hasText(p)).map((d) => ({ owner: 'players', d, name: d.displayName })),
  ].sort((a, b) => (b.d.updatedAt ?? 0) - (a.d.updatedAt ?? 0)).slice(0, 12);
  const recentBlock = custom.length ? `
    <section style="margin-bottom:20px">
      <div class="section-head"><h2>Recently customised profiles</h2><span class="muted small">Newest first</span></div>
      <div class="panel flush rows">${custom.map(({ owner, d, name }) => `
        <div class="row">
          <span class="row-main"><b><a class="plink" href="${owner === 'teams' ? urls.team(d.id) : urls.player(d.id)}" data-link>${esc(name)}</a></b>
            <span class="muted small">${owner === 'teams' ? 'Team' : 'Player'}${d.tagline ? ` · ${esc(d.tagline)}` : ''}</span></span>
          <span class="row-side mod-mini">${IMAGE_KINDS[owner].filter((k) => d[`${k}Path`]).map((k) => `<img src="${esc(mediaUrl(d[`${k}Path`]))}" alt="${esc(MEDIA[k].label)}" title="${esc(MEDIA[k].label)}" loading="lazy">`).join('')}
            <a class="btn btn-sm" href="/admin/people?edit=${owner === 'teams' ? 'team' : 'player'}:${encodeURIComponent(d.id)}" data-link data-keep-scroll>Review</a></span>
        </div>`).join('')}
      </div>
    </section>` : '';

  const teamRows = teams.map((t) => `
    <a class="row" href="/admin/people?edit=team:${encodeURIComponent(t.id)}" data-link data-keep-scroll>
      <span class="row-main"><b><span class="team">${teamDot(t)}${esc(t.name)}</span></b></span>
      <span class="row-side">${t.status === 'pending' ? '<span class="tag tag-draft">Waiting</span>' : t.status === 'rejected' ? '<span class="tag tag-cancelled">Rejected</span>' : ''}<span class="muted small">${esc(t.shortName ?? '')} · ${people.players.filter((p) => p.teamId === t.id).length} players</span></span>
    </a>
    ${kind === 'team' && id === t.id ? teamForm(t) : ''}`).join('');

  const playerRows = players.map((p) => `
    <a class="row" href="/admin/people?edit=player:${encodeURIComponent(p.id)}" data-link data-keep-scroll>
      <span class="row-main"><b>${esc(p.displayName)}</b></span>
      <span class="row-side">${p.number != null ? `<span class="muted small">#${esc(p.number)}</span>` : ''}${p.active === false ? '<span class="tag">Inactive</span>' : ''}</span>
    </a>
    ${kind === 'player' && id === p.id ? playerForm(p) : ''}`).join('');

  return {
    title: 'Teams & players',
    html: `
      <div class="admin-root">
        ${adminBar(gate.user, gate.admin, '/admin/people')}
        <div class="page-head"><div><h1>Teams &amp; players</h1><p class="muted">Shared by every event, so player stats add up across all of them.</p></div></div>
        <section class="panel" style="margin-bottom:20px" data-migrate>
          <h3>Move older pictures to Firebase</h3>
          <p class="muted small" style="margin:4px 0 10px">Pictures uploaded before 22 Oct were kept on Cloudflare. They still show, but press this once to copy them into Firebase Storage. It skips anything already moved, so pressing it twice is fine.</p>
          <button type="button" class="btn btn-primary btn-sm" data-act="migrate-images">Move images (${allImagePaths(people).length})</button>
          <p class="small migrate-status" aria-live="polite" style="margin-top:8px"></p>
        </section>
        ${recentBlock}
        <div class="cols">
          <section>
            <div class="section-head"><h2>Teams</h2><a href="/admin/people?edit=team:new" data-link data-keep-scroll>+ Add team</a></div>
            <div class="panel flush rows">
              ${kind === 'team' && id === 'new' ? teamForm(null) : ''}
              ${teamRows || '<p class="muted" style="padding:16px">No teams yet.</p>'}
            </div>
          </section>
          <section>
            <div class="section-head"><h2>Players</h2><a href="/admin/people?edit=player:new" data-link data-keep-scroll>+ Add player</a></div>
            <div class="panel flush rows">
              ${kind === 'player' && id === 'new' ? playerForm(null) : ''}
              ${playerRows || '<p class="muted" style="padding:16px">No players yet.</p>'}
            </div>
          </section>
        </div>
      </div>`,
  };
}

function showError(form, message) {
  const el = form.querySelector('.form-error');
  el.textContent = message;
  el.hidden = false;
}

export function mount(el) {
  const root = el.querySelector('.admin-root');
  if (!root) return;
  bindAuthActions(root);
  const uid = page?.user?.uid;
  if (!uid) return;
  const done = () => navigate('/admin/people', { replace: true, keepScroll: true });
  const fail = (form, err) => {
    console.error(err);
    showError(form, err.code === 'permission-denied' ? 'Not allowed. Are you still on the admin list?' : 'Couldn’t save. Check your connection and try again.');
  };

  root.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!['team', 'player'].includes(form.dataset.form)) return;
    e.preventDefault();
    const val = (n) => form.querySelector(`[name=${n}]`).value.trim();
    const button = form.querySelector('[type=submit]');

    if (form.dataset.form === 'team') {
      const name = val('name');
      if (!name) return showError(form, 'Give the team a name.');
      const existing = page.people.teams.find((t) => t.id === form.dataset.id) ?? null;
      const id = existing?.id ?? slugId(name, new Set(page.people.teams.map((t) => t.id)));
      const shortName = (val('shortName') || name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3)).toUpperCase();
      button.disabled = true;
      try {
        const manager = page.people.players.find((p) => p.id === form.querySelector('[name=manager]').value) ?? null;
        const status = form.querySelector('[name=status]').value;
        // An approved team's manager is always on its squad (if they're a free agent).
        const joinPlayer = status === 'approved' && manager && !manager.teamId ? manager : null;
        await saveTeam({
          id, uid, existing, joinPlayer,
          team: {
            ...strip(existing), name, shortName, colors: { primary: val('color') },
            status: form.querySelector('[name=status]').value,
            managerPlayerId: manager?.id ?? null,
            managerUid: manager?.uid ?? null,
          },
        });
        done();
      } catch (err) {
        button.disabled = false;
        fail(form, err);
      }
    }

    if (form.dataset.form === 'player') {
      const displayName = val('displayName');
      if (!displayName) return showError(form, 'Give the player a name.');
      const existing = page.people.players.find((p) => p.id === form.dataset.id) ?? null;
      const id = existing?.id ?? slugId(displayName, new Set(page.people.players.map((p) => p.id)));
      const number = val('number') === '' ? null : Number(val('number'));
      button.disabled = true;
      try {
        const unlink = form.querySelector('[name=unlink]')?.checked;
        await savePlayer({
          id, uid, existing,
          player: {
            ...strip(existing), displayName, number,
            active: form.querySelector('[name=active]').checked,
            teamId: form.querySelector('[name=teamId]').value || null,
            ...(unlink ? { uid: null, discordId: null, discordName: null } : {}),
          },
        });
        done();
      } catch (err) {
        button.disabled = false;
        fail(form, err);
      }
    }
  });

  root.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-act]');
    if (!button) return;
    const form = button.closest('form');
    if (button.dataset.act === 'migrate-images') {
      const status = root.querySelector('.migrate-status');
      const paths = allImagePaths(page.people);
      const counts = { copied: 0, already: 0, missing: 0, failed: 0 };
      button.disabled = true;
      for (const [i, path] of paths.entries()) {
        status.textContent = `Checking ${i + 1} of ${paths.length}…`;
        try {
          if (await inFirebase(path)) counts.already += 1;
          else counts[await copyOldImage(path)] += 1;
        } catch (err) {
          console.error(path, err);
          counts.failed += 1;
        }
      }
      status.textContent = `Done: ${counts.copied} moved, ${counts.already} already in Firebase${counts.missing ? `, ${counts.missing} not found anywhere` : ''}${counts.failed ? `, ${counts.failed} failed (press again to retry)` : ''}.`;
      button.disabled = false;
      return;
    }
    try {
      if (button.dataset.act === 'remove-image' || button.dataset.act === 'clear-text') {
        const { owner, id, kind } = button.dataset;
        const doc = (owner === 'teams' ? page.people.teamsById : page.people.playersById)[id];
        const what = button.dataset.act === 'clear-text' ? 'their tagline, bio and links' : `the ${MEDIA[kind].label.toLowerCase()}`;
        if (!window.confirm(`Remove ${what} from ${doc.name ?? doc.displayName}? This can’t be undone.`)) return;
        button.disabled = true;
        if (button.dataset.act === 'clear-text') await clearProfileText({ uid, owner, doc });
        else await removeProfileImage({ uid, owner, doc, kind });
        done();
      }
      if (button.dataset.act === 'delete-team') {
        const existing = page.people.teams.find((t) => t.id === form.dataset.id);
        if (!window.confirm(`Delete ${existing.name}?`)) return;
        await deleteTeam({ id: existing.id, uid, existing });
        done();
      }
      if (button.dataset.act === 'delete-player') {
        const existing = page.people.players.find((p) => p.id === form.dataset.id);
        if (!window.confirm(`Delete ${existing.displayName}?`)) return;
        await deletePlayer({ id: existing.id, uid, existing });
        done();
      }
    } catch (err) {
      fail(form, err);
    }
  });
}

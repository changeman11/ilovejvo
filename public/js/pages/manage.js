// Manager's page: tidy up the team, send offers to free agents, release players.
// Only the manager of an approved team can use it (the security rules enforce the same).

import { currentUser } from '../auth.js';
import { loadMe, isApprovedTeam } from '../data.js';
import { updateTeam, sendOffer, withdrawOffer, releasePlayer } from '../player-data.js';
import { refresh } from '../nav.js';
import { esc, skeleton, notice, teamDot, playerLink } from '../ui.js';

export const title = 'Manage team';

export function loading() {
  return skeleton([100, 240, 240]);
}

let page = null; // { user, me, team }

export async function render() {
  const user = await currentUser();
  if (!user) return notice('Sign in first', ' Managers sign in with Discord on the Me page.');
  const me = await loadMe(user.uid);
  const team = me.team;
  if (!isApprovedTeam(team) || team.managerUid !== user.uid) {
    return `${notice('Managers only', ' This page is for the manager of an approved team.')}<p style="text-align:center;margin-top:16px"><a class="btn" href="/me" data-link>Back to Me</a></p>`;
  }
  page = { user, me, team };

  const squad = me.players.filter((p) => p.teamId === team.id).sort((a, b) => a.displayName.localeCompare(b.displayName));
  const pendingOffers = me.sentOffers.filter((o) => o.status === 'pending' && o.teamId === team.id);
  const offered = new Set(pendingOffers.map((o) => o.playerId));
  // Free agents who have a Discord account (so they can accept) and aren't already offered.
  const freeAgents = me.players
    .filter((p) => p.uid && !p.teamId && p.active !== false && !offered.has(p.id))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const recent = me.sentOffers.filter((o) => o.status !== 'pending' && o.teamId === team.id).slice(-5).reverse();

  const squadRows = squad.map((p) => `
    <div class="row">
      <span class="row-main"><b>${playerLink(p)}${p.id === team.managerPlayerId ? '<span class="badge">MGR</span>' : ''}</b>${p.number != null ? `<span class="muted small">#${esc(p.number)}</span>` : ''}</span>
      <span class="row-side">${p.uid === user.uid ? '' : `<button class="btn btn-sm btn-danger" data-act="release" data-id="${esc(p.id)}">Release</button>`}</span>
    </div>`).join('');

  return {
    title: `Manage ${team.name}`,
    html: `
      <div class="manage-root stack">
        <a class="back" href="/me" data-link>← Me</a>
        <div class="page-head"><div><h1><span class="team">${teamDot(team, 'lg')}${esc(team.name)}</span></h1><p class="muted">You’re the manager.</p></div></div>
        <div class="cols">
          <div class="stack">
            <section>
              <div class="section-head"><h2>Squad</h2><span class="muted small">${squad.length} player${squad.length === 1 ? '' : 's'}</span></div>
              <div class="panel flush rows">${squadRows || '<p class="muted" style="padding:16px">No players yet.</p>'}</div>
              <p class="muted small" style="margin-top:6px">Released players become free agents straight away.</p>
            </section>
            <section>
              <div class="section-head"><h2>Offers sent</h2></div>
              <div class="panel flush rows">
                ${pendingOffers.map((o) => `<div class="row"><span class="row-main"><b>${esc(me.playersById[o.playerId]?.displayName ?? o.playerId)}</b><span class="muted small">Waiting for them to answer</span></span>
                  <span class="row-side"><button class="btn btn-sm" data-act="withdraw" data-id="${esc(o.id)}">Withdraw</button></span></div>`).join('')}
                ${recent.map((o) => `<div class="row"><span class="row-main"><b>${esc(me.playersById[o.playerId]?.displayName ?? o.playerId)}</b><span class="muted small">${esc(o.status)}</span></span></div>`).join('')}
                ${!pendingOffers.length && !recent.length ? '<p class="muted" style="padding:16px">No offers yet.</p>' : ''}
              </div>
            </section>
          </div>
          <div class="stack">
            <section>
              <div class="section-head"><h2>Sign a player</h2></div>
              <div class="panel">
                <p class="muted small" style="margin-bottom:10px">Free agents with a Discord sign-in. They’ll see your offer on their Me page.</p>
                <label class="field"><span>Search</span><input type="text" data-filter placeholder="Player name"></label>
                <div class="rows" data-agents>
                  ${freeAgents.map((p) => `<div class="row" data-name="${esc(p.displayName.toLowerCase())}"><span class="row-main"><b>${playerLink(p)}</b></span><span class="row-side"><button class="btn btn-sm btn-primary" data-act="offer" data-id="${esc(p.id)}">Offer</button></span></div>`).join('') || '<p class="muted">No free agents right now.</p>'}
                </div>
              </div>
            </section>
            <section>
              <div class="section-head"><h2>Team details</h2></div>
              <form class="panel" data-form="team" novalidate>
                <div class="field-row">
                  <label class="field"><span>Name</span><input type="text" name="name" maxlength="60" value="${esc(team.name)}"></label>
                  <label class="field"><span>Short name</span><input type="text" name="shortName" maxlength="5" value="${esc(team.shortName ?? '')}"></label>
                </div>
                <label class="field"><span>Colour</span><input type="color" name="color" value="${esc(team.colors?.primary ?? '#19c9b1')}" style="width:80px;min-height:40px;padding:2px"></label>
                <button class="btn btn-primary" type="submit">Save</button>
                <p class="form-error" role="alert" hidden></p>
              </form>
            </section>
          </div>
        </div>
        <p class="form-error" role="alert" hidden data-global></p>
      </div>`,
  };
}

export function mount(el) {
  const root = el.querySelector('.manage-root');
  if (!root || !page) return;
  const { user, me, team } = page;
  const showError = (msg) => {
    const box = root.querySelector('[data-global]');
    box.textContent = msg;
    box.hidden = false;
    box.scrollIntoView({ block: 'center' });
  };
  const fail = (err) => {
    console.error(err);
    showError(err.code === 'permission-denied' ? 'That isn’t allowed (maybe they’ve already joined a team). Refresh and try again.' : 'Something went wrong. Check your connection and try again.');
  };

  root.addEventListener('input', (e) => {
    if (!e.target.matches('[data-filter]')) return;
    const q = e.target.value.trim().toLowerCase();
    root.querySelectorAll('[data-agents] .row').forEach((r) => { r.hidden = q && !r.dataset.name.includes(q); });
  });

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    try {
      if (b.dataset.act === 'offer') {
        b.disabled = true;
        await sendOffer({ uid: user.uid, team, player: me.playersById[id] });
        refresh();
      }
      if (b.dataset.act === 'withdraw') {
        b.disabled = true;
        await withdrawOffer({ uid: user.uid, offer: me.sentOffers.find((o) => o.id === id) });
        refresh();
      }
      if (b.dataset.act === 'release') {
        const p = me.playersById[id];
        if (!window.confirm(`Release ${p.displayName}? They become a free agent straight away.`)) return;
        b.disabled = true;
        await releasePlayer({ uid: user.uid, player: p });
        refresh();
      }
    } catch (err) {
      b.disabled = false;
      fail(err);
    }
  });

  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const val = (n) => form.querySelector(`[name=${n}]`).value.trim();
    if (!val('name')) return showError('The team needs a name.');
    form.querySelector('[type=submit]').disabled = true;
    try {
      await updateTeam({ uid: user.uid, team, changes: { name: val('name'), shortName: (val('shortName') || val('name').slice(0, 3)).toUpperCase(), colors: { primary: val('color') } } });
      refresh();
    } catch (err) {
      form.querySelector('[type=submit]').disabled = false;
      fail(err);
    }
  });
}

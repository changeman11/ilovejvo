// "Me": a player's own page. Sign in with Discord, create or claim a profile, edit it,
// answer signing offers, register a team, or ask to leave a team.

import {
  currentUser, currentAdmin, discordOf, discordReady, startDiscordSignIn, devSignIn, devSignInAvailable, DEV_USERS,
  signOut, lastDiscordProfile,
} from '../auth.js';
import { loadMe, isApprovedTeam, loadAllBundles } from '../data.js';
import { matchesToReport } from './report.js';
import { fixtureRow } from './parts.js';
import {
  createProfile, updateProfile, requestClaim, cancelClaim, registerTeam, updateTeam, answerOffer, requestLeave, cancelLeave,
} from '../player-data.js';
import { MEDIA, prepareImage, uploadImage, FriendlyError } from '../media.js';
import { uploadsReady } from '../config.js';
import { DEFAULT_STATS } from '../rules/defaults.js';
import { customiseFields, saveCustomise, bindImagePreviews } from './customise.js';
import { makeProfileCard } from './discord-cta.js';
import { refresh, navigate } from '../nav.js';
import { esc, skeleton, notice, teamDot, teamLink, avatarImg, urls } from '../ui.js';

export const title = 'Me';

export function loading() {
  return skeleton([140, 220]);
}

let page = null; // { user, discord, me }

function signInPanel() {
  const dev = devSignInAvailable ? `
    <div class="panel" style="margin-top:16px">
      <h3>Test players (this computer only)</h3>
      <p class="muted small" style="margin:4px 0 10px">Pretend Discord accounts for trying things out. They don’t exist on the live site.</p>
      <div class="event-links">${DEV_USERS.map((u) => `<button class="btn btn-sm" data-act="dev-signin" data-id="${u.discordId}">${esc(u.name)} <span class="muted">· ${esc(u.note)}</span></button>`).join('')}</div>
    </div>` : '';
  return `
    ${makeProfileCard({ footer: '<p class="form-error" role="alert" hidden></p><p class="dc-note">League admin? <a href="/admin" data-link>Admin sign-in</a></p>' })}
    ${dev}`;
}

function profileHead(me, discord) {
  const p = me.player;
  const avatar = avatarImg(p);
  const team = isApprovedTeam(me.team) ? teamLink(me.team) : 'Free agent';
  return `
    <section class="panel profile">
      ${avatar}
      <div style="flex:1;min-width:0">
        <h1>${esc(p.displayName)}</h1>
        <p class="muted">${team}${p.number != null ? ` · #${esc(p.number)}` : ''}</p>
        <p class="small" style="margin-top:6px"><a href="${urls.player(p.id)}" data-link>View public profile</a> · <button class="link-btn" data-act="sign-out">Sign out</button></p>
      </div>
    </section>
    <p class="muted small">Signed in with Discord as ${esc(discord.discordName ?? discord.discordId)}.</p>`;
}

function editProfileForm(p, team) {
  return `
    <section>
      <div class="section-head"><h2>Customise your profile</h2><a href="${urls.player(p.id)}" data-link>View it</a></div>
      <form class="panel" data-form="profile" novalidate>
        <div class="field-row">
          <label class="field"><span>Player name (as in game)</span><input type="text" name="displayName" maxlength="60" value="${esc(p.displayName)}"></label>
          <label class="field"><span>Jersey number</span><input type="number" name="number" min="0" max="99" inputmode="numeric" value="${esc(p.number ?? '')}"></label>
        </div>
        ${customiseFields('player', p, DEFAULT_STATS, team?.theme ?? team?.colors?.primary)}
        <div class="save-bar">
          <button class="btn btn-primary" type="submit">Save profile</button>
          <p class="form-error" role="alert" hidden style="margin:0"></p>
        </div>
      </form>
    </section>`;
}

function offersBlock(me) {
  const pending = me.offers.filter((o) => o.status === 'pending');
  if (!pending.length) return '';
  return `
    <section>
      <div class="section-head"><h2>Signing offers</h2></div>
      <div class="panel flush rows">${pending.map((o) => {
        const t = me.teamsById[o.teamId];
        return `<div class="row">
          <span class="row-main"><b><span class="team">${teamDot(t)}${esc(t?.name ?? o.teamId)}</span></b><span class="muted small">wants to sign you</span></span>
          <span class="row-side">
            <button class="btn btn-sm btn-primary" data-act="accept-offer" data-id="${esc(o.id)}">Accept</button>
            <button class="btn btn-sm" data-act="decline-offer" data-id="${esc(o.id)}">Decline</button>
          </span>
        </div>`;
      }).join('')}</div>
      <p class="form-error" role="alert" hidden></p>
    </section>`;
}

function registerTeamBlock(me) {
  if (me.pendingTeam) {
    // While waiting, the person who registered it can build the team's page.
    const t = me.pendingTeam;
    return `<section><div class="section-head"><h2>Your team registration</h2></div>
      ${notice(`${t.name} is waiting for approval`, ' An admin will look at it soon. You become its manager once it’s approved. Meanwhile you can set up its page below.')}</section>
      <section>
        <div class="section-head"><h2>${esc(t.name)} team page</h2></div>
        <form class="panel" data-form="pending-team" novalidate>
          ${customiseFields('team', t, DEFAULT_STATS, t.colors?.primary)}
          <div class="save-bar">
            <button class="btn btn-primary" type="submit">Save team page</button>
            <p class="form-error" role="alert" hidden style="margin:0"></p>
          </div>
        </form>
      </section>`;
  }
  return `
    <section>
      <div class="section-head"><h2>Register a team</h2></div>
      <form class="panel" data-form="team" novalidate>
        <p class="muted small" style="margin-bottom:10px">You’ll be the manager. An admin approves new teams before they appear.</p>
        <div class="field-row">
          <label class="field"><span>Team name</span><input type="text" name="name" maxlength="60"></label>
          <label class="field"><span>Short name</span><input type="text" name="shortName" maxlength="5" placeholder="e.g. TAS"></label>
        </div>
        <label class="field"><span>Team colour (the dot next to its name)</span><input type="color" name="color" value="#19c9b1" class="color-input"></label>
        <details class="team-extras" open>
          <summary>Make your team page (optional)</summary>
          <p class="muted small" style="margin:6px 0 4px">Logo, banner, page background (GIFs welcome), bio, links and more. You can change all of it later.</p>
          ${customiseFields('team', {}, DEFAULT_STATS, '#19c9b1')}
        </details>
        <div class="save-bar">
          <button class="btn btn-primary" type="submit">Send for approval</button>
          <p class="form-error" role="alert" hidden style="margin:0"></p>
        </div>
      </form>
    </section>`;
}

function teamBlock(me) {
  const t = me.team;
  const isManager = t.managerUid === page.user.uid;
  const pendingLeave = me.leaves.find((l) => l.status === 'pending' && l.teamId === t.id);
  const lastLeave = [...me.leaves].filter((l) => l.teamId === t.id && l.status === 'declined').pop();
  return `
    <section>
      <div class="section-head"><h2>Your team</h2></div>
      <div class="panel">
        <h3>${teamLink(t, { size: 'lg' })}</h3>
        <p class="muted small" style="margin:4px 0 12px">${isManager ? 'You’re the manager.' : 'You’re in the squad.'}</p>
        ${isManager ? `<div class="event-links">
          <a class="btn btn-primary" href="/manage#team-profile" data-link>Customise team page</a>
          <a class="btn" href="/manage" data-link>Manage squad &amp; offers</a>
        </div>` : ''}
      </div>
    </section>
    <section>
      <div class="section-head"><h2>Leaving the team</h2></div>
      ${pendingLeave
        ? `<div class="panel"><p><b>You’ve asked to leave.</b> An admin will decide soon.</p>
            <button class="btn btn-sm" data-act="cancel-leave" data-id="${esc(pendingLeave.id)}" style="margin-top:10px">Cancel request</button>
            <p class="form-error" role="alert" hidden></p></div>`
        : `<form class="panel" data-form="leave" novalidate>
            ${lastLeave ? '<p class="small" style="margin-bottom:8px">Your last leave request was declined.</p>' : ''}
            <label class="field"><span>Reason (optional, admins see it)</span><textarea name="reason" rows="2" maxlength="500"></textarea></label>
            <button class="btn" type="submit">Ask to leave ${esc(t.name)}</button>
            <p class="form-error" role="alert" hidden></p>
          </form>`}
    </section>`;
}

function noProfileBlock(me, discord) {
  const fromDiscord = lastDiscordProfile();
  if (me.claim?.status === 'pending') {
    const p = me.playersById[me.claim.playerId];
    return `
      <section class="panel">
        <h1>Almost there</h1>
        <p style="margin:8px 0 12px">You asked to claim <b>${esc(p?.displayName ?? me.claim.playerId)}</b>. An admin will confirm it’s you.</p>
        <button class="btn btn-sm" data-act="cancel-claim">Cancel request</button>
        <button class="link-btn" data-act="sign-out">Sign out</button>
        <p class="form-error" role="alert" hidden></p>
      </section>`;
  }
  const unclaimed = me.players.filter((p) => !p.uid && p.active !== false).sort((a, b) => a.displayName.localeCompare(b.displayName));
  return `
    <section class="panel">
      <h1>Welcome, ${esc(discord.discordName ?? 'player')}</h1>
      <p class="muted" style="margin-top:6px">Set up your player profile. <button class="link-btn" data-act="sign-out">Sign out</button></p>
      ${me.claim?.status === 'declined' ? '<p class="small" style="margin-top:8px">Your last claim was declined. You can make a new profile instead.</p>' : ''}
    </section>
    <div class="cols">
      <form class="panel" data-form="create" novalidate>
        <h3>New to I&lt;3JVO?</h3>
        <p class="muted small" style="margin:4px 0 12px">Make a fresh profile. You’ll start as a free agent.</p>
        <label class="field"><span>Player name (as in game)</span><input type="text" name="displayName" maxlength="60" value="${esc(fromDiscord?.name ?? discord.discordName ?? '')}"></label>
        <label class="field"><span>Jersey number (optional)</span><input type="number" name="number" min="0" max="99" inputmode="numeric"></label>
        <button class="btn btn-primary" type="submit">Create my profile</button>
        <p class="form-error" role="alert" hidden></p>
      </form>
      ${unclaimed.length ? `
      <form class="panel" data-form="claim" novalidate>
        <h3>Already played with us?</h3>
        <p class="muted small" style="margin:4px 0 12px">Claim the profile that has your stats. An admin will confirm it’s you.</p>
        <label class="field"><span>That’s me</span><select name="playerId"><option value="">Choose your player…</option>${unclaimed.map((p) => `<option value="${esc(p.id)}">${esc(p.displayName)}</option>`).join('')}</select></label>
        <button class="btn" type="submit">Ask to claim</button>
        <p class="form-error" role="alert" hidden></p>
      </form>` : ''}
    </div>`;
}

// Shown on the Me page while the admin sign-in is also active.
const adminShortcut = (admin) => (admin ? `
  <a class="panel admin-shortcut" href="/admin" data-link>
    <b>Admin area</b><span class="muted small">Signed in as ${esc(admin.name ?? 'admin')} · open →</span>
  </a>` : '');

export async function render() {
  let user = await currentUser();
  // Before admins had their own sign-in, a password login lived here. Clear it out.
  if (user && !(await discordOf(user))) {
    await signOut();
    user = null;
  }
  const { admin } = await currentAdmin().catch(() => ({ admin: null }));
  if (!user) return { title: 'Sign in', html: `<div class="me-root stack">${adminShortcut(admin)}${signInPanel()}</div>` };

  const discord = await discordOf(user);
  const me = await loadMe(user.uid);
  page = { user, discord, me };

  let body;
  if (!me.player) {
    body = noProfileBlock(me, discord);
  } else {
    const onTeam = isApprovedTeam(me.team);
    // Your team's matches without a result: report them (vote) from here.
    const toReport = onTeam ? matchesToReport(await loadAllBundles().catch(() => []), me.player).slice(0, 6) : [];
    const reportBlock = toReport.length ? `
      <section>
        <div class="section-head"><h2>Report your results</h2><span class="muted small">Tap a match to vote</span></div>
        <div class="panel flush fixtures">${toReport.map(({ b, f, voted }) => fixtureRow(b, f, { showEvent: true }).replace('<div class="mid">', `<div class="mid">${voted ? '<span class="tag tag-live">voted</span>' : '<span class="tag tag-draft">vote</span>'}`)).join('')}</div>
      </section>` : '';
    body = `
      ${profileHead(me, discord)}
      <div class="cols">
        <div class="stack">
          ${onTeam ? `${reportBlock}${teamBlock(me)}` : `${offersBlock(me)}${registerTeamBlock(me)}`}
        </div>
        <div class="stack">${editProfileForm(me.player, onTeam ? me.team : null)}</div>
      </div>`;
  }
  return { title: me.player?.displayName ?? 'Me', html: `<div class="me-root stack">${adminShortcut(admin)}${body}</div>` };
}

function showError(el, message) {
  const box = el.querySelector('.form-error') ?? el.closest('section, form, .panel')?.querySelector('.form-error');
  if (box) {
    box.textContent = message;
    box.hidden = false;
  }
}

const fail = (err) => {
  console.error(err);
  if (err instanceof FriendlyError) return err.message;
  return err.code === 'permission-denied'
    ? 'That isn’t allowed right now. Refresh the page and try again.'
    : err.message?.startsWith('Discord') || err.message?.startsWith('Your browser') ? err.message : 'Something went wrong. Check your connection and try again.';
};

export function mount(el) {
  const root = el.querySelector('.me-root');
  if (!root) return;
  bindImagePreviews(root);

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const { user, me } = page ?? {};
    b.disabled = true;
    try {
      if (act === 'discord-signin') startDiscordSignIn('/me');
      if (act === 'dev-signin') { await devSignIn(b.dataset.id); refresh(); }
      if (act === 'sign-out') { await signOut(); navigate('/me', { replace: true }); }
      if (act === 'cancel-claim') { await cancelClaim({ uid: user.uid, claim: me.claim }); refresh(); }
      if (act === 'accept-offer' || act === 'decline-offer') {
        const offer = me.offers.find((o) => o.id === b.dataset.id);
        await answerOffer({ uid: user.uid, offer, player: me.player, accept: act === 'accept-offer' });
        refresh();
      }
      if (act === 'cancel-leave') {
        await cancelLeave({ uid: user.uid, request: me.leaves.find((l) => l.id === b.dataset.id) });
        refresh();
      }
    } catch (err) {
      b.disabled = false;
      showError(b.closest('section, form, .panel') ?? root, fail(err));
    }
  });

  root.addEventListener('submit', async (e) => {
    const form = e.target;
    e.preventDefault();
    const { user, discord, me } = page;
    const val = (n) => form.querySelector(`[name=${n}]`)?.value.trim() ?? '';
    const button = form.querySelector('[type=submit]');
    const numberOrNull = (v) => (v === '' ? null : Math.max(0, Math.min(99, Math.floor(Number(v)))));
    try {
      if (form.dataset.form === 'create') {
        if (!val('displayName')) return showError(form, 'Enter your player name.');
        button.disabled = true;
        const fromDiscord = lastDiscordProfile();
        await createProfile({
          uid: user.uid, discordId: discord.discordId, discordName: discord.discordName,
          avatarUrl: fromDiscord?.avatarUrl ?? null, displayName: val('displayName'), number: numberOrNull(val('number')),
        });
        refresh();
      }
      if (form.dataset.form === 'claim') {
        if (!val('playerId')) return showError(form, 'Pick your player.');
        button.disabled = true;
        await requestClaim({
          uid: user.uid, discordId: discord.discordId, discordName: discord.discordName,
          avatarUrl: lastDiscordProfile()?.avatarUrl ?? null, playerId: val('playerId'), existing: me.claim,
        });
        refresh();
      }
      if (form.dataset.form === 'profile') {
        if (!val('displayName')) return showError(form, 'Enter your player name.');
        button.disabled = true;
        button.textContent = 'Saving…';
        await saveCustomise({
          form, kind: 'player', owner: 'players', id: me.player.id, doc: me.player,
          extra: { displayName: val('displayName'), number: numberOrNull(val('number')) },
          save: (changes) => updateProfile({ uid: user.uid, player: me.player, changes }),
        });
        refresh();
      }
      if (form.dataset.form === 'team') {
        const name = val('name');
        if (!name) return showError(form, 'Give your team a name.');
        if (me.teams.some((t) => t.name.toLowerCase() === name.toLowerCase())) return showError(form, 'That team name is taken.');
        // Check chosen pictures first, so a bad file is caught before the team is registered.
        for (const input of form.querySelectorAll('input[type=file][name^="file-"]')) {
          if (input.files?.[0]) await prepareImage(input.files[0], input.name.slice(5));
        }
        button.disabled = true;
        button.textContent = 'Sending…';
        const color = form.querySelector('[name=color]').value;
        const teamId = await registerTeam({
          uid: user.uid, player: me.player, name,
          shortName: (val('shortName') || name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3)).toUpperCase(),
          color, takenIds: new Set(me.teams.map((t) => t.id)),
        });
        // Then the team page: pictures, bio, links... (the team must exist before pictures can be added)
        try {
          await saveCustomise({
            form, kind: 'team', owner: 'teams', id: teamId, doc: { id: teamId, colors: { primary: color } },
            save: (changes) => updateTeam({ uid: user.uid, team: { id: teamId }, changes }),
          });
        } catch (err) {
          console.error(err);
          window.alert('Your team was sent for approval, but its page details didn’t all save. You can finish them on this page.');
        }
        refresh();
      }
      if (form.dataset.form === 'pending-team') {
        button.disabled = true;
        button.textContent = 'Saving…';
        const t = me.pendingTeam;
        await saveCustomise({
          form, kind: 'team', owner: 'teams', id: t.id, doc: t,
          save: (changes) => updateTeam({ uid: user.uid, team: t, changes }),
        });
        refresh();
      }
      if (form.dataset.form === 'leave') {
        button.disabled = true;
        await requestLeave({ uid: user.uid, player: me.player, reason: val('reason') });
        refresh();
      }
    } catch (err) {
      if (button) button.disabled = false;
      showError(form, fail(err));
    }
  });
}

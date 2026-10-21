// Admin gate: shows the sign-in panel unless the visitor is a signed-in admin.

import {
  currentAdmin, discordIdOf, startDiscordSignIn, devSignIn, signOut, discordConfigured, devSignInAvailable,
} from '../../auth.js';
import { refresh } from '../../nav.js';
import { esc } from '../../ui.js';

// Returns { user, admin } for admins, or { html } with the sign-in / not-allowed panel.
export async function adminGate() {
  const { user, admin } = await currentAdmin();
  if (user && admin) return { user, admin };
  return { html: user ? notAdminPanel(user) : signInPanel() };
}

function signInPanel() {
  const discord = discordConfigured
    ? '<button class="btn btn-discord" data-action="discord-signin">Sign in with Discord</button>'
    : `<button class="btn btn-discord" disabled>Sign in with Discord</button>
       <p class="muted small">Discord sign-in isn’t set up yet: the Discord Client ID is missing from <code>public/js/config.js</code>.</p>`;
  const dev = devSignInAvailable
    ? `<hr><p class="muted small">Local testing only (this button doesn’t exist on the live site):</p>
       <button class="btn btn-ghost" data-action="dev-signin">Sign in as test admin</button>`
    : '';
  return `
    <section class="card auth-card">
      <span class="eyebrow">Admins</span>
      <h1>Sign in</h1>
      <p class="muted">Admins sign in with their Discord account.</p>
      ${discord}
      ${dev}
      <p class="form-error" role="alert" hidden></p>
    </section>`;
}

function notAdminPanel(user) {
  const discordId = discordIdOf(user);
  return `
    <section class="card auth-card">
      <span class="eyebrow">Admins</span>
      <h1>Not an admin yet</h1>
      <p>You’re signed in as <b>${esc(user.displayName ?? 'Discord user')}</b>, but this account isn’t on the admin list.</p>
      ${discordId ? `<p class="muted">Send this to a league admin so they can add you:</p><p class="code-chip">discord:${esc(discordId)}</p>` : ''}
      <button class="btn btn-ghost" data-action="sign-out">Sign out</button>
    </section>`;
}

// Buttons on the sign-in panels and the admin header. Bind once per page draw.
export function bindAuthActions(root) {
  root.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (!['discord-signin', 'dev-signin', 'sign-out'].includes(action)) return;
    const error = root.querySelector('.form-error');
    button.disabled = true;
    try {
      if (action === 'discord-signin') startDiscordSignIn(location.pathname + location.search);
      if (action === 'dev-signin') { await devSignIn(); refresh(); }
      if (action === 'sign-out') { await signOut(); refresh(); }
    } catch (err) {
      button.disabled = false;
      if (error) {
        error.textContent = err.message || 'Something went wrong. Please try again.';
        error.hidden = false;
      }
    }
  });
}

// Small "signed in as" bar for the top of admin pages.
export function adminBar(user, admin) {
  const photo = user.photoURL ? `<img src="${esc(user.photoURL)}" alt="" width="24" height="24">` : '';
  return `
    <div class="admin-bar">
      <span>${photo}${esc(admin.name ?? user.displayName ?? 'Admin')}</span>
      <button class="link-btn" data-action="sign-out">Sign out</button>
    </div>`;
}

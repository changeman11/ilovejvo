// Admin gate: shows the sign-in form unless the visitor is a signed-in admin.

import { currentAdmin, signIn, signOut, usernameOf } from '../../auth.js';
import { refresh } from '../../nav.js';
import { esc } from '../../ui.js';

// Returns { user, admin } for admins, or { html } with the sign-in / not-allowed panel.
export async function adminGate() {
  const { user, admin } = await currentAdmin();
  if (user && admin) return { user, admin };
  return { html: user ? notAdminPanel(user) : signInPanel() };
}

function signInPanel() {
  return `
    <form class="panel auth-card" data-form="sign-in" novalidate>
      <h1>Admin sign in</h1>
      <label class="field"><span>Username</span><input type="text" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
      <label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>
      <button class="btn btn-primary" type="submit">Sign in</button>
      <p class="form-error" role="alert" hidden></p>
    </form>`;
}

function notAdminPanel(user) {
  return `
    <section class="panel auth-card">
      <h1>Not an admin</h1>
      <p>You’re signed in as <b>${esc(usernameOf(user))}</b>, but this account isn’t on the admin list.</p>
      <p class="muted small">Account ID (for the admin list): <code class="code-chip">${esc(user.uid)}</code></p>
      <button class="btn" data-action="sign-out">Sign out</button>
    </section>`;
}

// Sign-in form and sign-out buttons. Bind once per page draw.
export function bindAuthActions(root) {
  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-form="sign-in"]');
    if (!form) return;
    e.preventDefault();
    const error = form.querySelector('.form-error');
    const button = form.querySelector('button');
    button.disabled = true;
    try {
      await signIn(form.username.value, form.password.value);
      refresh();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      button.disabled = false;
    }
  });
  root.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-action="sign-out"]')) return;
    await signOut();
    refresh();
  });
}

// "Signed in as" bar with admin navigation, for the top of admin pages.
export function adminBar(user, admin, current = '') {
  const links = [['/admin', 'Events'], ['/admin/requests', 'Requests'], ['/admin/people', 'Teams & players']];
  return `
    <div class="admin-bar">
      <nav class="admin-nav">${links.map(([href, label]) => `<a href="${href}" data-link${href === current ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
      <span class="muted small">${esc(admin.name ?? usernameOf(user))} · <button class="link-btn" data-action="sign-out">Sign out</button></span>
    </div>`;
}

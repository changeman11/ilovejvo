// Admin gate: shows the sign-in form unless the visitor is a signed-in admin.

import { currentAdmin, signIn, adminSignOut, usernameOf, setAdminMode } from '../../auth.js';
import { refresh } from '../../nav.js';
import { esc } from '../../ui.js';

// Returns { user, admin } for admins, or { html } with the sign-in / not-allowed panel.
export async function adminGate() {
  const { user, admin, modeOff, account } = await currentAdmin();
  if (user && admin) return { user, admin };
  if (modeOff) return { html: modeOffPanel(account) };
  return { html: user ? notAdminPanel(user) : signInPanel() };
}

// A Discord admin with admin mode switched off.
function modeOffPanel(account) {
  return `
    <section class="panel auth-card admin-mode-card">
      <h1>Admin mode is off</h1>
      <p>You’re browsing as a normal player${account?.name ? `, ${esc(account.name)}` : ''}: no admin tools or admin to-dos.</p>
      <button class="btn btn-primary" type="button" data-action="admin-mode-on">Turn admin mode on</button>
      <p class="muted small" style="margin-top:10px">Fixtures still save at the lock in the background. This setting is remembered on this device.</p>
    </section>`;
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
  root.addEventListener('click', (e) => {
    const toggle = e.target.closest('[data-action="admin-mode-on"], [data-action="admin-mode-off"]');
    if (toggle) setAdminMode(toggle.dataset.action === 'admin-mode-on');
  });
  root.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-action="sign-out"]')) return;
    await adminSignOut(); // the Discord (player) sign-in stays
    refresh();
  });
}

// Admin navigation (redone 2026-11-21): a sidebar on desktop, one scrolling row on phones.
// Plain names; the hover hint says what each page is for.
export function adminBar(user, admin, current = '') {
  const links = [
    ['/admin', '🏠', 'Home', 'What needs you, quick jobs and every event'],
    ['/admin/requests', '📥', 'Requests', 'Result fixes, disputed scores, new clubs and claims'],
    ['/admin/stats', '📸', 'Stats to check', 'Check and publish stats read from screenshots'],
    ['/admin/people', '👥', 'Clubs & players', 'Edit clubs and players, staff badges, pictures'],
    ['/admin/characters', '🎭', 'Characters', 'The community characters on the Home court'],
    ['/admin/bot', '🤖', 'Discord bot', 'Switches, timings, match threads, pickup'],
    ['/admin/help', '📜', 'Help pages', 'Edit the FAQ and rules players read'],
    ['/admin/guide', '📘', 'How-to guide', 'Step-by-step help for every admin job'],
  ];
  const discord = user.uid.startsWith('discord:');
  return `
    <aside class="admin-bar">
      <div class="adm-brand"><span aria-hidden="true">⚙️</span> Admin</div>
      <nav class="admin-nav" aria-label="Admin pages">${links.map(([href, icon, label, hint]) => `<a href="${href}" data-link title="${esc(hint)}"${href === current ? ' aria-current="page"' : ''}><span class="adm-ic" aria-hidden="true">${icon}</span><span>${esc(label)}</span></a>`).join('')}</nav>
      <div class="adm-who">
        <span class="muted small">${esc(admin.name ?? (discord ? 'Admin' : usernameOf(user)))}</span>
        ${discord
          ? '<button class="admin-mode-btn" type="button" data-action="admin-mode-off" title="Browse as a normal player"><span class="admin-mode-dot" aria-hidden="true"></span>Admin mode on</button>'
          : '<button class="link-btn" data-action="sign-out">Sign out</button>'}
        <a class="link-btn" href="/" data-link>← Back to the site</a>
      </div>
    </aside>`;
}

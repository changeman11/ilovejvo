// Admin: edit the FAQ and the rulebook (/admin/help?tab=faq|rules). Saved to settings/faq and
// settings/rules with an audit log entry, like every admin change.

import { loadSetting } from '../../data.js';
import { saveSetting } from '../../admin-data.js';
import { esc, skeleton } from '../../ui.js';
import { markdown, parseFaq } from '../../rules/markdown.js';
import { DEFAULT_FAQ, DEFAULT_RULES } from '../../help-defaults.js';
import { refresh } from '../../nav.js';
import { adminGate, adminBar, bindAuthActions } from './gate.js';

export const title = 'FAQ & rules';

let page = null; // { tab, doc, user }

export function loading() {
  return skeleton([50, 400]);
}

function preview(tab, text) {
  if (tab === 'rules') return markdown(text);
  return parseFaq(text).map((g) => `${g.heading ? `<h2>${esc(g.heading)}</h2>` : ''}${g.items.map((i) => `<details open><summary>${esc(i.q)}</summary>${markdown(i.a, { headingLevel: 3 })}</details>`).join('')}`).join('')
    || '<p class="muted">No questions yet. Start a line with ## to add one.</p>';
}

export async function render() {
  const gate = await adminGate();
  if (gate.html) return { title: 'Admin sign-in', html: `<div class="admin-root">${gate.html}</div>` };
  const tab = new URLSearchParams(location.search).get('tab') === 'rules' ? 'rules' : 'faq';
  const doc = await loadSetting(tab, { fresh: true, admin: true });
  page = { tab, doc, user: gate.user };
  const text = doc?.body ?? (tab === 'rules' ? DEFAULT_RULES : DEFAULT_FAQ);
  const help = tab === 'rules'
    ? '<code># Heading</code> · <code>- bullet</code> · <code>1. numbered</code> · <code>**bold**</code> · <code>[link](https://…)</code> · blank line = new paragraph'
    : '<code># Group heading</code> · <code>## A question</code> with its answer on the lines under it · <code>**bold**</code> · <code>- bullet</code> · <code>[link](https://…)</code>';

  return {
    title: 'FAQ & rules',
    html: `
      <div class="admin-root">
        ${adminBar(gate.user, gate.admin, '/admin/help')}
        <div class="page-head"><div><h1>FAQ &amp; rules</h1><p class="muted">Shown to everyone at <a href="/help${tab === 'rules' ? '?tab=rules' : ''}" data-link>/help</a>.${doc ? '' : ' This is the starter text: save it to make it yours.'}</p></div></div>
        <nav class="chips">
          <a class="chip-link" href="/admin/help" data-link${tab === 'faq' ? ' aria-current="true"' : ''}>FAQ</a>
          <a class="chip-link" href="/admin/help?tab=rules" data-link${tab === 'rules' ? ' aria-current="true"' : ''}>Rules</a>
        </nav>
        <div class="help-edit">
          <form class="panel" data-form="help">
            <p class="muted small" style="margin-top:0">${help}</p>
            <textarea name="body" rows="24" maxlength="40000" spellcheck="true">${esc(text)}</textarea>
            <p class="form-error" role="alert" hidden></p>
            <div class="actions"><button class="btn btn-primary" type="submit">Save ${tab === 'rules' ? 'rules' : 'FAQ'}</button>${doc ? '' : ''}</div>
          </form>
          <section class="panel prose help-preview" aria-label="Preview"><p class="muted small" style="margin-top:0">Preview</p><div data-preview>${preview(tab, text)}</div></section>
        </div>
      </div>`,
  };
}

export function mount(el) {
  const root = el.querySelector('.admin-root');
  if (root) bindAuthActions(root);
  const form = el.querySelector('form[data-form="help"]');
  if (!form || !page) return;
  const box = el.querySelector('[data-preview]');
  form.body.addEventListener('input', () => { box.innerHTML = preview(page.tab, form.body.value); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await saveSetting({ uid: page.user.uid, id: page.tab, existing: page.doc, data: { body: form.body.value } });
      refresh();
    } catch (err) {
      console.error(err);
      const msg = form.querySelector('.form-error');
      msg.textContent = 'That didn’t save. Check you’re still signed in as an admin and try again.';
      msg.hidden = false;
      btn.disabled = false;
    }
  });
}

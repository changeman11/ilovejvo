// FAQ & rules: /help (FAQ) and /help?tab=rules. Admins edit both at /admin/help.

import { loadSetting } from '../data.js';
import { esc, skeleton, pageTitle, fmtDay } from '../ui.js';
import { markdown, parseFaq } from '../rules/markdown.js';
import { DEFAULT_FAQ, DEFAULT_RULES } from '../help-defaults.js';
import { discordInviteUrl } from '../config.js';

export const title = 'FAQ & rules';

export function loading() {
  return skeleton([80, 44, 400]);
}

export async function render() {
  const tab = new URLSearchParams(location.search).get('tab') === 'rules' ? 'rules' : 'faq';
  const doc = await loadSetting(tab).catch(() => null);
  const text = doc?.body?.trim() ? doc.body : tab === 'rules' ? DEFAULT_RULES : DEFAULT_FAQ;

  const chip = (t, label) => `<a class="chip-link" href="/help${t === 'faq' ? '' : '?tab=rules'}" data-link data-keep-scroll${t === tab ? ' aria-current="true"' : ''}>${label}</a>`;
  let body;
  if (tab === 'rules') {
    body = `<article class="panel prose">${markdown(text)}</article>`;
  } else {
    body = parseFaq(text).map((g) => `
      <section class="faq-group">
        ${g.heading ? `<h2>${esc(g.heading)}</h2>` : ''}
        <div class="panel flush faq">${g.items.map((i) => `
          <details><summary>${esc(i.q)}</summary><div class="prose">${markdown(i.a, { headingLevel: 3 })}</div></details>`).join('')}
        </div>
      </section>`).join('');
  }

  return {
    title: tab === 'rules' ? 'Rules' : 'FAQ',
    html: `
      <div class="page-head">${pageTitle('FAQ &amp; rules', 'How JVO works. Still stuck? Ask on the Discord.', 'x')}</div>
      <nav class="chips">${chip('faq', 'FAQ')}${chip('rules', 'Rules')}</nav>
      <div class="stack">${body}</div>
      <p class="muted small help-foot">${doc?.updatedAt ? `Last updated ${esc(fmtDay(doc.updatedAt))}. ` : ''}${discordInviteUrl ? `Questions? <a href="${esc(discordInviteUrl)}" target="_blank" rel="noopener">Ask on the JVO Discord</a>.` : ''}</p>`,
  };
}

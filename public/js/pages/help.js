// FAQ, rules and roles: /help (FAQ), /help?tab=rules and /help?tab=roles. Admins edit the FAQ and
// rules at /admin/help; the roles guide (who does what before, during and after events) is
// help-defaults.js DEFAULT_ROLES.

import { loadSetting } from '../data.js';
import { esc, skeleton, pageTitle, fmtDay } from '../ui.js';
import { markdown, parseFaq } from '../rules/markdown.js';
import { DEFAULT_FAQ, DEFAULT_RULES, DEFAULT_ROLES } from '../help-defaults.js';
import { discordInviteUrl } from '../config.js';

export const title = 'FAQ & rules';

export function loading() {
  return skeleton([80, 44, 400]);
}

const TABS = [['faq', '❓ FAQ'], ['rules', '📜 Rules'], ['roles', '🧭 Roles']];

// The roles guide: "# Section" blocks. A section with "## Before / During / After …" parts shows
// them as three step cards side by side; any other section is plain text.
function rolesHtml(text) {
  const sections = [];
  for (const line of text.split('\n')) {
    const h = line.match(/^#\s+(.+)/);
    if (h) sections.push({ heading: h[1].trim(), intro: '', parts: [] });
    else if (sections.length) {
      const s = sections.at(-1);
      const p = line.match(/^##\s+(.+)/);
      if (p) s.parts.push({ title: p[1].trim(), body: '' });
      else if (s.parts.length) s.parts.at(-1).body += `${line}\n`;
      else s.intro += `${line}\n`;
    }
  }
  const icon = (t) => (/^before/i.test(t) ? '🗓️' : /^during/i.test(t) ? '🏐' : /^after/i.test(t) ? '✅' : '•');
  return sections.map((s) => `
    <section class="roles-section">
      <h2>${esc(s.heading)}</h2>
      ${s.intro.trim() ? `<div class="panel prose">${markdown(s.intro, { headingLevel: 3 })}</div>` : ''}
      ${s.parts.length ? `<div class="roles-steps">${s.parts.map((p) => `
        <div class="panel roles-step"><h3><span aria-hidden="true">${icon(p.title)}</span> ${esc(p.title)}</h3><div class="prose">${markdown(p.body, { headingLevel: 4 })}</div></div>`).join('')}</div>` : ''}
    </section>`).join('');
}

export async function render() {
  const asked = new URLSearchParams(location.search).get('tab');
  const tab = TABS.some(([t]) => t === asked) ? asked : 'faq';
  const doc = tab === 'roles' ? null : await loadSetting(tab).catch(() => null);
  const text = doc?.body?.trim() ? doc.body : tab === 'rules' ? DEFAULT_RULES : tab === 'roles' ? DEFAULT_ROLES : DEFAULT_FAQ;

  const chip = ([t, label]) => `<a class="chip-link" href="/help${t === 'faq' ? '' : `?tab=${t}`}" data-link data-keep-scroll${t === tab ? ' aria-current="true"' : ''}>${label}</a>`;
  let body;
  if (tab === 'rules') {
    body = `<article class="panel prose">${markdown(text)}</article>`;
  } else if (tab === 'roles') {
    body = rolesHtml(text);
  } else {
    const groups = parseFaq(text);
    // Jump links to each group, then the questions (tap to open).
    body = `${groups.length > 2 ? `<nav class="faq-jump" aria-label="FAQ sections">${groups.filter((g) => g.heading).map((g, i) => `<a href="#faq-${i}">${esc(g.heading)}</a>`).join('')}</nav>` : ''}
      ${groups.map((g, i) => `
      <section class="faq-group" id="faq-${i}">
        ${g.heading ? `<h2>${esc(g.heading)}</h2>` : ''}
        <div class="panel flush faq">${g.items.map((it) => `
          <details><summary>${esc(it.q)}</summary><div class="prose">${markdown(it.a, { headingLevel: 3 })}</div></details>`).join('')}
        </div>
      </section>`).join('')}`;
  }

  const sub = tab === 'roles' ? 'Who does what, and what to do before, during and after an event.'
    : tab === 'rules' ? 'The general rules. Each event’s own “📜 Event rules” have the exact format.'
    : 'How JVO works. Still stuck? Ask on the Discord.';
  return {
    title: tab === 'rules' ? 'Rules' : tab === 'roles' ? 'Roles' : 'FAQ',
    html: `
      <div class="page-head">${pageTitle('FAQ &amp; rules', sub, 'x')}</div>
      <nav class="chips">${TABS.map(chip).join('')}</nav>
      <div class="stack">${body}</div>
      <p class="muted small help-foot">${doc?.updatedAt ? `Last updated ${esc(fmtDay(doc.updatedAt))}. ` : ''}${discordInviteUrl ? `Questions? <a href="${esc(discordInviteUrl)}" target="_blank" rel="noopener">Ask on the JVO Discord</a>.` : ''}</p>`,
  };
}

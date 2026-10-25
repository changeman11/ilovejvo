// Admin: community characters on the Home court (/admin/characters).
// - Waiting for approval: pictures the Discord bot cut out from #in-game-characters (status
//   'pending'). Approve puts them on the court (the bot then ticks the post ✅); Deny keeps them off
//   (the bot marks the post 🚫).
// - On the court: everything live. Remove takes one off: the bot's are marked 'denied', the hand-made
//   ones go on settings/characters.hidden.
// - Removed: put any of them back.
import { loadCharacters } from '../../data.js';
import { setCharacterStatus, setHandCharacterHidden } from '../../admin-data.js';
import { esc, skeleton, fmtDay, fmtTime } from '../../ui.js';
import { refresh } from '../../nav.js';
import { adminGate, adminBar, bindAuthActions } from './gate.js';

export const title = 'Characters';

let page = null; // { user, all, setting }

export function loading() {
  return skeleton([60, 300]);
}

const card = (c, actions) => `
  <div class="ch-card ${esc(c.status)}">
    <span class="ch-pic"><img src="${esc(c.src)}" alt="" loading="lazy" decoding="async"></span>
    <span class="ch-info">
      <b>${c.source === 'bot' ? `From ${esc(c.author ?? 'Discord')}` : 'Original set'}</b>
      ${c.postedAt ? `<small>${esc(fmtDay(c.postedAt))} ${esc(fmtTime(c.postedAt))}</small>` : ''}
    </span>
    <span class="ch-actions">${actions(c)}</span>
  </div>`;

const btn = (act, name, label, cls = 'btn btn-sm') => `<button class="${cls}" type="button" data-act="${act}" data-name="${esc(name)}">${label}</button>`;

export async function render() {
  const gate = await adminGate();
  if (gate.html) return { title: 'Admin sign-in', html: `<div class="admin-root">${gate.html}</div>` };
  const { all, setting } = await loadCharacters({ admin: true });
  page = { user: gate.user, all, setting };
  const pending = all.filter((c) => c.status === 'pending').sort((a, b) => (a.postedAt ?? 0) - (b.postedAt ?? 0));
  const live = all.filter((c) => c.status === 'approved');
  const removed = all.filter((c) => c.status === 'denied' || c.status === 'hidden');

  return {
    title: 'Characters',
    html: `
      <div class="admin-root">
        ${adminBar(gate.user, gate.admin, '/admin/characters')}
        <div class="page-head"><div><h1>Characters</h1><p class="muted">The community characters on the Home court. New ones posted in #in-game-characters wait here until an admin approves them.</p></div></div>
        <section>
          <div class="section-head"><h2>⏳ Waiting for approval <span class="muted small">${pending.length}</span></h2></div>
          ${pending.length
            ? `<div class="ch-grid">${pending.map((c) => card(c, () => `${btn('approve', c.name, '✓ Approve', 'btn btn-sm btn-primary')}${btn('deny', c.name, '✕ Deny', 'btn btn-sm btn-danger')}`)).join('')}</div>`
            : '<p class="muted panel">Nothing waiting. New posts in #in-game-characters show up here within about 5 minutes.</p>'}
        </section>
        <section>
          <div class="section-head"><h2>🏐 On the court <span class="muted small">${live.length}</span></h2></div>
          <div class="ch-grid">${live.map((c) => card(c, () => btn('remove', c.name, 'Remove'))).join('')}</div>
        </section>
        ${removed.length ? `
        <section>
          <div class="section-head"><h2>🚫 Removed or denied <span class="muted small">${removed.length}</span></h2></div>
          <div class="ch-grid">${removed.map((c) => card(c, () => btn('restore', c.name, 'Put back'))).join('')}</div>
        </section>` : ''}
        <p class="form-error" role="alert" data-global hidden></p>
      </div>`,
  };
}

export function mount(el) {
  bindAuthActions(el);
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !page) return;
    const c = page.all.find((x) => x.name === b.dataset.name);
    if (!c) return;
    const act = b.dataset.act;
    if (act === 'remove' && !window.confirm('Take this character off the Home court? You can put it back later.')) return;
    b.disabled = true;
    try {
      const uid = page.user.uid;
      if (c.source === 'bot') {
        const status = { approve: 'approved', deny: 'denied', remove: 'denied', restore: 'approved' }[act];
        await setCharacterStatus({ uid, character: c, status });
      } else {
        await setHandCharacterHidden({ uid, name: c.name, hidden: act === 'remove', setting: page.setting });
      }
      refresh();
    } catch (err) {
      console.error(err);
      b.disabled = false;
      const box = el.querySelector('[data-global]');
      box.textContent = err.code === 'permission-denied' ? 'That wasn’t allowed (are the latest rules deployed?).' : 'That didn’t save. Check your connection and try again.';
      box.hidden = false;
    }
  });
}

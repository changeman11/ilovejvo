// Admin: the Discord bot's control panel (/admin/bot). Talks to bot/src/control.js through three
// public Firestore docs: botControl/status (what the bot runs, sent by it every 5 minutes),
// botControl/settings (switches and timings, written here) and botCommands (actions; the bot
// writes the result back). Match threads can be switched on or off and cleared per event.
import { loadBotStatus, loadBotSettings, loadBotCommands, loadAllEvents, loadPickupLive, loadPickupGames } from '../../data.js';
import { saveBotSettings, sendBotCommand, clearBotCommands, setEventThreads } from '../../admin-data.js';
import { eventDateLabel, sortEvents } from '../../rules/events.js';
import { esc, skeleton, fmtDay, fmtTime } from '../../ui.js';
import { refreshQuietly, refresh } from '../../nav.js';
import { db } from '../../firebase.js';
import { onSnapshot, doc, collection } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { adminGate, adminBar, bindAuthActions } from './gate.js';

export const title = 'Bot';

export function loading() {
  return skeleton([50, 140, 220, 220]);
}

// Same lists as bot/src/control.js (FEATURES, TIMINGS).
const FEATURES = [
  ['matchThreads', 'Match threads', 'A Discord thread per event match, where players report scores and screenshots with a form.'],
  ['readStats', 'Read stats screenshots', 'The bot reads end-of-match screenshots and fills in the stats for you to check.'],
  ['ranked', '1v1 ranked', 'The #1v1-queue card, ready-ups, results and RP.'],
  ['statRoles', 'Award roles', '🥇 1st / 🥈 2nd / 🥉 3rd roles for every stat.'],
  ['clubRoles', 'Club roles', 'A coloured Discord role per club, given to its players.'],
  ['characters', 'Characters from Discord', 'Pictures in #in-game-characters become Home court characters (after you approve them).'],
  ['welcome', 'Welcome new members', 'A hello in #welcome with links to the site.'],
];
const TIMINGS = [
  ['matchRemindMinutes', 'Remind teams every', 'minutes', 'While a match has no score, the teams that haven’t reported are pinged this often.'],
  ['matchRemindMax', 'Reminders before pinging admins', 'times', 'After this many reminders, admins get pinged once.'],
  ['matchCloseMinutes', 'Close a thread after the score', 'minutes', 'Then it’s locked (it stays open while stats are being checked).'],
  ['readySeconds', 'Pickup ready check', 'seconds', 'How long players have to join the ready-up channel.'],
  ['pickSeconds', 'Pickup draft pick time', 'seconds', 'Per pick, then it’s random.'],
  ['rankedReadySeconds', '1v1 ready-up', 'seconds', 'How long both players have to press Ready.'],
];
const ACTIONS = [
  ['checkThreads', '🔄 Check match threads now', 'Looks for newly opened matches and updates every thread straight away.'],
  ['syncRoles', '🎨 Sync roles now', 'Re-reads clubs and stats and fixes everyone’s club and award roles.'],
  ['repostCards', '📌 Post the queue cards again', 'Puts the pickup (and 1v1) card back at the bottom of its channel.'],
  ['closeThreads', '🔒 Close all open threads', 'Locks every match thread that’s still open. They stay readable.'],
  ['restart', '♻️ Restart the bot', 'Back in about 15 seconds. Ready checks and drafts in progress are cancelled (players stay signed up).'],
];
const ACTION_NAMES = {
  ...Object.fromEntries(ACTIONS.map(([k, label]) => [k, label])),
  clearEventThreads: '🧹 Clear an event’s threads',
  pickupStart: '🏐 Start a pickup game',
  pickupCancelMatch: '✋ Cancel a ready check / draft',
  pickupResult: '🏆 Pickup result',
  pickupRemove: '🚪 Take someone off the queue',
};
const mode = (n) => `${n}v${n}`;
const teamLabel = (g, side) => {
  const t = g.teams?.[side];
  const cap = t?.players?.find((p) => p.id === t.captain)?.name ?? t?.players?.[0]?.name ?? '?';
  return `Team ${side === 'a' ? 1 : 2} · ${cap}`;
};

// The pickup section: queue, ready checks and drafts, games on, recent games (change results).
function pickupSection(live, games, online) {
  const fresh = live?.updatedAt && Date.now() - live.updatedAt < 12 * 60 * 1000;
  const modes = live?.modes ?? [2, 3, 4, 5, 6];
  const queue = live?.queue ?? [];
  const matches = live?.matches ?? [];
  const on = (live?.games ?? []);
  const off = !online ? ' disabled title="The bot is offline"' : '';
  const queueRows = queue.map((p, i) => `
    <div class="row"><span class="row-main"><b>${i + 1}. ${esc(p.name)}</b><span class="muted small">${p.from === 'site' ? 'signed up on the site' : 'signed up on Discord'}</span></span>
      <span class="row-side"><button class="btn btn-sm" type="button" data-pk="pickupRemove" data-player="${esc(p.id)}"${off}>Take off</button></span></div>`).join('');
  const matchRows = matches.map((m) => `
    <div class="row"><span class="row-main"><b>${mode(m.size)} ${m.phase === 'draft' ? 'draft' : 'ready check'}</b>
      <span class="muted small">${m.phase === 'draft'
        ? `${esc((m.teams?.a ?? []).join(', '))} <b>vs</b> ${esc((m.teams?.b ?? []).join(', '))}`
        : `${m.players.filter((p) => p.ready).length}/${m.players.length} in the channel: ${m.players.map((p) => `${p.ready ? '✅' : '⏳'} ${esc(p.name)}`).join(', ')}`}</span></span>
      <span class="row-side">${m.id ? `<button class="btn btn-sm btn-danger" type="button" data-pk="pickupCancelMatch" data-match="${esc(m.id)}"${off}>Cancel</button>` : ''}</span></div>`).join('');
  const resultButtons = (number, current) => ['a', 'b', 'cancel'].map((w) => {
    const label = w === 'cancel' ? 'Cancel game' : `Team ${w === 'a' ? 1 : 2} won`;
    return `<button class="btn btn-sm${w === 'cancel' ? ' btn-danger' : ''}" type="button" data-pk="pickupResult" data-game="${number}" data-winner="${w}"${current === w ? ' disabled aria-current="true"' : off}>${label}</button>`;
  }).join(' ');
  const gameRows = on.map((g) => `
    <div class="row"><span class="row-main"><b>Game #${g.number} · ${mode(g.size)}</b><span class="muted small">${esc(g.a.join(', '))} <b>vs</b> ${esc(g.b.join(', '))}${g.status === 'disputed' ? ' · ⚠️ captains disagree' : ''}</span></span>
      <span class="row-side">${resultButtons(g.number, null)}</span></div>`).join('');
  const recent = games.filter((g) => g.status === 'done' || g.status === 'cancelled').slice(0, 10).map((g) => {
    const result = g.status === 'cancelled' ? 'cancelled' : `🏆 ${esc(teamLabel(g, g.winner))} won`;
    return `
    <div class="row"><span class="row-main"><b>Game #${g.number} · ${mode(g.size)} · ${result}</b>
      <span class="muted small">${esc((g.teams?.a?.players ?? []).map((p) => p.name).join(', '))} <b>vs</b> ${esc((g.teams?.b?.players ?? []).map((p) => p.name).join(', '))}${g.decidedBy?.by === 'admin' ? ` · set by ${esc(g.decidedBy.name ?? 'an admin')}` : ''}</span></span>
      <span class="row-side"><details class="pk-fix"><summary class="link-btn">Change result</summary>${resultButtons(g.number, g.status === 'cancelled' ? 'cancel' : g.winner)}</details></span></div>`;
  }).join('');
  const empty = (t) => `<p class="muted" style="padding:12px 16px;margin:0">${t}</p>`;
  return `
    <section><div class="section-head"><h2>🏐 Pickup</h2><span class="muted small">${fresh ? 'live' : 'the bot hasn’t updated this for a while'}</span></div>
      <div class="stack">
        <div class="panel bot-action">
          <label class="field" style="margin:0"><span class="sr-only">Mode</span><select data-pk-mode><option value="">Mode: votes / random</option>${modes.map((n) => `<option value="${n}">${mode(n)}</option>`).join('')}</select></label>
          <button class="btn" type="button" data-pk="pickupStart"${off}>▶ Start a game now</button>
          <span class="muted small">With whoever’s waited longest. Needs enough signed up for the mode.</span>
        </div>
        <div><h3 class="pk-sub">Getting ready</h3><div class="panel flush rows">${matchRows || empty('No ready checks or drafts right now.')}</div></div>
        <div><h3 class="pk-sub">Games on</h3><div class="panel flush rows">${gameRows || empty('No games being played.')}</div>
          <p class="muted small" style="margin-top:6px">Setting the winner updates Elo straight away, like both captains agreeing. Cancel = no Elo change.</p></div>
        <div><h3 class="pk-sub">Queue · ${queue.length}</h3><div class="panel flush rows">${queueRows || empty('Nobody signed up.')}</div></div>
        <div><h3 class="pk-sub">Recent games</h3><div class="panel flush rows">${recent || empty('No finished games yet.')}</div>
          <p class="muted small" style="margin-top:6px">Change a result if the captains got it wrong: the old Elo change is undone and the new one applied.</p></div>
      </div>
    </section>`;
}

let page = null;
let unwatch = null;

const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : fmtDay(ms);
};

export async function render() {
  const gate = await adminGate();
  if (gate.html) return { title: 'Admin sign-in', html: `<div class="admin-root">${gate.html}</div>` };
  const [status, settings, commands, events, live, games] = await Promise.all([
    loadBotStatus(), loadBotSettings(), loadBotCommands(), loadAllEvents(), loadPickupLive(), loadPickupGames(25).catch(() => []),
  ]);
  page = { user: gate.user, adminName: gate.admin?.name ?? null, status, settings, commands, events };

  const online = status?.at && Date.now() - status.at < 12 * 60 * 1000;
  const restarting = status?.restarting && Date.now() - status.at < 2 * 60 * 1000;
  const running = status?.features ?? {};
  const available = status?.available ?? {};
  const counts = status?.counts ?? {};
  const statusHtml = `
    <section class="panel bot-status ${online ? 'on' : 'off'}">
      <div class="bot-light"><span class="dot" aria-hidden="true"></span><b>${restarting ? 'Restarting…' : online ? 'Online' : status ? 'Offline' : 'Not linked yet'}</b></div>
      <p class="muted small">${status
        ? `Last heard from ${esc(ago(status.at))}${status.startedAt ? ` · running since ${esc(fmtDay(status.startedAt))} ${esc(fmtTime(status.startedAt))}` : ''}${online ? '' : '. It checks in every 5 minutes; if this stays offline, the server may be down.'}`
        : 'The bot hasn’t checked in yet. It does once it’s updated to the version with this panel.'}</p>
      ${status ? `<div class="tiles bot-tiles">
        <div class="tile"><b>${counts.queue ?? 0}</b><span>signed up for pickup</span></div>
        <div class="tile"><b>${counts.games ?? 0}</b><span>pickup games on</span></div>
        <div class="tile"><b>${counts.threadsOpen ?? 0}</b><span>match threads open</span></div>
      </div>
      <p class="small">${FEATURES.map(([k, label]) => `<span class="tag ${running[k] ? 'tag-live' : ''}">${running[k] ? '●' : '○'} ${esc(label)}</span>`).join(' ')}</p>` : ''}
    </section>`;

  // Switches: what's saved, else what's running.
  const want = { ...running, ...(settings?.features ?? {}) };
  const switches = `
    <form class="panel stack" data-form="features">
      ${FEATURES.map(([k, label, hint]) => {
        const can = available[k] !== false;
        return `<label class="check bot-switch${can ? '' : ' disabled'}"><input type="checkbox" name="${k}" ${want[k] && can ? 'checked' : ''} ${can ? '' : 'disabled'}>
          <span><b>${esc(label)}</b><small>${esc(hint)}${can ? '' : ' <b>Needs setting up on the server first (its .env file).</b>'}</small></span></label>`;
      }).join('')}
      <div class="actions"><button class="btn btn-primary" type="submit">Save switches</button>
        <span class="muted small">The bot restarts by itself to apply them (about 15 seconds; ready checks and drafts in progress are cancelled).</span></div>
      <p class="form-error" role="alert" hidden></p>
    </form>`;

  const times = { ...(status?.timings ?? {}), ...(settings?.timings ?? {}) };
  const timings = `
    <form class="panel stack" data-form="timings">
      <div class="bot-timings">${TIMINGS.map(([k, label, unit, hint]) => `
        <label class="field"><span>${esc(label)}</span>
          <span class="bot-num"><input type="number" inputmode="numeric" name="${k}" value="${esc(times[k] ?? '')}" min="0"> <span class="muted small">${unit}</span></span>
          <small class="muted">${esc(hint)}</small></label>`).join('')}</div>
      <div class="actions"><button class="btn btn-primary" type="submit">Save timings</button><span class="muted small">These apply straight away, no restart.</span></div>
      <p class="form-error" role="alert" hidden></p>
    </form>`;

  // Match threads by event: newest first (upcoming, then finished).
  const { upcoming, past } = sortEvents(events);
  const byEvent = status?.threadsByEvent ?? {};
  const eventRows = [...upcoming, ...past].slice(0, 15).map((e) => {
    const t = byEvent[e.id] ?? { open: 0, total: 0 };
    const on = e.matchThreads !== false;
    return `
      <div class="row">
        <span class="row-main"><b>${esc(e.title)}</b><span class="muted small">${esc(eventDateLabel(e))} · ${t.total ? `${t.total} thread${t.total === 1 ? '' : 's'}${t.open ? ` (${t.open} open)` : ''}` : 'no threads'}</span></span>
        <span class="row-side">
          <label class="check small"><input type="checkbox" data-threads-on="${esc(e.id)}" ${on ? 'checked' : ''}> Threads on</label>
          <button class="btn btn-sm" type="button" data-clear-event="${esc(e.id)}" ${t.total ? '' : 'disabled'} title="Delete this event’s threads from Discord">🧹 Clear threads</button>
        </span>
      </div>`;
  }).join('');

  const recent = [...commands].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, 10);
  const eventName = (id) => events.find((e) => e.id === id)?.title ?? id;
  const pkDetail = (c) => [
    c.gameNumber ? `game #${c.gameNumber}` : '',
    c.winner ? (c.winner === 'cancel' ? 'cancelled' : `Team ${c.winner === 'a' ? 1 : 2} won`) : '',
    c.mode ? mode(c.mode) : '',
  ].filter(Boolean).join(' · ');
  const log = recent.map((c) => `
    <div class="row">
      <span class="row-main"><b>${esc(ACTION_NAMES[c.action] ?? c.action)}${c.eventId ? `: ${esc(eventName(c.eventId))}` : ''}${pkDetail(c) ? `: ${esc(pkDetail(c))}` : ''}</b>
        <span class="muted small">${esc(c.createdAt ? ago(c.createdAt) : '')}${c.result ? ` · ${esc(c.result)}` : ''}</span></span>
      <span class="row-side"><span class="tag ${c.status === 'done' ? 'tag-live' : c.status === 'failed' ? 'tag-cancelled' : 'tag-draft'}">${c.status === 'pending' ? 'waiting for the bot' : esc(c.status)}</span></span>
    </div>`).join('');

  return {
    title: 'Bot',
    html: `
      <div class="admin-root">
        ${adminBar(gate.user, gate.admin, '/admin/bot')}
        <div class="page-head"><div><h1>🤖 Bot control panel</h1><p class="muted">Run the I&lt;3JVO Discord bot from here: what’s on, how long things take, and quick fixes.</p></div></div>
        <div class="stack">
          ${statusHtml}
          ${pickupSection(live, games, online)}
          <section><div class="section-head"><h2>🧵 Match threads by event</h2><span class="muted small">Players report scores in these with a form</span></div>
            <div class="panel flush rows">${eventRows || '<p class="muted" style="padding:16px">No events yet.</p>'}</div>
            <p class="muted small" style="margin-top:6px">“Threads on” lets the bot open a thread for each match once it starts. “Clear threads” deletes that event’s threads from Discord (scores and stats on the site stay), so the channel is clean for the next event.</p></section>
          <section><div class="section-head"><h2>⚡ Quick actions</h2></div>
            <div class="panel stack">${ACTIONS.map(([k, label, hint]) => `<div class="bot-action"><button class="btn${k === 'restart' ? ' btn-danger' : ''}" type="button" data-act="${k}">${label}</button><span class="muted small">${esc(hint)}</span></div>`).join('')}</div></section>
          <section><div class="section-head"><h2>📜 Recent actions</h2>${recent.length ? '<button class="link-btn" type="button" data-clear-log>Clear list</button>' : ''}</div>
            <div class="panel flush rows">${log || '<p class="muted" style="padding:16px">Nothing yet. Actions you press show here with what the bot did.</p>'}</div></section>
          <section><div class="section-head"><h2>🔌 Switches</h2></div>${status ? switches : '<p class="panel muted">The switches show here once the bot has checked in (so they start from what it’s really running).</p>'}</section>
          <section><div class="section-head"><h2>⏱️ Timings</h2></div>${timings}</section>
          <p class="form-error" role="alert" data-global hidden></p>
        </div>
      </div>`,
  };
}

// Redraw when the bot reports back (status or a command result), while this page is open.
function watch() {
  unwatch?.();
  let first = 3;
  let timer = null;
  const changed = () => {
    if (location.pathname !== '/admin/bot') { unwatch?.(); unwatch = null; return; }
    if (first > 0) { first--; return; } // the first snapshot of each is what's already drawn
    clearTimeout(timer);
    timer = setTimeout(() => {
      // Not while someone's typing in a form or has a "Change result" open.
      const busy = document.activeElement?.closest?.('form[data-form]') || document.querySelector('.pk-fix[open]');
      if (busy) { timer = setTimeout(changed, 3000); return; }
      refreshQuietly();
    }, 400);
  };
  const a = onSnapshot(doc(db, 'botControl', 'status'), changed, () => {});
  const b = onSnapshot(collection(db, 'botCommands'), changed, () => {});
  const c = onSnapshot(doc(db, 'pickupMeta', 'live'), changed, () => {});
  unwatch = () => { a(); b(); c(); clearTimeout(timer); };
}

export function mount(el) {
  const root = el.querySelector('.admin-root');
  if (!root) return;
  bindAuthActions(root);
  if (!page) return;
  watch();
  const uid = page.user.uid;
  const fail = (box, err) => {
    console.error(err);
    const target = box ?? root.querySelector('[data-global]');
    target.textContent = err?.code === 'permission-denied' ? 'That wasn’t allowed (are the latest rules deployed?).' : 'That didn’t save. Check your connection and try again.';
    target.hidden = false;
  };

  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const button = form.querySelector('[type=submit]');
    button.disabled = true;
    const features = { ...(page.settings?.features ?? {}) };
    const timings = { ...(page.settings?.timings ?? {}) };
    if (form.dataset.form === 'features') {
      for (const [k] of FEATURES) {
        const box = form.querySelector(`[name=${k}]`);
        if (!box.disabled) features[k] = box.checked;
      }
    } else {
      for (const [k] of TIMINGS) {
        const v = form.querySelector(`[name=${k}]`).value.trim();
        if (v !== '') timings[k] = Math.round(Number(v));
      }
    }
    try {
      await saveBotSettings({ uid, existing: page.settings, features, timings });
      refresh();
    } catch (err) {
      button.disabled = false;
      fail(form.querySelector('.form-error'), err);
    }
  });

  root.addEventListener('change', async (e) => {
    const box = e.target.closest('[data-threads-on]');
    if (!box) return;
    const event = page.events.find((x) => x.id === box.dataset.threadsOn);
    box.disabled = true;
    try {
      await setEventThreads({ uid, event, on: box.checked });
      refresh();
    } catch (err) {
      box.disabled = false;
      box.checked = !box.checked;
      fail(null, err);
    }
  });

  // Pickup buttons: each one is a command for the bot.
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-pk]');
    if (!b) return;
    const action = b.dataset.pk;
    const extra = {};
    if (action === 'pickupStart') {
      const m = root.querySelector('[data-pk-mode]')?.value;
      extra.mode = m ? Number(m) : null;
    }
    if (action === 'pickupCancelMatch') {
      if (!window.confirm('Cancel this ready check / draft? Everyone goes back to the queue in their old places.')) return;
      extra.matchId = b.dataset.match;
    }
    if (action === 'pickupRemove') extra.playerId = b.dataset.player;
    if (action === 'pickupResult') {
      extra.gameNumber = Number(b.dataset.game);
      extra.winner = b.dataset.winner;
      const what = extra.winner === 'cancel' ? 'cancel it (no Elo change)' : `say Team ${extra.winner === 'a' ? 1 : 2} won (Elo updates)`;
      if (!window.confirm(`Game #${extra.gameNumber}: ${what}?`)) return;
    }
    b.disabled = true;
    try {
      await sendBotCommand({ uid, action, ...extra, adminName: page.adminName });
      refresh();
    } catch (err) {
      b.disabled = false;
      fail(null, err);
    }
  });

  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]');
    const clear = e.target.closest('[data-clear-event]');
    const clearLog = e.target.closest('[data-clear-log]');
    if (!act && !clear && !clearLog) return;
    try {
      if (act) {
        const action = act.dataset.act;
        if (action === 'restart' && !window.confirm('Restart the bot now? Ready checks and drafts in progress are cancelled.')) return;
        if (action === 'closeThreads' && !window.confirm('Lock every open match thread?')) return;
        act.disabled = true;
        await sendBotCommand({ uid, action });
      } else if (clear) {
        const event = page.events.find((x) => x.id === clear.dataset.clearEvent);
        if (!window.confirm(`Delete every Discord match thread for “${event?.title}”? Scores and stats on the site stay. This can’t be undone.`)) return;
        clear.disabled = true;
        await sendBotCommand({ uid, action: 'clearEventThreads', eventId: event.id });
      } else {
        clearLog.disabled = true;
        await clearBotCommands({ uid, commands: page.commands.filter((c) => c.status !== 'pending') });
      }
      refresh();
    } catch (err) {
      (act ?? clear ?? clearLog).disabled = false;
      fail(null, err);
    }
  });
}

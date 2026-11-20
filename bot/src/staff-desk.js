// Staff desk (added 2026-11-21, STAFF_DESK=0 turns it off): a staff-only channel (#staff-desk,
// made in the Staff category) with a card for each quick admin job: new clubs, community
// characters, result fixes (✅ / ❌ buttons) and a stats-to-check count (link to the site).
// Every STAFF_DESK_SECONDS (90) it reads what's waiting from the site (public data), posts new
// cards, refreshes changed ones, and marks cards dealt with on the site as done.
// Pressing a button (staff only) writes the decision straight to the site, signed in as the bot;
// firestore.rules lets the bot make exactly these changes, only while the item is still waiting.
// Every change also gets an audit log entry naming the staff member.
// Remembered in the store's meta: staffDesk = { [shortId]: { key, messageId, print } }.
//
// io: { post(body) -> messageId, edit(messageId, body), remove(messageId) } (discord-io.js deskIo)
// site: SiteReader. rest: the bot's FirestoreRest.
import { deskCards, deskMessage, shortKey, cardPrint } from './logic/staff-desk.js';

const RECENT_DAYS = 45;

export class StaffDesk {
  constructor({ io, site, rest, store, config, log = console, now = () => Date.now() }) {
    Object.assign(this, { io, site, rest, store, config, log, now });
    this.chain = Promise.resolve();
  }

  start() {
    this.timer = setInterval(() => this.sync(), (this.config.staffDeskSeconds ?? 90) * 1000);
    this.timer.unref?.();
    return this.sync();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  sync() {
    const run = this.chain.then(() => this.syncNow());
    this.chain = run.catch((err) => this.log.warn('[staff desk]', err.message));
    return run;
  }

  // Everything waiting on staff right now.
  async gather() {
    const [pendingTeams, characters, events] = await Promise.all([
      this.site.query('teams', 'status', 'pending'),
      this.site.query('characters', 'status', 'pending'),
      this.site.query('events', 'published', true),
    ]);
    const recent = events.filter((e) => {
      const when = e.data.date ?? e.data.createdAt ?? 0;
      return e.data.status !== 'cancelled' && (!when || when > this.now() - RECENT_DAYS * 86400000);
    });
    const fixes = [];
    let statsWaiting = 0;
    for (const e of recent) {
      const [open, waiting] = await Promise.all([
        this.site.queryIn(`events/${e.id}`, 'corrections', 'status', 'open'),
        this.site.queryIn(`events/${e.id}`, 'results', 'statsStatus', 'pending'),
      ]);
      statsWaiting += waiting.filter((r) => !r.data.forfeit).length;
      for (const fx of open) {
        const fixtureId = fx.data.fixtureId;
        const [fixture, result] = await Promise.all([this.site.get(`events/${e.id}/fixtures/${fixtureId}`), this.site.get(`events/${e.id}/results/${fixtureId}`)]);
        fixes.push({ eventId: e.id, id: fx.id, data: fx.data, fixture: fixture ? { id: fixtureId, ...fixture } : null, result, event: e.data });
      }
    }
    const needPeople = pendingTeams.length || fixes.length;
    const [teams, players] = needPeople ? await Promise.all([this.site.list('teams'), this.site.list('players')]) : [[], []];
    return {
      pendingTeams, characters, fixes, statsWaiting,
      teams: new Map(teams.map((d) => [d.id, d.data])),
      players: new Map(players.map((d) => [d.id, d.data])),
      siteUrl: this.config.siteUrl,
      bucket: this.config.firebase?.storageBucket,
    };
  }

  async syncNow() {
    this.data = await this.gather();
    const cards = deskCards(this.data);
    this.cards = cards;
    const desk = { ...(this.store.getMeta('staffDesk') ?? {}) };
    let changed = false;
    // Gone from the site (dealt with there, or the item went away): mark done or remove.
    for (const [sid, entry] of Object.entries(desk)) {
      if (cards.has(entry.key)) continue;
      if (entry.key === 'stats') await this.io.remove(entry.messageId).catch(() => {});
      else await this.io.edit(entry.messageId, deskMessage(entry.card ?? { embed: { title: entry.title ?? 'Done' } }, sid, { text: '✔️ Dealt with on the site' })).catch(() => {});
      delete desk[sid];
      changed = true;
    }
    // New and changed cards.
    for (const [key, card] of cards) {
      const sid = shortKey(key);
      const print = cardPrint(card);
      const entry = desk[sid];
      if (!entry) {
        const messageId = await this.io.post(deskMessage(card, sid));
        desk[sid] = { key, messageId, print, card: { embed: { title: card.embed.title, description: card.embed.description } } };
        changed = true;
      } else if (entry.print !== print) {
        await this.io.edit(entry.messageId, deskMessage(card, sid)).catch(() => {});
        desk[sid] = { ...entry, print, card: { embed: { title: card.embed.title, description: card.embed.description } } };
        changed = true;
      }
    }
    if (changed) await this.store.setMeta('staffDesk', desk);
    return { cards: cards.size };
  }

  // A button: "desk:yes:<sid>" / "desk:no:<sid>". user: { id, name, isStaff }.
  // -> { reply } (only to the presser) or { done: text, body } (the card is edited).
  async button(customId, user) {
    if (!user.isStaff) return { reply: 'Only staff can use these.' };
    const [, choice, sid] = customId.split(':');
    const run = this.chain.then(() => this.decide(choice === 'yes', sid, user));
    this.chain = run.catch(() => {});
    return run;
  }

  async decide(yes, sid, user) {
    const desk = { ...(this.store.getMeta('staffDesk') ?? {}) };
    const entry = desk[sid];
    if (!entry) return { reply: 'That card is already dealt with.' };
    const [kind, rest] = [entry.key.slice(0, entry.key.indexOf(':')), entry.key.slice(entry.key.indexOf(':') + 1)];
    let text;
    try {
      if (kind === 'team') text = await this.decideTeam(rest, yes, user);
      else if (kind === 'char') text = await this.decideCharacter(rest, yes, user);
      else if (kind === 'fix') text = await this.decideFix(rest, yes, user);
      else return { reply: 'Nothing to do on this card.' };
    } catch (err) {
      this.log.warn('[staff desk]', err.message);
      return { reply: `Couldn't save that: ${err.message.slice(0, 200)}. It may have changed on the site; try the site instead.` };
    }
    const card = this.cards?.get(entry.key) ?? entry.card ?? { embed: { title: 'Done' } };
    delete desk[sid];
    await this.store.setMeta('staffDesk', desk);
    this.log.info?.(`[staff desk] ${user.name}: ${text}`);
    return { done: text, body: deskMessage(card, sid, { text: `${text} · by ${user.name}` }) };
  }

  // One save: the changes plus an audit entry for each, naming the staff member.
  async save(writes, user) {
    await this.rest.token();
    const uid = this.rest.uid;
    const audit = writes.filter((w) => w.path).map((w) => ({
      path: `auditLog/${this.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`,
      data: { by: uid, action: 'update', path: w.path, before: null, after: w.data, via: 'discord-staff-desk', staffName: String(user.name).slice(0, 60), staffDiscordId: String(user.id) },
      serverTime: ['at'],
    }));
    const stamped = writes.map((w) => ({ ...w, data: { ...w.data, updatedBy: uid }, ...(w.mask ? { mask: [...w.mask, 'updatedBy'] } : {}), serverTime: [...(w.serverTime ?? []), 'updatedAt'] }));
    await this.rest.commit([...stamped, ...audit]);
  }

  async decideTeam(teamId, yes, user) {
    const team = await this.rest.get(`teams/${teamId}`);
    if (team?.status !== 'pending') throw new Error('it isn’t waiting any more');
    if (!yes) {
      await this.save([{ path: `teams/${teamId}`, data: { status: 'rejected' }, mask: ['status'] }], user);
      return `❌ Declined ${team.name}`;
    }
    const writes = [{ path: `teams/${teamId}`, data: { status: 'approved' }, mask: ['status'] }];
    if (team.managerPlayerId) {
      writes.push({ path: `players/${team.managerPlayerId}`, data: { teamId }, mask: ['teamId'] });
      writes.push({ path: `transfers/${newId()}`, data: { playerId: team.managerPlayerId, fromTeamId: null, toTeamId: teamId, kind: 'founded' }, serverTime: ['at'] });
    }
    let invited = 0;
    if (team.managerUid) {
      for (const pid of (team.invitePlayerIds ?? []).slice(0, 5)) {
        const p = await this.rest.get(`players/${pid}`).catch(() => null);
        if (!p?.uid || p.teamId || pid === team.managerPlayerId) continue;
        writes.push({ path: `offers/${newId()}`, data: { teamId, playerId: pid, playerUid: p.uid, fromUid: team.managerUid, status: 'pending' }, serverTime: ['createdAt'] });
        invited++;
      }
    }
    await this.save(writes, user);
    return `✅ Approved ${team.name}${invited ? ` (${invited} invite${invited === 1 ? '' : 's'} sent)` : ''}`;
  }

  async decideCharacter(key, yes, user) {
    const c = await this.rest.get(`characters/${key}`);
    if (!c || (c.status ?? 'pending') !== 'pending') throw new Error('it isn’t waiting any more');
    await this.save([{ path: `characters/${key}`, data: { status: yes ? 'approved' : 'denied' }, mask: ['status'] }], user);
    return yes ? '✅ On the court' : '❌ Denied';
  }

  async decideFix(ref, yes, user) {
    const [eventId, fixId] = ref.split('/');
    const fix = await this.rest.get(`events/${eventId}/corrections/${fixId}`);
    if (fix?.status !== 'open') throw new Error('it’s already closed');
    const close = { path: `events/${eventId}/corrections/${fixId}`, data: { status: 'done' }, mask: ['status'] };
    if (!yes) {
      await this.save([close], user);
      return '❌ Closed, no change';
    }
    if (!fix.sets?.length) throw new Error('this fix has no new score');
    await this.save([
      { path: `events/${eventId}/results/${fix.fixtureId}`, data: { sets: fix.sets, correctedBy: [fixId] }, mask: ['sets', 'correctedBy'] },
      close,
    ], user);
    return `✅ Score changed to ${fix.sets.map((x) => `${x.home}–${x.away}`).join(', ')}`;
  }
}

function newId() {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 20; i++) id += abc[Math.floor(Math.random() * abc.length)];
  return id;
}

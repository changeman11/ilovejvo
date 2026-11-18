// Site admins from the Discord Staff role (added 2026-11-18): everyone with a STAFF_ROLE_IDS role
// gets a site admin entry for their Discord sign-in (admins/discord:<id> { discord: true,
// source: 'staff-role' }), and loses it when the role goes. Every STAFF_ADMINS_MINUTES (5), at
// start, and when a member's roles change. Entries added by hand in the Firebase console (no
// source) are never touched; firestore.rules only lets the bot write its own 'staff-role' ones.
// STAFF_ADMINS=0 turns it off.
//
// io: { staffMembers() -> [{ id, name }] | null (null = couldn't read the member list) }
// rest: the bot's FirestoreRest (list, commit).

// What to change: wanted = staff members now; existing = the admins entries (id -> data).
// -> { add: [{ id, name }], remove: [docId], rename: [{ id, name }] }
export function planStaffAdmins({ staff, existing }) {
  const want = new Map(staff.map((m) => [`discord:${m.id}`, m]));
  const add = [];
  const rename = [];
  for (const [docId, m] of want) {
    const doc = existing.get(docId);
    if (!doc) add.push(m);
    else if (doc.source === 'staff-role' && doc.name !== m.name) rename.push(m);
    // A hand-made entry for the same person: leave it alone.
  }
  const remove = [...existing].filter(([docId, d]) => d.source === 'staff-role' && !want.has(docId)).map(([docId]) => docId);
  return { add, remove, rename };
}

export class StaffAdmins {
  constructor({ io, rest, config, log = console, now = () => Date.now() }) {
    Object.assign(this, { io, rest, config, log, now });
    this.chain = Promise.resolve();
  }

  start() {
    this.timer = setInterval(() => this.sync(), (this.config.staffAdminsMinutes ?? 5) * 60 * 1000);
    this.timer.unref?.();
    return this.sync();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  sync() {
    const run = this.chain.then(() => this.syncNow());
    this.chain = run.catch((err) => this.log.warn('[staff admins]', err.message));
    return run;
  }

  async syncNow() {
    const staff = await this.io.staffMembers();
    if (!staff) return { skipped: true };
    const existing = new Map((await this.rest.list('admins')).map((d) => [d.id, d.data]));
    // Never wipe everyone because of a bad read: no staff at all while some have entries = skip.
    const ours = [...existing.values()].filter((d) => d.source === 'staff-role').length;
    if (!staff.length && ours) {
      this.log.warn('[staff admins] nobody has the Staff role right now; not removing anyone (check STAFF_ROLE_IDS)');
      return { skipped: true };
    }
    const plan = planStaffAdmins({ staff, existing });
    const stamp = { updatedBy: 'pickup-bot', updatedAt: this.now() };
    const entry = (m) => ({ discord: true, name: String(m.name ?? 'Staff').slice(0, 60), source: 'staff-role', discordId: String(m.id), ...stamp });
    const writes = [
      ...plan.add.map((m) => ({ path: `admins/discord:${m.id}`, data: entry(m), mustNotExist: true })),
      ...plan.rename.map((m) => ({ path: `admins/discord:${m.id}`, data: entry(m) })),
      ...plan.remove.map((docId) => ({ delete: `admins/${docId}` })),
    ];
    for (const w of writes) {
      // One at a time, so one refused write (e.g. a hand-made entry appeared) doesn't block the rest.
      await this.rest.commit([w]).catch((err) => this.log.warn(`[staff admins] ${w.path ?? w.delete}:`, err.message));
    }
    if (plan.add.length || plan.remove.length) {
      this.log.info?.(`[staff admins] site admin added: ${plan.add.map((m) => m.name).join(', ') || 'nobody'}; removed: ${plan.remove.length}`);
    }
    return plan;
  }
}

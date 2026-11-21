// Event reminders on Discord (added 2026-11-21). Pure planning only (tested).
//   roster24 / roster2: 24 hours and 2 hours before an event, ping every club in it that has fewer
//                       players than the event's players per game ("finish your roster").
//   start:              at the start, ping everyone in the event: check in (when the event uses
//                       check-in) or "your first matches are open".
//   checkin2:           10 minutes in, ping whoever still hasn't checked in.
// Each stage is sent once per event; a stage whose time window has passed (the bot was off) is skipped.

const H = 60 * 60 * 1000;
const M = 60 * 1000;
export const STAGES = [
  { kind: 'roster24', from: -24 * H, to: -2 * H },
  { kind: 'roster2', from: -2 * H, to: 0 },
  { kind: 'start', from: 0, to: 30 * M },
  { kind: 'checkin2', from: 10 * M, to: 40 * M },
];

const clean = (s) => String(s ?? '').replace(/[*_`~|>]/g, '').replace(/@(everyone|here)/gi, '@​$1');
const isId = (id) => /^\d{15,22}$/.test(String(id ?? ''));

// One event's teams and their players.
// ctx: { event, teamIds: [...], rosters: { teamId: { playerIds } }, checkins: [{ playerId }], teams: Map, players: Map }
function teamsOf(ctx) {
  return ctx.teamIds.map((teamId) => {
    const team = ctx.teams.get(teamId) ?? {};
    // Everyone who can play for this team at the event, subs included: the club's players plus
    // anyone on the event roster (mix teams only have the roster). Same as the site's check-in.
    const ids = new Set(ctx.rosters[teamId]?.playerIds ?? []);
    if (!team.mix) for (const [id, p] of ctx.players) if (p.teamId === teamId) ids.add(id);
    const players = [...ids].map((id) => ({ id, ...(ctx.players.get(id) ?? {}) }));
    return { teamId, name: team.name ?? teamId, players };
  });
}

// -> [{ key, eventId, kind, content, userIds }] for everything due now and not sent yet.
// events: [ctx], sent: Set of keys ("eventId:kind"), siteUrl for links.
export function planPings({ events, now, sent, siteUrl = '' }) {
  const out = [];
  for (const ctx of events) {
    const e = ctx.event;
    if (e.published === false || e.status !== 'upcoming' || !e.date || e.timeTbd) continue;
    const size = Number(e.teamSize) || 4;
    const subs = e.subs != null ? Number(e.subs) : Math.max(0, 6 - size);
    const link = siteUrl ? `${siteUrl}/event/${encodeURIComponent(e.id)}` : '';
    const when = `<t:${Math.floor(e.date / 1000)}:R>`;
    const checkin = e.flow?.readyUp === true && e.flow?.on !== false;
    const teams = teamsOf(ctx);
    const inIds = new Set((ctx.checkins ?? []).map((c) => c.playerId));
    for (const st of STAGES) {
      const key = `${e.id}:${st.kind}`;
      if (sent.has(key) || now < e.date + st.from || now >= e.date + st.to) continue;
      let lines = [];
      let head = '';
      if (st.kind === 'roster24' || st.kind === 'roster2') {
        const short = teams.filter((t) => t.players.length < size);
        if (!short.length) { out.push({ key, eventId: e.id, kind: st.kind, content: null, userIds: [] }); continue; }
        head = `📋 **${clean(e.title)}** starts ${when} (${size}v${size}${subs ? ` · ${subs} sub${subs === 1 ? '' : 's'}` : ''}). These clubs still need players:`;
        lines = short.map((t) => ({ text: `• **${clean(t.name)}** ${t.players.length}/${size}`, ids: t.players.map((p) => p.discordId).filter(isId) }));
        lines.push({ text: `Invite players from the **Club hub** on the site${link ? ` · ${link}` : ''}`, ids: [] });
      } else if (st.kind === 'start') {
        head = checkin
          ? `✋ **${clean(e.title)}** is starting! **Check in now** on the event page so your matches can begin${link ? `: ${link}` : '.'}`
          : `🏐 **${clean(e.title)}** is starting now! Your first matches are open${link ? `: ${link}` : '.'}`;
        lines = teams.map((t) => ({ text: `• **${clean(t.name)}**`, ids: t.players.filter((p) => !checkin || !inIds.has(p.id)).map((p) => p.discordId).filter(isId) }))
          .filter((l) => l.ids.length);
      } else if (st.kind === 'checkin2') {
        if (!checkin) { out.push({ key, eventId: e.id, kind: st.kind, content: null, userIds: [] }); continue; }
        lines = teams.map((t) => ({ text: `• **${clean(t.name)}**`, ids: t.players.filter((p) => !inIds.has(p.id)).map((p) => p.discordId).filter(isId) }))
          .filter((l) => l.ids.length);
        if (!lines.length) { out.push({ key, eventId: e.id, kind: st.kind, content: null, userIds: [] }); continue; }
        head = `⏰ Still waiting for check-ins at **${clean(e.title)}**. Matches start once enough of each team is in${link ? `: ${link}` : '.'}`;
      }
      const body = [head, ...lines.map((l) => `${l.text}${l.ids.length ? ` ${l.ids.map((id) => `<@${id}>`).join(' ')}` : ''}`)].join('\n');
      out.push({ key, eventId: e.id, kind: st.kind, content: body, userIds: [...new Set(lines.flatMap((l) => l.ids))] });
    }
  }
  return out;
}

// Split a long message at line breaks (Discord: 2000 characters per message).
export function chunks(text, max = 1900) {
  const out = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur && cur.length + line.length + 1 > max) { out.push(cur); cur = ''; }
    cur = cur ? `${cur}\n${line}` : line.slice(0, max);
  }
  if (cur) out.push(cur);
  return out;
}

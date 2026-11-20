// Staff desk (added 2026-11-21): the quick admin jobs as cards in a staff-only Discord channel,
// with ✅ / ❌ buttons. Pure (tested): which cards there should be, and what each looks like.
//
// Cards (key -> card):
//   team:<teamId>            a new club waiting for approval   ✅ Approve / ❌ Decline
//   char:<key>               a community character waiting      ✅ Approve / ❌ Deny
//   fix:<eventId>/<fixId>    an open result fix                 ✅ Use this score (if it has one) / ❌ Close
//   stats                    how many matches wait for a stats check (link only)

const clean = (s, n = 200) => String(s ?? '').replace(/[*_`~|>]/g, '').replace(/@(everyone|here)/gi, '@​$1').slice(0, n);
const score = (sets) => (sets ?? []).map((x) => `${x.home}–${x.away}`).join(', ') || '—';

// data: { teams: Map, players: Map, pendingTeams: [{id,data}], characters: [{id,data}],
//         fixes: [{ eventId, id, data, fixture, result, event }], statsWaiting: number,
//         siteUrl, bucket }
export function deskCards(data) {
  const { teams, players, siteUrl = '', bucket = '' } = data;
  const name = (id) => clean(players.get(id)?.displayName ?? id, 60);
  const teamName = (id) => clean(teams.get(id)?.name ?? id, 60);
  const media = (path) => (bucket && path ? `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media` : null);
  const link = (label, path) => (siteUrl ? { type: 2, style: 5, label, url: `${siteUrl}${path}` } : null);
  const cards = new Map();

  for (const { id, data: t } of data.pendingTeams ?? []) {
    const invites = (t.invitePlayerIds ?? []).map(name);
    const logo = media(t.logoPath);
    cards.set(`team:${id}`, {
      embed: {
        title: `🆕 New club: ${clean(t.name, 80)}`,
        description: [
          `Registered by **${name(t.managerPlayerId)}**${t.shortName ? ` · short name ${clean(t.shortName, 10)}` : ''}`,
          invites.length ? `Invites: ${invites.join(', ')}` : 'No invites picked',
          'Approving makes the founder its manager and sends their invites.',
        ].join('\n'),
        color: /^#[0-9a-f]{6}$/i.test(t.colors?.primary ?? '') ? parseInt(t.colors.primary.slice(1), 16) || 0x3b3b3b : 0x1438d8,
        ...(logo ? { thumbnail: { url: logo } } : {}),
      },
      yes: '✅ Approve',
      no: '❌ Decline',
      link: link('Requests', '/admin/requests'),
    });
  }

  for (const { id, data: c } of data.characters ?? []) {
    const img = media(c.path);
    cards.set(`char:${id}`, {
      embed: {
        title: '🎭 New character for the Home court',
        description: `Posted by **${clean(c.author ?? 'someone', 60)}** in #in-game-characters.`,
        color: 0x7c5cff,
        ...(img ? { image: { url: img } } : {}),
      },
      yes: '✅ Approve',
      no: '❌ Deny',
      link: link('Characters', '/admin/characters'),
    });
  }

  for (const fx of data.fixes ?? []) {
    const { eventId, id, data: fix, fixture, result, event } = fx;
    if (!fixture) continue;
    const home = teamName(fixture.homeTeamId);
    const away = teamName(fixture.awayTeamId);
    const hasScore = Array.isArray(fix.sets) && fix.sets.length > 0;
    const canUse = hasScore && result && !result.forfeit && score(fix.sets) !== score(result.sets);
    const shot = media(fix.screenshotPaths?.[0]);
    cards.set(`fix:${eventId}/${id}`, {
      embed: {
        title: `🛠 Result fix: ${home} v ${away}`,
        description: [
          `From **${name(fix.playerId)}** (${teamName(fix.teamId)}) · ${clean(event?.title ?? '', 60)}`,
          `On the site now: **${score(result?.sets)}**${result?.forfeit ? ' (forfeit)' : ''}`,
          hasScore ? `They say: **${score(fix.sets)}**` : 'No new score (stats or a note only)',
          fix.note ? `> ${clean(fix.note, 300)}` : '',
          fix.screenshotPaths?.length ? `${fix.screenshotPaths.length} screenshot${fix.screenshotPaths.length === 1 ? '' : 's'} attached` : '',
        ].filter(Boolean).join('\n'),
        color: 0xff6b57,
        ...(shot ? { image: { url: shot } } : {}),
      },
      yes: canUse ? '✅ Use this score' : null,
      no: '❌ Close, no change',
      link: link('Open result', `/admin/result/${encodeURIComponent(eventId)}/${encodeURIComponent(fixture.id)}`),
    });
  }

  if (data.statsWaiting > 0) {
    cards.set('stats', {
      embed: {
        title: `📸 ${data.statsWaiting} match${data.statsWaiting === 1 ? '' : 'es'} waiting for a stats check`,
        description: 'Clean ones publish in one click on the site; anything unusual is flagged first.',
        color: 0xffc533,
      },
      link: link('Stats to publish', '/admin/stats'),
    });
  }
  return cards;
}

// A short id for a card key (button custom ids are limited to 100 characters).
export function shortKey(key) {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  return h.toString(36);
}

// The Discord message for a card. done: { text } once it's been dealt with (buttons removed).
export function deskMessage(card, sid, done = null) {
  const buttons = [];
  if (!done && card.yes) buttons.push({ type: 2, style: 3, label: card.yes, custom_id: `desk:yes:${sid}` });
  if (!done && card.no) buttons.push({ type: 2, style: 4, label: card.no, custom_id: `desk:no:${sid}` });
  if (card.link) buttons.push(card.link);
  return {
    embeds: [{ ...card.embed, ...(done ? { footer: { text: done.text }, color: 0x8f9bbd } : {}) }],
    components: buttons.length ? [{ type: 1, components: buttons }] : [],
    allowed_mentions: { parse: [] },
  };
}

// Same content? (so unchanged cards aren't edited every check)
export const cardPrint = (card) => JSON.stringify([card.embed, card.yes, card.no]);

// Transfer hub posts (added 2026-11-21): one Discord message per site transfer news item
// (transfers/{id} { playerId, fromTeamId, toTeamId, kind: joined|left|released|founded|disbanded, at }).
// Pure (tested): builds the message from the transfer, players and teams.

const BLUE = 0x1438d8;

export function colorOf(team) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(team?.colors?.primary ?? '').trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return n || (team ? 0x3b3b3b : BLUE);
}

// A Firebase Storage path -> its public address.
export const storageUrl = (bucket, path) => (bucket && path ? `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media` : null);

// -> Discord message body { embeds, components } (plain API objects).
export function transferPost(t, { players, teams, siteUrl = '', bucket = '' }) {
  const p = players.get(t.playerId) ?? null;
  const from = t.fromTeamId ? teams.get(t.fromTeamId) ?? { name: 'their old club' } : null;
  const to = t.toTeamId ? teams.get(t.toTeamId) ?? { name: 'a new club' } : null;
  const who = p?.displayName ?? 'A player';
  const b = (s) => `**${String(s).replace(/[*_`~|>]/g, '')}**`;
  let title;
  let line;
  let club;
  switch (t.kind) {
    case 'joined':
      title = '📥 Signed';
      line = `${b(who)} joined ${b(to?.name)}${from ? ` from ${b(from.name)}` : ''}.`;
      club = to;
      break;
    case 'left':
      title = '📤 Left';
      line = `${b(who)} left ${b(from?.name)} and is now a free agent.`;
      club = from;
      break;
    case 'released':
      title = '✂️ Released';
      line = `${b(from?.name)} released ${b(who)}.`;
      club = from;
      break;
    case 'founded':
      title = '🆕 New club';
      line = `${b(who)} founded ${b(to?.name)}.`;
      club = to;
      break;
    case 'disbanded':
      title = '💔 Disbanded';
      line = `${b(from?.name ?? to?.name)} has disbanded.`;
      club = from ?? to;
      break;
    default:
      title = '🔁 Transfer';
      line = `${b(who)}: ${b(from?.name ?? 'free agent')} → ${b(to?.name ?? 'free agent')}`;
      club = to ?? from;
  }
  const clubId = club === to ? t.toTeamId : t.fromTeamId;
  const avatar = storageUrl(bucket, p?.avatarPath) ?? (/^https:\/\//.test(p?.avatarUrl ?? '') ? p.avatarUrl : null);
  const logo = storageUrl(bucket, club?.logoPath);
  const embed = {
    title,
    description: line,
    color: colorOf(club),
    ...(avatar && t.kind !== 'disbanded' ? { author: { name: who, icon_url: avatar } } : {}),
    ...(logo ? { thumbnail: { url: logo } } : {}),
    footer: { text: 'I<3JVO transfer news' },
    ...(Number.isFinite(t.at) ? { timestamp: new Date(t.at).toISOString() } : {}),
  };
  const buttons = [];
  if (siteUrl && p && t.playerId && t.kind !== 'disbanded') buttons.push({ type: 2, style: 5, label: who.slice(0, 70), url: `${siteUrl}/player/${encodeURIComponent(t.playerId)}` });
  if (siteUrl && clubId && club?.name) buttons.push({ type: 2, style: 5, label: club.name.slice(0, 70), url: `${siteUrl}/team/${encodeURIComponent(clubId)}` });
  return { embeds: [embed], components: buttons.length ? [{ type: 1, components: buttons }] : [], allowed_mentions: { parse: [] } };
}

// Which transfers still need posting, oldest first. seen: Set of posted ids.
export function toPost(transfers, seen) {
  return transfers.filter((t) => !seen.has(t.id)).sort((a, b) => (a.data.at ?? 0) - (b.data.at ?? 0));
}

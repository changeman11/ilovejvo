// Event winner roles (added 2026-11-21): an event can give its winners a Discord role, chosen in the
// event form (event.winnerRole = { preset, name? }). The bot (bot/src/winner-roles.js) makes the role
// and gives it to every player of the winning team (rules/champions.js) once the event is decided.
// Pure, shared with the bot (bot/src/site-rules/).

// {event} = the event's title.
export const WINNER_ROLE_PRESETS = {
  off: { label: 'No winner role', name: null },
  champion: { label: '🏆 {event} Champion', name: '🏆 {event} Champion' },
  champions: { label: '👑 {event} Champions', name: '👑 {event} Champions' },
  winner: { label: '🥇 {event} Winner', name: '🥇 {event} Winner' },
  cup: { label: '🏐 Cup Winner (one role for every cup)', name: '🏐 Cup Winner' },
  custom: { label: 'Custom name…', name: null },
};

// The role name for an event, or null (no role). Discord allows 100 characters.
export function winnerRoleName(event) {
  const w = event?.winnerRole;
  if (!w || !WINNER_ROLE_PRESETS[w.preset] || w.preset === 'off') return null;
  const template = w.preset === 'custom' ? String(w.name ?? '').trim() : WINNER_ROLE_PRESETS[w.preset].name;
  if (!template) return null;
  const title = String(event.title ?? 'Event').trim();
  return template.replace(/\{event\}/g, title).slice(0, 100);
}

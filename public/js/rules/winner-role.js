// Event winner roles (added 2026-11-21): an event can give its winners a Discord role, chosen in the
// event form (event.winnerRole = { preset, name? }). The bot (bot/src/winner-roles.js) makes the role
// and gives it to every player of the winning team (rules/champions.js) once the event is decided.
// Pure, shared with the bot (bot/src/site-rules/).

// {event} = the event's title.
export const WINNER_ROLE_PRESETS = {
  off: { label: 'No winner role', name: null },
  // Counts up (2026-11-26): a player's role shows how many of these events they've won.
  tally: { label: '🏆 1x / 2x / 3x Tournament Champion (counts up)', name: null, tally: true },
  champion: { label: '🏆 {event} Champion', name: '🏆 {event} Champion' },
  champions: { label: '👑 {event} Champions', name: '👑 {event} Champions' },
  winner: { label: '🥇 {event} Winner', name: '🥇 {event} Winner' },
  cup: { label: '🏐 Cup Winner (one role for every cup)', name: '🏐 Cup Winner' },
  custom: { label: 'Custom name…', name: null },
};

// Count-up role name for n wins: "🏆 2x Tournament Champion".
export const tallyRoleName = (n) => `🏆 ${n}x Tournament Champion`;
export const isTallyEvent = (event) => event?.winnerRole?.preset === 'tally';

// The role name for an event, or null (no role, or a count-up one: tallyRoleName). Discord allows 100 characters.
export function winnerRoleName(event) {
  const w = event?.winnerRole;
  if (!w || !WINNER_ROLE_PRESETS[w.preset] || w.preset === 'off' || w.preset === 'tally') return null;
  const template = w.preset === 'custom' ? String(w.name ?? '').trim() : WINNER_ROLE_PRESETS[w.preset].name;
  if (!template) return null;
  const title = String(event.title ?? 'Event').trim();
  return template.replace(/\{event\}/g, title).slice(0, 100);
}

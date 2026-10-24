// Each stat's identity, shared by the site's Stats page and the bot's award (top-3) roles
// (copied to bot/src/site-rules/ by scripts/sync-bot-rules.mjs): a readable name, the award
// title the leaders hold, an emoji and a colour (with a second colour for gradients). ink: dark
// text reads better on it (light colours).
export const STAT_STYLE = {
  pts: { name: 'Points', title: 'Point Machine', emoji: '👑', color: 0xffc533, color2: 0xff8a00, ink: true, blurb: 'Every point they won' },
  spk: { name: 'Spikes', title: 'Spike Royalty', emoji: '💥', color: 0xff4f3f, color2: 0xff9a3c, blurb: 'Points from attacks' },
  blk: { name: 'Blocks', title: 'The Wall', emoji: '🧱', color: 0x8f9bbd, color2: 0x5865f2, blurb: 'Shut down at the net' },
  rec: { name: 'Receives', title: 'Receive Master', emoji: '🛡️', color: 0x19c9b1, color2: 0x39b6ff, blurb: 'Serves taken cleanly' },
  set: { name: 'Sets', title: 'Set Wizard', emoji: '🪄', color: 0x7c5cff, color2: 0xe24a7c, blurb: 'Balls set up' },
  ast: { name: 'Assists', title: 'Playmaker', emoji: '🤝', color: 0x39b6ff, color2: 0x19c9b1, blurb: 'Sets that became points' },
  ace: { name: 'Aces', title: 'Ace Sniper', emoji: '🎯', color: 0xff6b57, color2: 0xffe200, blurb: 'Serves nobody returned' },
  dig: { name: 'Digs', title: 'Dig Demon', emoji: '😈', color: 0x2fd27a, color2: 0x19c9b1, blurb: 'Spikes kept alive' },
  mvps: { name: 'MVPs', title: 'Most Valuable', emoji: '⭐', color: 0xffe200, color2: 0xffc533, ink: true, blurb: 'Player of the match' },
};

export const statStyle = (key, fallbackName = key) => STAT_STYLE[key] ?? { name: fallbackName, title: fallbackName, emoji: '🏐', color: 0x1438d8, color2: 0x39b6ff, blurb: '' };
export const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

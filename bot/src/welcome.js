// Welcomes new members in WELCOME_CHANNEL_ID and points them to the I<3JVO site (make a profile
// with Discord sign-in, pickup games, FAQ). No discord.js here: index.js calls welcomeMember().

const ROW = 1;
const BUTTON = 2;
const LINK = 5;
const TEAL = 0x16b3a3;

// member: { id, name, bot }. Returns the message, or null when there's nothing to post.
export function welcomeMessage(member, config) {
  if (!member || member.bot) return null;
  const site = config.siteUrl;
  const link = (label, path, emoji) => ({ type: BUTTON, style: LINK, label, url: `${site}${path}`, emoji: { name: emoji } });
  return {
    content: `👋 Welcome to Just Volleyball Oceania, <@${member.id}>!`,
    embeds: [
      {
        title: '🏐 Welcome to JVO!',
        color: TEAL,
        description: site
          ? [
              `**Connect to the I<3JVO site** with your Discord: it takes a few seconds and gives you a profile with your stats, badges and club.`,
              '',
              `➡️ **${site}/me**`,
              '',
              `Then jump into **pickup games** and **1v1 ranked**, or read the FAQ & rules.`,
            ].join('\n')
          : 'Glad to have you here. Say hi and jump into a pickup game!',
        thumbnail: site ? { url: `${site}/icons/icon-192.png` } : undefined,
      },
    ],
    components: site
      ? [{ type: ROW, components: [link('Make your profile', '/me', '✨'), link('Pickup games', '/pickup', '🏐'), link('FAQ & rules', '/help', '❓')] }]
      : [],
    allowedMentions: { users: [member.id] },
  };
}

// Posts the welcome. io: { post(message, channelId) }. Never throws (a failed welcome is just logged).
export async function welcomeMember(member, { io, config, log = console }) {
  if (!config.welcomeChannelId) return false;
  const message = welcomeMessage(member, config);
  if (!message) return false;
  try {
    await io.post(message, config.welcomeChannelId);
    log.info?.(`[welcome] welcomed ${member.name}`);
    return true;
  } catch (err) {
    log.warn(`[welcome] could not welcome ${member.name}: ${err.message}`);
    return false;
  }
}

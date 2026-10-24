// Checks, before logging in, whether the "Server Members Intent" is switched on for the bot in the
// Developer Portal (the app's flags say so). Asking for it while it's off makes Discord refuse the
// whole login, so the bot only asks when it's on.
const GATEWAY_GUILD_MEMBERS = 1 << 14;
const GATEWAY_GUILD_MEMBERS_LIMITED = 1 << 15;

export function membersIntentOn(flags) {
  return Boolean((flags ?? 0) & (GATEWAY_GUILD_MEMBERS | GATEWAY_GUILD_MEMBERS_LIMITED));
}

// "Message Content Intent": without it Discord hides what people post (so the bot can't see
// screenshots in match threads). Reading messages needs only the switch, not the gateway intent.
const GATEWAY_MESSAGE_CONTENT = 1 << 18;
const GATEWAY_MESSAGE_CONTENT_LIMITED = 1 << 19;
export const messageContentOn = (flags) => Boolean((flags ?? 0) & (GATEWAY_MESSAGE_CONTENT | GATEWAY_MESSAGE_CONTENT_LIMITED));

export async function checkMessageContent(token, fetchFn = globalThis.fetch) {
  try {
    const res = await fetchFn('https://discord.com/api/v10/applications/@me', { headers: { authorization: `Bot ${token}` } });
    return res.ok && messageContentOn((await res.json()).flags);
  } catch {
    return false;
  }
}

export async function checkMembersIntent(token, fetchFn = globalThis.fetch) {
  try {
    const res = await fetchFn('https://discord.com/api/v10/applications/@me', { headers: { authorization: `Bot ${token}` } });
    if (!res.ok) return false;
    return membersIntentOn((await res.json()).flags);
  } catch {
    return false;
  }
}

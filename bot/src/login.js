// Checks, before logging in, whether the "Server Members Intent" is switched on for the bot in the
// Developer Portal (the app's flags say so). Asking for it while it's off makes Discord refuse the
// whole login, so the bot only asks when it's on.
const GATEWAY_GUILD_MEMBERS = 1 << 14;
const GATEWAY_GUILD_MEMBERS_LIMITED = 1 << 15;

export function membersIntentOn(flags) {
  return Boolean((flags ?? 0) & (GATEWAY_GUILD_MEMBERS | GATEWAY_GUILD_MEMBERS_LIMITED));
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

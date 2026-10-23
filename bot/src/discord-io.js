// The Discord side of `io` (see pickup.js): posting messages, making and removing the locked
// voice channels, and moving people. Also checks the bot has the permissions it needs and tidies
// up ready-up channels left over from a crash.
import { ChannelType, OverwriteType, PermissionFlagsBits as P } from 'discord.js';
import { LOBBY_PREFIX } from './views.js';

export async function setupDiscord(client, config, log = console) {
  const guild = await client.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) throw new Error(`The bot isn't in the server GUILD_ID=${config.guildId}. Invite it first (BOT-SETUP.md, Part 2).`);
  const text = await guild.channels.fetch(config.pickupChannelId).catch(() => null);
  if (!text?.isTextBased()) throw new Error(`PICKUP_CHANNEL_ID (${config.pickupChannelId}) isn't a text channel in ${guild.name}.`);
  await guild.channels.fetch(); // fill the cache so channels can be found by name
  const me = await guild.members.fetchMe();

  const categoryId = config.teamCategoryId || text.parentId || null;
  const category = categoryId ? await guild.channels.fetch(categoryId).catch(() => null) : null;
  if (config.teamCategoryId && category?.type !== ChannelType.GuildCategory) {
    throw new Error(`TEAM_CATEGORY_ID (${config.teamCategoryId}) isn't a category in ${guild.name}.`);
  }

  // Admin roles that don't exist would make every locked channel fail, so leave them out.
  const adminRoles = config.adminRoleIds.filter((id) => {
    if (guild.roles.cache.has(id)) return true;
    log.warn(`⚠️  ADMIN_ROLE_IDS: there's no role ${id} in ${guild.name}, so it's ignored.`);
    return false;
  });

  const check = (where, perms, label) => {
    const have = where.permissionsFor ? where.permissionsFor(me) : me.permissions;
    const missing = perms.filter((p) => !have?.has(P[p]));
    if (missing.length) log.warn(`⚠️  The bot is missing ${missing.join(', ')} in ${label}. See BOT-SETUP.md, Part 3.`);
  };
  check(text, ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'], `#${text.name}`);
  check(category ?? guild, ['ViewChannel', 'ManageChannels', 'Connect', 'MoveMembers'], category ? `the ${category.name} category` : 'the server');
  // Locked channels can only grant permissions the bot has server-wide.
  check(guild, ['ViewChannel', 'Connect'], 'its server role');

  // Locked = everyone can see it, but only these players, admins and the bot can join.
  const lockedOverwrites = (allow) => [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.Connect] },
    { id: me.id, type: OverwriteType.Member, allow: [P.ViewChannel, P.Connect] },
    ...adminRoles.map((id) => ({ id, type: OverwriteType.Role, allow: [P.ViewChannel, P.Connect] })),
    ...allow.map((id) => ({ id, type: OverwriteType.Member, allow: [P.ViewChannel, P.Connect] })),
  ];

  const io = {
    async post(message) {
      return (await text.send(message)).id;
    },
    async edit(messageId, message) {
      await text.messages.edit(messageId, message);
    },
    async remove(messageId) {
      await text.messages.delete(messageId);
    },
    async createVoice(name, { allow = [] } = {}) {
      const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        parent: category?.id,
        permissionOverwrites: lockedOverwrites(allow),
        reason: 'Pickup game',
      });
      return channel.id;
    },
    async deleteChannel(channelId) {
      await guild.channels.delete(channelId, 'Pickup game finished');
    },
    async channelSize(channelId) {
      if (!guild.channels.cache.has(channelId)) return -1;
      return guild.voiceStates.cache.filter((s) => s.channelId === channelId).size;
    },
    async move(userId, channelId) {
      if (!guild.voiceStates.cache.get(userId)?.channelId) return false;
      await guild.members.edit(userId, { channel: channelId });
      return true;
    },
  };

  // Ready-up channels left over from a crash or restart (nobody can be in a ready check after a
  // restart). Only voice channels in the bot's own category with the bot's name pattern.
  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildVoice) continue;
    if (channel.parentId !== (category?.id ?? null) || !channel.name.startsWith(LOBBY_PREFIX)) continue;
    await channel.delete('Leftover pickup ready-up channel').catch((err) => log.warn(`Couldn't delete ${channel.name}: ${err.message}`));
    log.info?.(`Removed a leftover ready-up channel (${channel.name}).`);
  }

  return { guild, text, category, io };
}

// Admins: anyone with Manage Server, or one of ADMIN_ROLE_IDS.
export function isAdmin(interaction, config) {
  if (interaction.memberPermissions?.has(P.ManageGuild)) return true;
  const roles = interaction.member?.roles;
  const ids = Array.isArray(roles) ? roles : [...(roles?.cache?.keys() ?? [])];
  return ids.some((id) => config.adminRoleIds.includes(id));
}

// The Discord side of `io` (see pickup.js): posting messages, making and removing the locked
// voice channels, and moving people. Also checks the bot has the permissions it needs and tidies
// up ready-up channels left over from a crash.
import { ChannelType, OverwriteType, PermissionFlagsBits as P } from 'discord.js';
import { LOBBY_PREFIX, CHAT_PREFIX } from './views.js';

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
  if (config.clubRoles) check(guild, ['ManageRoles'], 'its server role (needed for club roles)');

  // Locked = everyone can see it, but only these players, admins and the bot can join.
  const lockedOverwrites = (allow) => [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.Connect] },
    { id: me.id, type: OverwriteType.Member, allow: [P.ViewChannel, P.Connect] },
    ...adminRoles.map((id) => ({ id, type: OverwriteType.Role, allow: [P.ViewChannel, P.Connect] })),
    ...allow.map((id) => ({ id, type: OverwriteType.Member, allow: [P.ViewChannel, P.Connect] })),
  ];
  // Locked chat = hidden from everyone except these players, admins and the bot.
  const TALK = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory];
  const chatOverwrites = (allow) => [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.ViewChannel] },
    { id: me.id, type: OverwriteType.Member, allow: [...TALK, P.EmbedLinks] },
    ...adminRoles.map((id) => ({ id, type: OverwriteType.Role, allow: TALK })),
    ...allow.map((id) => ({ id, type: OverwriteType.Member, allow: TALK })),
  ];
  const channelFor = async (channelId) => (channelId ? guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId)) : text);

  const io = {
    async post(message, channelId) {
      return (await (await channelFor(channelId)).send(message)).id;
    },
    async edit(messageId, message, channelId) {
      await (await channelFor(channelId)).messages.edit(messageId, message);
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
    async createText(name, { allow = [] } = {}) {
      const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: category?.id,
        permissionOverwrites: chatOverwrites(allow),
        reason: 'Pickup match chat',
      });
      return channel.id;
    },
    async renameChannel(channelId, name) {
      await guild.channels.edit(channelId, { name, reason: 'Pickup game started' });
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
    const leftover = (channel.type === ChannelType.GuildVoice && channel.name.startsWith(LOBBY_PREFIX))
      || (channel.type === ChannelType.GuildText && channel.name.startsWith(CHAT_PREFIX));
    if (!leftover || channel.parentId !== (category?.id ?? null)) continue;
    await channel.delete('Leftover pickup ready-up channel').catch((err) => log.warn(`Couldn't delete ${channel.name}: ${err.message}`));
    log.info?.(`Removed a leftover ready-up channel (${channel.name}).`);
  }

  // Club roles (club-roles.js). Roles are made just under the bot's own role so their colour
  // shows; the bot can only manage roles below its own.
  const roleIo = {
    async roles() {
      const all = await guild.roles.fetch();
      return new Map(all.map((r) => [r.id, { name: r.name, color: r.colors?.primaryColor ?? r.color ?? 0, hoist: r.hoist }]));
    },
    async createRole({ name, color, hoist }) {
      const role = await guild.roles.create({ name, colors: { primaryColor: color }, hoist, mentionable: false, permissions: [], reason: 'I<3JVO club role' });
      const top = (await guild.members.fetchMe({ force: true })).roles.highest;
      await guild.roles.setPosition(role, Math.max(1, top.position - 1)).catch((err) => log.warn(`Couldn't move the ${name} role up: ${err.message}`));
      return role.id;
    },
    async editRole(roleId, { name, color, hoist }) {
      await guild.roles.edit(roleId, { name, colors: { primaryColor: color }, hoist, reason: 'I<3JVO club changed' });
    },
    async deleteRole(roleId) {
      await guild.roles.delete(roleId, 'I<3JVO club no longer active');
    },
    async memberRoles(userId) {
      try {
        const member = await guild.members.fetch({ user: userId, force: true });
        return new Set(member.roles.cache.keys());
      } catch (err) {
        if (err.code === 10007 || err.code === 10013) return null; // not in this server
        throw err;
      }
    },
    async addRole(userId, roleId) {
      await guild.members.addRole({ user: userId, role: roleId, reason: 'I<3JVO club' });
    },
    async removeRole(userId, roleId) {
      await guild.members.removeRole({ user: userId, role: roleId, reason: 'I<3JVO club changed' });
    },
  };

  return { guild, text, category, io, roleIo };
}

// Admins: anyone with Manage Server, or one of ADMIN_ROLE_IDS.
export function isAdmin(interaction, config) {
  if (interaction.memberPermissions?.has(P.ManageGuild)) return true;
  const roles = interaction.member?.roles;
  const ids = Array.isArray(roles) ? roles : [...(roles?.cache?.keys() ?? [])];
  return ids.some((id) => config.adminRoleIds.includes(id));
}

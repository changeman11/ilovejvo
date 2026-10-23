// The Discord side of `io` (see pickup.js): posting messages, making and removing the locked
// voice channels, and moving people. Also checks the bot has the permissions it needs, makes the
// queue channel if there isn't one, and tidies up ready-up channels left over from a crash.
import { ChannelType, OverwriteType, PermissionFlagsBits as P } from 'discord.js';
import { QUEUE_CHANNEL_NAME, LOBBY_PREFIX } from './views.js';

export async function setupDiscord(client, config, log = console) {
  const guild = await client.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) throw new Error(`The bot isn't in the server GUILD_ID=${config.guildId}. Invite it first (BOT-SETUP.md, Part 2).`);
  const text = await guild.channels.fetch(config.pickupChannelId).catch(() => null);
  if (!text?.isTextBased()) throw new Error(`PICKUP_CHANNEL_ID (${config.pickupChannelId}) isn't a text channel in ${guild.name}.`);
  await guild.channels.fetch(); // fill the cache so channels can be found by name
  const me = await guild.members.fetchMe();

  // The open queue channel: the one in QUEUE_CHANNEL_ID, or "🏐 pickup queue" (made if missing).
  let queue;
  if (config.queueChannelId) {
    queue = await guild.channels.fetch(config.queueChannelId).catch(() => null);
    if (queue?.type !== ChannelType.GuildVoice) throw new Error(`QUEUE_CHANNEL_ID (${config.queueChannelId}) isn't a voice channel in ${guild.name}.`);
  } else {
    const parentId = config.teamCategoryId || text.parentId || null;
    queue = guild.channels.cache.find((c) => c.type === ChannelType.GuildVoice && c.name === QUEUE_CHANNEL_NAME && c.parentId === parentId);
    if (!queue) {
      queue = await guild.channels.create({ name: QUEUE_CHANNEL_NAME, type: ChannelType.GuildVoice, parent: parentId ?? undefined, reason: 'Pickup queue' });
      log.info?.(`Made the queue voice channel "${QUEUE_CHANNEL_NAME}" (id ${queue.id}).`);
    }
    config.queueChannelId = queue.id;
  }

  const categoryId = config.teamCategoryId || queue.parentId || null;
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
  check(queue, ['ViewChannel', 'Connect', 'MoveMembers'], `the queue channel (${queue.name})`);
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
    async where(userId) {
      return guild.voiceStates.cache.get(userId)?.channelId ?? null;
    },
    async disconnect(userId) {
      await guild.members.edit(userId, { channel: null });
    },
  };

  // Ready-up channels left over from a crash or restart: move anyone in them back to the queue,
  // then delete them. Only voice channels in the bot's own category with the bot's name pattern.
  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildVoice || channel.id === queue.id) continue;
    if (channel.parentId !== (category?.id ?? null) || !channel.name.startsWith(LOBBY_PREFIX)) continue;
    for (const state of guild.voiceStates.cache.filter((s) => s.channelId === channel.id).values()) {
      await guild.members.edit(state.id, { channel: queue.id }).catch(() => {});
    }
    await channel.delete('Leftover pickup ready-up channel').catch((err) => log.warn(`Couldn't delete ${channel.name}: ${err.message}`));
    log.info?.(`Removed a leftover ready-up channel (${channel.name}).`);
  }

  // People already in the queue channel.
  const members = [];
  for (const state of guild.voiceStates.cache.values()) {
    if (state.channelId !== queue.id) continue;
    const member = state.member ?? (await guild.members.fetch(state.id).catch(() => null));
    if (member && !member.user.bot) members.push({ id: member.id, name: member.displayName });
  }

  return { guild, queue, text, category, io, members };
}

// Admins: anyone with Manage Server, or one of ADMIN_ROLE_IDS.
export function isAdmin(interaction, config) {
  if (interaction.memberPermissions?.has(P.ManageGuild)) return true;
  const roles = interaction.member?.roles;
  const ids = Array.isArray(roles) ? roles : [...(roles?.cache?.keys() ?? [])];
  return ids.some((id) => config.adminRoleIds.includes(id));
}

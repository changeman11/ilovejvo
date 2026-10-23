// The Discord side of `io` (see pickup.js): posting messages, making and removing the team voice
// channels, and moving people. Also checks the bot has the permissions it needs.
import { ChannelType, PermissionFlagsBits } from 'discord.js';

export async function setupDiscord(client, config, log = console) {
  const guild = await client.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) throw new Error(`The bot isn't in the server GUILD_ID=${config.guildId}. Invite it first (BOT-SETUP.md, Part 2).`);
  const queue = await guild.channels.fetch(config.queueChannelId).catch(() => null);
  if (queue?.type !== ChannelType.GuildVoice) throw new Error(`QUEUE_CHANNEL_ID (${config.queueChannelId}) isn't a voice channel in ${guild.name}.`);
  const text = await guild.channels.fetch(config.pickupChannelId).catch(() => null);
  if (!text?.isTextBased()) throw new Error(`PICKUP_CHANNEL_ID (${config.pickupChannelId}) isn't a text channel in ${guild.name}.`);
  const categoryId = config.teamCategoryId || queue.parentId || null;
  const category = categoryId ? await guild.channels.fetch(categoryId).catch(() => null) : null;
  if (config.teamCategoryId && category?.type !== ChannelType.GuildCategory) {
    throw new Error(`TEAM_CATEGORY_ID (${config.teamCategoryId}) isn't a category in ${guild.name}.`);
  }

  const me = await guild.members.fetchMe();
  const check = (where, perms, label) => {
    const have = where.permissionsFor ? where.permissionsFor(me) : me.permissions;
    const missing = perms.filter((p) => !have?.has(PermissionFlagsBits[p]));
    if (missing.length) log.warn(`⚠️  The bot is missing ${missing.join(', ')} in ${label}. See BOT-SETUP.md, Part 3.`);
  };
  check(queue, ['ViewChannel', 'Connect', 'MoveMembers'], `the ready-up channel (${queue.name})`);
  check(text, ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'], `#${text.name}`);
  check(category ?? guild, ['ViewChannel', 'ManageChannels', 'Connect', 'MoveMembers'], category ? `the ${category.name} category` : 'the server');

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
    async createVoice(name) {
      const channel = await guild.channels.create({ name, type: ChannelType.GuildVoice, parent: category?.id, reason: 'Pickup game team channel' });
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

  // People already in the ready-up channel.
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
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const roles = interaction.member?.roles;
  const ids = Array.isArray(roles) ? roles : [...(roles?.cache?.keys() ?? [])];
  return ids.some((id) => config.adminRoleIds.includes(id));
}

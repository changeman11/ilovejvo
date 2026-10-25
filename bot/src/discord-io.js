// The Discord side of `io` (see pickup.js): posting messages, making and removing the locked
// voice channels, and moving people. Also checks the bot has the permissions it needs and tidies
// up ready-up channels left over from a crash.
import { ChannelType, OverwriteType, PermissionFlagsBits as P } from 'discord.js';
import { LOBBY_PREFIX, CHAT_PREFIX } from './views.js';
import { VOICE_PREFIX as RANKED_VOICE_PREFIX, TEXT_PREFIX as RANKED_TEXT_PREFIX } from './ranked-views.js';

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
  if (config.clubRoles || config.statRoles) check(guild, ['ManageRoles'], 'its server role (needed for club and stat roles)');

  // Locked = everyone can see it, but only these players, admins and the bot can join.
  // roles: who else can get in (admins for pickup games, staff for 1v1s).
  const lockedOverwrites = (allow, roles = adminRoles) => [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.Connect] },
    { id: me.id, type: OverwriteType.Member, allow: [P.ViewChannel, P.Connect] },
    ...roles.map((id) => ({ id, type: OverwriteType.Role, allow: [P.ViewChannel, P.Connect] })),
    ...allow.map((id) => ({ id, type: OverwriteType.Member, allow: [P.ViewChannel, P.Connect] })),
  ];
  // Locked chat = hidden from everyone except these players, admins and the bot.
  const TALK = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.SendMessagesInThreads, P.AttachFiles];
  const chatOverwrites = (allow, roles = adminRoles) => [
    { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.ViewChannel] },
    { id: me.id, type: OverwriteType.Member, allow: [...TALK, P.EmbedLinks, P.CreatePublicThreads, P.ManageThreads] },
    ...roles.map((id) => ({ id, type: OverwriteType.Role, allow: TALK })),
    ...allow.map((id) => ({ id, type: OverwriteType.Member, allow: TALK })),
  ];
  const channelFor = async (channelId) => (channelId ? guild.channels.cache.get(channelId) ?? (await client.channels.fetch(channelId)) : text);

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
    async createVoice(name, { allow = [], roles } = {}) {
      const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildVoice,
        parent: category?.id,
        permissionOverwrites: lockedOverwrites(allow, roles),
        reason: 'Pickup game',
      });
      return channel.id;
    },
    async createText(name, { allow = [], roles } = {}) {
      const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: category?.id,
        permissionOverwrites: chatOverwrites(allow, roles),
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
      || (channel.type === ChannelType.GuildText && channel.name.startsWith(CHAT_PREFIX))
      || (config.ranked && channel.type === ChannelType.GuildVoice && channel.name.startsWith(RANKED_VOICE_PREFIX))
      || (config.ranked && channel.type === ChannelType.GuildText && channel.name.startsWith(RANKED_TEXT_PREFIX));
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
    // The server's boost features (ROLE_ICONS, ENHANCED_ROLE_COLORS...).
    async features() {
      return [...(guild.features ?? [])];
    },
    // color2: a gradient (needs ENHANCED_ROLE_COLORS); emoji: a role icon (needs ROLE_ICONS).
    async createRole({ name, color, color2, emoji, hoist }) {
      const role = await guild.roles.create({ name, colors: { primaryColor: color, ...(color2 ? { secondaryColor: color2 } : {}) }, ...(emoji ? { unicodeEmoji: emoji } : {}), hoist, mentionable: false, permissions: [], reason: 'I<3JVO role' });
      const top = (await guild.members.fetchMe({ force: true })).roles.highest;
      await guild.roles.setPosition(role, Math.max(1, top.position - 1)).catch((err) => log.warn(`Couldn't move the ${name} role up: ${err.message}`));
      return role.id;
    },
    async editRole(roleId, { name, color, color2, emoji, hoist }) {
      await guild.roles.edit(roleId, { name, colors: { primaryColor: color, ...(color2 ? { secondaryColor: color2 } : {}) }, ...(emoji ? { unicodeEmoji: emoji } : {}), hoist, reason: 'I<3JVO role changed' });
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

  // ---------- 1v1 ranked (ranked.js) ----------
  let rankedIo = null;
  if (config.ranked) {
    const staffRoles = config.staffRoleIds.filter((id) => {
      if (guild.roles.cache.has(id)) return true;
      log.warn(`⚠️  STAFF_ROLE_IDS: there's no role ${id}, so it's ignored.`);
      return false;
    });
    config.staffRoleIds = staffRoles;
    if (!staffRoles.length) log.warn('⚠️  No staff role for 1v1 results: set STAFF_ROLE_IDS (only server admins will see the results channel).');
    const findOrMake = async (configured, name, overwrites) => {
      if (configured) {
        const ch = await guild.channels.fetch(configured).catch(() => null);
        if (ch?.isTextBased()) return ch;
        log.warn(`⚠️  Channel ${configured} for ${name} wasn't found; making #${name}.`);
      }
      const found = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === name && c.parentId === (category?.id ?? null));
      if (found) return found;
      const made = await guild.channels.create({ name, type: ChannelType.GuildText, parent: category?.id, permissionOverwrites: overwrites, reason: '1v1 ranked' });
      log.info?.(`Made #${name} (id ${made.id}).`);
      return made;
    };
    const BOT_POST = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory];
    // The queue channel: everyone sees it and presses the buttons; only the bot posts.
    const queueChannel = await findOrMake(config.rankedChannelId, '1v1-queue', [
      { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.SendMessages] },
      { id: me.id, type: OverwriteType.Member, allow: BOT_POST },
    ]);
    // The results channel: staff only.
    const resultsChannel = await findOrMake(config.rankedResultsChannelId, '1v1-results', [
      { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.ViewChannel] },
      { id: me.id, type: OverwriteType.Member, allow: BOT_POST },
      ...staffRoles.map((id) => ({ id, type: OverwriteType.Role, allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages] })),
    ]);
    config.rankedChannelId = queueChannel.id;
    config.rankedResultsChannelId = resultsChannel.id;
    rankedIo = {
      async post(message, channelId, files = []) {
        const out = files.length ? { ...message, files: files.map((f) => ({ attachment: f.data, name: f.name })) } : message;
        return (await (await channelFor(channelId)).send(out)).id;
      },
      edit: io.edit,
      async remove(messageId, channelId) {
        await (await channelFor(channelId)).messages.delete(messageId);
      },
      createVoice: io.createVoice,
      createText: io.createText,
      async createThread(channelId, name) {
        const parent = await channelFor(channelId);
        const thread = await parent.threads.create({ name, autoArchiveDuration: 1440, type: ChannelType.PublicThread, reason: '1v1 result thread' });
        return thread.id;
      },
      async deleteChannel(channelId) {
        const ch = guild.channels.cache.get(channelId) ?? (await client.channels.fetch(channelId).catch(() => null));
        if (ch) await ch.delete('1v1 fixture finished');
      },
      async where(userId) {
        return guild.voiceStates.cache.get(userId)?.channelId ?? null;
      },
      async download(url) {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`download failed (${res.status})`);
        const data = Buffer.from(await res.arrayBuffer());
        if (data.length > 10 * 1024 * 1024) throw new Error('screenshot over 10 MB');
        return data;
      },
    };
  }

  // ---------- Match threads (matches.js) ----------
  // One text channel (MATCH_CHANNEL_ID, or #match-threads made in the bot's category) where the
  // bot starts a public thread per match. Everyone can read and talk in the threads; only the bot
  // posts in the channel itself.
  let matchIo = null;
  if (config.matchThreads) {
    let channel = config.matchChannelId ? await guild.channels.fetch(config.matchChannelId).catch(() => null) : null;
    if (config.matchChannelId && !channel?.isTextBased()) log.warn(`⚠️  MATCH_CHANNEL_ID (${config.matchChannelId}) isn't a text channel; making #match-threads.`);
    if (!channel?.isTextBased() || channel.type !== ChannelType.GuildText) {
      channel = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === 'match-threads')
        ?? await guild.channels.create({
          name: 'match-threads',
          type: ChannelType.GuildText,
          parent: category?.id,
          topic: 'A thread for every I<3JVO match: vote on the score and post your screenshots there.',
          permissionOverwrites: [
            { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [P.SendMessages, P.CreatePublicThreads, P.CreatePrivateThreads], allow: [P.SendMessagesInThreads] },
            { id: me.id, type: OverwriteType.Member, allow: [P.ViewChannel, P.SendMessages, P.SendMessagesInThreads, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory, P.CreatePublicThreads, P.ManageThreads, P.MentionEveryone] },
          ],
          reason: 'I<3JVO match threads',
        });
    }
    check(channel, ['ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'ManageThreads', 'EmbedLinks', 'AttachFiles'], `#${channel.name}`);
    matchIo = {
      guildId: guild.id,
      channelId: channel.id,
      async createThread(name) {
        const thread = await channel.threads.create({ name, autoArchiveDuration: 1440, type: ChannelType.PublicThread, reason: 'I<3JVO match thread' });
        return thread.id;
      },
      async post(message, threadId, files = []) {
        const out = files.length ? { ...message, files: files.map((f) => ({ attachment: f.data, name: f.name })) } : message;
        return (await (await channelFor(threadId)).send(out)).id;
      },
      // files: replace the message's attachments with these (none given = leave them as they are).
      async edit(messageId, message, threadId, files = []) {
        const thread = await channelFor(threadId);
        if (thread.archived && !thread.locked) await thread.setArchived(false).catch(() => {});
        const out = files.length ? { ...message, attachments: [], files: files.map((f) => ({ attachment: f.data, name: f.name })) } : message;
        await thread.messages.edit(messageId, out);
      },
      async close(threadId) {
        const thread = await channelFor(threadId).catch(() => null);
        if (!thread) return;
        await thread.setLocked(true, 'Match finished');
        await thread.setArchived(true, 'Match finished');
      },
      // Pictures players posted in a thread (not the bot's own), newest first:
      // [{ url, name, contentType, authorId, messageId }]. Empty without the Message Content switch.
      async threadImages(threadId) {
        const thread = await channelFor(threadId);
        const messages = await thread.messages.fetch({ limit: 100 });
        return [...messages.values()]
          .filter((msg) => !msg.author?.bot)
          .sort((x, y) => y.createdTimestamp - x.createdTimestamp)
          .flatMap((msg) => [...msg.attachments.values()]
            .filter((a) => /^image\/(png|jpeg|webp|gif)$/.test(a.contentType ?? ''))
            .map((a) => ({ url: a.url, name: a.name, contentType: a.contentType, width: a.width ?? null, height: a.height ?? null, authorId: msg.author.id, messageId: msg.id })));
      },
      async reopen(threadId) {
        const thread = await channelFor(threadId);
        await thread.setArchived(false, 'Asking who’s who for the stats');
        await thread.setLocked(false, 'Asking who’s who for the stats');
      },
      async download(url) {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`download failed (${res.status})`);
        const data = Buffer.from(await res.arrayBuffer());
        if (data.length > 10 * 1024 * 1024) throw new Error('screenshot over 10 MB');
        return data;
      },
    };
  }

  // Community characters (characters.js): read #in-game-characters, react, and check staff.
  const charIo = {
    // The channel's id: CHARACTERS_CHANNEL_ID, else the text channel named CHARACTERS_CHANNEL.
    channelId() {
      if (config.charactersChannelId) return config.charactersChannelId;
      return guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === config.charactersChannel)?.id ?? null;
    },
    // Every post, newest first: [{ id, authorId, authorName, postedAt, images: [{ url, contentType, width, height }], crossedBy: [userIds] }]
    // crossedBy: who reacted ❌. Throws if the history couldn't be read in full.
    async posts(channelId) {
      const channel = await client.channels.fetch(channelId);
      const out = [];
      let before;
      for (;;) {
        const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        for (const msg of page.values()) {
          const cross = msg.reactions.cache.find((r) => r.emoji.name === '❌');
          const crossedBy = cross ? [...(await cross.users.fetch()).keys()] : [];
          out.push({
            id: msg.id,
            authorId: msg.author?.id ?? null,
            authorName: msg.member?.displayName ?? msg.author?.globalName ?? msg.author?.username ?? null,
            postedAt: msg.createdTimestamp,
            bot: Boolean(msg.author?.bot),
            images: [...msg.attachments.values()].map((a) => ({ url: a.url, contentType: a.contentType ?? '', width: a.width ?? null, height: a.height ?? null })),
            crossedBy,
          });
        }
        if (page.size < 100) break;
        before = page.last().id;
      }
      return out;
    },
    async react(channelId, messageId, emoji) {
      const channel = await client.channels.fetch(channelId);
      const msg = await channel.messages.fetch(messageId);
      await msg.react(emoji);
    },
    // Takes the bot's own reaction off a post.
    async unreact(channelId, messageId, emoji) {
      const channel = await client.channels.fetch(channelId);
      const msg = await channel.messages.fetch(messageId);
      await msg.reactions.cache.find((r) => r.emoji.name === emoji)?.users.remove(client.user.id);
    },
    // Staff for removing characters: Manage Server, or one of ADMIN_ROLE_IDS / STAFF_ROLE_IDS.
    async isStaff(userId) {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) return false;
      if (member.permissions.has(P.ManageGuild)) return true;
      return member.roles.cache.some((r) => config.adminRoleIds.includes(r.id) || config.staffRoleIds.includes(r.id));
    },
    async download(url) {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length > 15 * 1024 * 1024) throw new Error('picture over 15 MB');
      return data;
    },
  };

  return { guild, text, category, io, roleIo, rankedIo, matchIo, charIo };
}

// Admins: anyone with Manage Server, or one of ADMIN_ROLE_IDS.
export function isAdmin(interaction, config) {
  if (interaction.memberPermissions?.has(P.ManageGuild)) return true;
  const roles = interaction.member?.roles;
  const ids = Array.isArray(roles) ? roles : [...(roles?.cache?.keys() ?? [])];
  return ids.some((id) => config.adminRoleIds.includes(id));
}

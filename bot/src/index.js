// I<3JVO pickup bot. Start it with `npm start` in this folder (settings in .env, see .env.example
// and BOT-SETUP.md).
import { resolve } from 'node:path';
import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { loadConfig, ConfigError } from './config.js';
import { FileStore } from './store/file-store.js';
import { FirestoreStore } from './store/firestore-store.js';
import { Pickup } from './pickup.js';
import { commandList } from './commands.js';
import { setupDiscord, isAdmin } from './discord-io.js';
import { ClubRoles, describe } from './club-roles.js';
import { SiteReader } from './store/firestore-rest.js';
import { SiteQueue, RankedSiteQueue } from './site-queue.js';
import { Ranked } from './ranked.js';
import { welcomeMember } from './welcome.js';
import { MatchThreads } from './matches.js';
import { SiteWatch } from './site-watch.js';
import { StatRoles } from './stat-roles.js';
import { checkMembersIntent } from './login.js';

const log = {
  info: (...a) => console.log(new Date().toISOString(), ...a),
  warn: (...a) => console.warn(new Date().toISOString(), ...a),
  error: (...a) => console.error(new Date().toISOString(), ...a),
};

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}

const store =
  config.store === 'firebase'
    ? new FirestoreStore({ firebase: config.firebase, startRating: config.startRating, log })
    : new FileStore({ path: resolve(config.dataFile), startRating: config.startRating });
try {
  await store.init();
} catch (err) {
  log.error(`Couldn't open the ratings store: ${err.message}`);
  process.exit(1);
}
if (config.store === 'file') log.info(`[store] ratings file: ${resolve(config.dataFile)}`);

// The 1v1 ladder keeps its own ratings and games (rankedRatings / rankedGames).
let rankedStore = null;
if (config.ranked) {
  rankedStore = config.store === 'firebase'
    ? new FirestoreStore({ firebase: config.firebase, startRating: 1000, log, names: { ratings: 'rankedRatings', games: 'rankedGames', meta: 'pickupMeta/ranked' } })
    : new FileStore({ path: resolve(config.dataFile).replace(/pickup\.json$/, 'ranked.json'), startRating: 1000 });
  try {
    await rankedStore.init();
  } catch (err) {
    log.error(`Couldn't open the 1v1 store: ${err.message}`);
    process.exit(1);
  }
}

// Only non-privileged intents: no switches to turn on in the Developer Portal.
// Welcomes need the privileged Server Members intent: only asked for when it's switched on in the
// Developer Portal (otherwise Discord refuses the whole login).
let welcomeOn = false;
if (config.welcomeChannelId) {
  welcomeOn = await checkMembersIntent(config.token);
  if (!welcomeOn) {
    log.warn('⚠️  WELCOME_CHANNEL_ID is set, but "Server Members Intent" is off in the Developer Portal (Bot page), so new members are not welcomed. See BOT-SETUP.md, Part 8.');
    // Check every 5 minutes; once it's switched on, restart (the service starts the bot again,
    // this time with welcomes on). No need to restart by hand.
    setInterval(async () => {
      if (!(await checkMembersIntent(config.token))) return;
      log.info('[welcome] Server Members Intent is now on: restarting to turn welcomes on.');
      process.kill(process.pid, 'SIGTERM');
    }, 5 * 60 * 1000).unref();
  }
}
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, ...(welcomeOn ? [GatewayIntentBits.GuildMembers] : [])] });
let discordIo = null;
let pickup = null;
let clubRoles = null;
let siteQueue = null;
let ranked = null;
let rankedSite = null;
let matches = null;
let matchSite = null;
let statRoles = null;

client.once(Events.ClientReady, async () => {
  try {
    const discord = await setupDiscord(client, config, log);
    discordIo = discord.io;
    if (welcomeOn) log.info(`[welcome] new members are welcomed in <#${config.welcomeChannelId}>`);
    await discord.guild.commands.set(commandList(config));
    // The website queue (sign up / withdraw on the site, live pickup page) needs STORE=firebase.
    if (config.siteQueue) siteQueue = new SiteQueue({ rest: store.rest, firebase: config.firebase, log });
    pickup = new Pickup({ io: discord.io, store, config, log, live: siteQueue });
    siteQueue?.attach(pickup);
    await pickup.start();
    siteQueue?.start();
    if (config.ranked) {
      if (config.siteQueue) rankedSite = new RankedSiteQueue({ rest: rankedStore.rest, firebase: config.firebase, log });
      ranked = new Ranked({ io: discord.rankedIo, store: rankedStore, config, log, live: rankedSite });
      rankedSite?.attach(ranked);
      await ranked.start();
      rankedSite?.start();
      log.info(`[1v1] queue in <#${config.rankedChannelId}>, results in <#${config.rankedResultsChannelId}>`);
    }
    // Match threads: a thread per site match, votes saved to the site (needs STORE=firebase).
    if (config.matchThreads) {
      matchSite = new SiteWatch({ firebase: config.firebase, log, onChange: () => matches?.sync() });
      matches = new MatchThreads({ io: discord.matchIo, site: matchSite, rest: store.rest, config, log });
      matchSite.start();
      await matches.start();
    }
    if (config.clubRoles) {
      const site = new SiteReader({ projectId: config.firebase.projectId, emulator: config.firebase.emulator });
      clubRoles = new ClubRoles({ io: discord.roleIo, site, store, config, log });
      clubRoles.start().catch((err) => log.error(`[club roles] ${err.message}`));
    }
    if (config.statRoles) {
      const site = new SiteReader({ projectId: config.firebase.projectId, emulator: config.firebase.emulator });
      statRoles = new StatRoles({ io: discord.roleIo, site, store, config, log });
      statRoles.start().catch((err) => log.error(`[stat roles] ${err.message}`));
    }
    log.info(`Logged in as ${client.user.tag}. Queue card in #${discord.text.name} (${discord.guild.name}).`);
    if (config.allowTestPlayers) log.info('Test players are ON (/pickup testfill). Turn ALLOW_TEST_PLAYERS off for real games.');
  } catch (err) {
    log.error(`Start-up failed: ${err.message}`);
    await client.destroy();
    process.exit(1);
  }
});

client.on(Events.VoiceStateUpdate, (before, after) => {
  if (!pickup || after.guild.id !== config.guildId) return;
  if (before.channelId === after.channelId) return; // mute, deafen, camera...
  const member = after.member ?? before.member;
  if (member?.user.bot) return;
  // A locked ready-up channel or a team channel: pickup.js sorts it out.
  if (before.channelId) pickup.left(before.channelId, after.id);
  if (before.channelId) ranked?.voiceLeft(before.channelId, after.id);
  if (after.channelId) pickup.joined(after.channelId, after.id);
});

client.on(Events.GuildMemberAdd, (member) => {
  if (!discordIo || member.guild.id !== config.guildId) return;
  welcomeMember({ id: member.id, name: member.displayName, bot: member.user.bot }, { io: discordIo, config, log });
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!pickup || interaction.guildId !== config.guildId) return;
  const user = {
    id: interaction.user.id,
    name: interaction.member?.displayName ?? interaction.member?.nick ?? interaction.user.globalName ?? interaction.user.username,
    isAdmin: isAdmin(interaction, config),
  };
  // Staff (1v1 disputes): admins, or anyone with a STAFF_ROLE_IDS role.
  const roleIds = Array.isArray(interaction.member?.roles) ? interaction.member.roles : [...(interaction.member?.roles?.cache?.keys() ?? [])];
  user.isStaff = user.isAdmin || roleIds.some((id) => config.staffRoleIds.includes(id));
  try {
    // Match threads: "Report score" (answers with the form), "Confirm their score", and the form.
    if (matches && interaction.isButton() && interaction.customId.startsWith('mt:')) {
      if (interaction.customId.startsWith('mt:vote:')) {
        const reply = await matches.button(interaction.customId, user);
        if (reply?.modal) return interaction.showModal({ toJSON: () => reply.modal });
        return interaction.reply({ content: reply?.ephemeral ?? 'Something went wrong.', flags: MessageFlags.Ephemeral });
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const reply = await matches.button(interaction.customId, user);
      return interaction.editReply(reply?.ephemeral ?? 'Done.');
    }
    if (matches && interaction.isStringSelectMenu() && interaction.customId.startsWith('mt:who:')) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const reply = await matches.select(interaction.customId, interaction.values[0], user);
      return interaction.editReply(reply?.ephemeral ?? 'Saved.');
    }
    if (matches && interaction.isModalSubmit() && interaction.customId.startsWith('mtm:')) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const sets = interaction.fields.getTextInputValue('sets');
      let files = [];
      try {
        files = [...(interaction.fields.getUploadedFiles('shots')?.values() ?? [])].map((f) => ({ url: f.url, name: f.name, contentType: f.contentType }));
      } catch {
        // no screenshot attached
      }
      const reply = await matches.modal(interaction.customId, user, { sets, files });
      return interaction.editReply(reply?.ephemeral ?? 'Saved.');
    }
    // 1v1 ranked: buttons, and the result form.
    if (ranked && interaction.isButton() && /^(rq|rr|rres|rstaff):/.test(interaction.customId)) {
      if (interaction.customId.startsWith('rres:')) {
        const reply = await ranked.button(interaction.customId, user);
        if (reply?.modal) return interaction.showModal({ toJSON: () => reply.modal });
        return interaction.reply({ content: reply?.ephemeral ?? 'Something went wrong.', flags: MessageFlags.Ephemeral });
      }
      await interaction.deferUpdate();
      const reply = await ranked.button(interaction.customId, user);
      if (reply?.ephemeral) await interaction.followUp({ content: reply.ephemeral, flags: MessageFlags.Ephemeral });
      return;
    }
    if (ranked && interaction.isModalSubmit() && interaction.customId.startsWith('rrm:')) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const winner = interaction.fields.getStringSelectValues('winner')?.[0];
      const shot = interaction.fields.getUploadedFiles('shot')?.first?.() ?? null;
      const reply = await ranked.modal(interaction.customId, user, { winner, file: shot ? { url: shot.url, name: shot.name, contentType: shot.contentType } : null });
      return interaction.editReply(reply?.ephemeral ?? 'Saved.');
    }
    if (ranked && interaction.isChatInputCommand() && ['rp', 'rpleaderboard'].includes(interaction.commandName)) {
      await interaction.deferReply();
      const picked = interaction.options.getUser('player', false);
      const player = picked ? { id: picked.id, name: interaction.options.getMember('player')?.displayName ?? picked.globalName ?? picked.username } : { id: user.id, name: user.name };
      return interaction.editReply(interaction.commandName === 'rp' ? ranked.rating(player) : ranked.leaderboard());
    }
    if (interaction.isButton()) {
      await interaction.deferUpdate();
      const reply = await pickup.button(interaction.customId, user);
      if (reply?.ephemeral) await interaction.followUp({ content: reply.ephemeral, flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.isStringSelectMenu()) {
      await interaction.deferUpdate();
      const reply = await pickup.select(interaction.customId, interaction.values[0], user);
      if (reply?.ephemeral) await interaction.followUp({ content: reply.ephemeral, flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.isChatInputCommand() && interaction.commandName === 'pickup' && interaction.options.getSubcommand(false) === 'syncroles') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (!user.isAdmin) return interaction.editReply('Only admins can use /pickup.');
      if (!clubRoles && !statRoles) return interaction.editReply('Club and stat roles are off (CLUB_ROLES=1 / STAT_ROLES=1 in .env turn them on).');
      const result = clubRoles ? await clubRoles.fullSync().catch((err) => ({ error: err.message })) : null;
      const stats = statRoles ? await statRoles.sync().catch((err) => ({ error: err.message })) : null;
      const lines = [];
      if (clubRoles) lines.push(result?.error ? `Club roles failed: ${result.error}` : `Club roles updated: ${describe(result)}.`);
      if (statRoles) lines.push(stats?.error ? `Stat roles failed: ${stats.error}` : `Stat roles updated: ${stats.made} made, ${stats.added} given, ${stats.removed} taken away.`);
      return interaction.editReply(lines.join('\n'));
    }
    if (interaction.isChatInputCommand()) {
      const publicReply = ['elo', 'leaderboard'].includes(interaction.commandName);
      await interaction.deferReply(publicReply ? {} : { flags: MessageFlags.Ephemeral });
      const o = interaction.options;
      const picked = o.getUser('player', false);
      const options = {
        sub: interaction.commandName === 'pickup' ? o.getSubcommand(false) : null,
        mode: o.getInteger('mode', false),
        game: o.getInteger('game', false),
        winner: o.getString('winner', false),
        count: o.getInteger('count', false),
        choice: o.getString('choice', false),
        nextOnly: o.getBoolean('next_only', false),
        player: picked ? { id: picked.id, name: o.getMember('player')?.displayName ?? picked.globalName ?? picked.username } : null,
      };
      const reply = await pickup.command(interaction.commandName, options, user);
      const { ephemeral, ...message } = reply;
      await interaction.editReply(message);
    }
  } catch (err) {
    log.error('[discord] interaction failed:', err.message);
  }
});

client.on(Events.Error, (err) => log.error('[discord]', err.message));
process.on('unhandledRejection', (err) => log.error('[bot] unhandled:', err));

async function stop(signal) {
  log.info(`${signal}: shutting down`);
  clubRoles?.stop();
  statRoles?.stop();
  matches?.stop();
  matchSite?.stop();
  siteQueue?.stop();
  rankedSite?.stop();
  await Promise.race([Promise.all([pickup?.shutdown(), ranked?.shutdown()]), new Promise((r) => setTimeout(r, 8000))]);
  await client.destroy();
  process.exit(0);
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

try {
  await client.login(config.token);
} catch (err) {
  log.error(`Discord login failed: ${err.message.replace(/\.+$/, '')}. Check DISCORD_TOKEN (BOT-SETUP.md, Part 1).`);
  process.exit(1);
}

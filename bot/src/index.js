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

// Only non-privileged intents: no switches to turn on in the Developer Portal.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
let pickup = null;
let clubRoles = null;

client.once(Events.ClientReady, async () => {
  try {
    const discord = await setupDiscord(client, config, log);
    await discord.guild.commands.set(commandList(config));
    pickup = new Pickup({ io: discord.io, store, config, log });
    await pickup.start();
    if (config.clubRoles) {
      const site = new SiteReader({ projectId: config.firebase.projectId, emulator: config.firebase.emulator });
      clubRoles = new ClubRoles({ io: discord.roleIo, site, store, config, log });
      clubRoles.start().catch((err) => log.error(`[club roles] ${err.message}`));
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
  if (after.channelId) pickup.joined(after.channelId, after.id);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!pickup || interaction.guildId !== config.guildId) return;
  const user = {
    id: interaction.user.id,
    name: interaction.member?.displayName ?? interaction.member?.nick ?? interaction.user.globalName ?? interaction.user.username,
    isAdmin: isAdmin(interaction, config),
  };
  try {
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
      if (!clubRoles) return interaction.editReply('Club roles are off (CLUB_ROLES=1 in .env turns them on).');
      const result = await clubRoles.fullSync().catch((err) => ({ error: err.message }));
      return interaction.editReply(result?.error ? `Club roles failed: ${result.error}` : `Club roles updated: ${describe(result)}.`);
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
  if (pickup) await Promise.race([pickup.shutdown(), new Promise((r) => setTimeout(r, 8000))]);
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

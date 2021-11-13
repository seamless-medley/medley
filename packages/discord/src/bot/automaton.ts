import { REST as RestClient } from "@discordjs/rest";
import { BoomBoxTrack } from "@medley/core";
import { Routes } from "discord-api-types/v9";
import { BaseCommandInteraction, BaseGuildVoiceChannel, Client, CommandInteraction, Guild, Intents, Interaction, InteractionReplyOptions, MessageAttachment, MessageEmbed, MessagePayload, Permissions, Snowflake } from "discord.js";
import commands from "./commands";
import { MedleyMix } from "./mix";

export type MedleyAutomatonOptions = {
  clientId: string;
  botToken: string;
  owners?: Snowflake[];
}

export enum HighlightTextType {
  Cyan = 'yaml',
  Yellow = 'fix',
  Red = 'diff'
}

// Handle interactions, send message to channels
export class MedleyAutomaton {
  readonly client: Client;

  private joinedChannels: Map<Guild['id'], BaseGuildVoiceChannel['id']> = new Map();

  constructor(readonly dj: MedleyMix, private options: MedleyAutomatonOptions) {
    this.client = new Client({
      intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_VOICE_STATES
      ]
    });

    this.client.on('interactionCreate', this.handleInteraction);

    // this.client.on('apiRequest', (req) => {
    //   console.log('API Request', req);
    // });

    // this.client.on('apiResponse', (res) => {
    //   console.log('API Response', res);
    // });

    // this.client.on('debug', (message) => {
    //   console.log('debug', message)
    // });

    this.client.on('error', (error) => {
      console.log('Error', error);
    });

    // this.client.on('messageCreate', (message) => {
    //   console.log('Message', message);
    // });

    this.client.on('ready', async () => {
      console.log('Ready');
      this.client.user?.setActivity('Artist - Title', { type: 'LISTENING' });
      // const guilds = await this.client.guilds.fetch();
      // const guild = await [...guilds.values()][0].fetch();
      // const channels = await guild.channels.fetch();

      // console.log(channels);
    });

    // this.client.on('guildCreate', guild => {
    //   console.log('Guild create', guild);
    //   this.registerCommands(guild.id);
    // });

    // this.client.on('guildDelete', guild => {
    //   console.log('Guild delete', guild);
    // });

    this.client.on('voiceStateUpdate', (o, n) => {
      // TODO: Detect audiences
      if (o.channelId != n.channelId) {
        console.log('Someone change voice channel', o.member?.user);
      }

      console.log('Someone deaf status', o.deaf, n.deaf);
    });

    this.dj.on('trackStarted', this.handleTrackStarted);
  }

  login() {
    this.client.login(this.options.botToken);
  }

  private handleTrackStarted = async (track: BoomBoxTrack, lastTrack?: BoomBoxTrack) => {
    // TODO: Send embed to a certain channels
  }

  private handleInteraction = async (interaction: Interaction) => {
    // Application commands
    if (interaction.isCommand()) {
      if (interaction.commandName !== 'medley') {
        return;
      }

      const group = interaction.options.getSubcommandGroup(false);
      return group ? this.handleGroupCommand(group, interaction) : this.handleTopLevelCommand(interaction.options.getSubcommand().toLowerCase(), interaction);
    }
  }

  private handleTopLevelCommand = async (command: string, interaction: CommandInteraction) => {
    switch (command) {
      case 'join':
        return this.handleJoin(interaction);
    }
  }

  private handleGroupCommand = async (group: string, interaction: CommandInteraction) => {

  }

  private handleJoin = async (interaction: CommandInteraction) => {
    // TODO: Helper to check for permissions
    const hasPermission = interaction.memberPermissions?.any([
      Permissions.FLAGS.MANAGE_CHANNELS,
      Permissions.FLAGS.MANAGE_GUILD
    ]);

    // TODO: Check permission
    console.log('hasPermission', hasPermission);

    let error: string | undefined;
    let moved = false;

    const channel = interaction.options.getChannel('channel');

    if (channel) {
      const channelToJoin = await this.client.channels.fetch(channel.id);

      if (channelToJoin?.isVoice()) {
        await this.reply(interaction, `Joining ${channelToJoin}`);

        try {
          await this.dj.join(channelToJoin);

          moved = this.joinedChannels.get(channelToJoin.guildId) === channelToJoin.id;

          if (!moved) {
            this.joinedChannels.set(channelToJoin.guildId, channelToJoin.id);
          }

          const reply = `Joined ${channel}`;
          this.reply(interaction, {
            content: null,
            embeds: [
              new MessageEmbed()
                .setColor('DARK_RED')
                .setTitle(reply)
                .setDescription(reply)
                .addField('channel', channel?.toString())
            ]
          });
        }
        catch (e) {
          const msg = this.makeHighlightedMessage('Could not join', HighlightTextType.Red);
          await this.reply(interaction, msg);
        }
      }
    }
  }

  private async reply(interaction: BaseCommandInteraction, options: string | MessagePayload | InteractionReplyOptions) {
    if (!interaction.replied) {
      await interaction.reply(options);
    } else {
      await interaction.editReply(options);
    }
  }

  private makeHighlightedMessage(s: string, type: HighlightTextType) {
    return '```' + type + '\n' +
      (type === HighlightTextType.Red ? '-' : '') + s + '\n' +
      '```'
    ;
  }

  static async registerCommands(botToken: string, clientId: string, guildId: string) {
    const client = new RestClient({ version: '9' })
      .setToken(botToken);

    await client.put(
      Routes.applicationGuildCommands(clientId, guildId),
      {
        body: [commands]
      }
    );

    console.log('Registered');
  }

  async registerCommands(guildId: string) {
    return MedleyAutomaton.registerCommands(this.options.botToken, this.options.clientId, guildId);
  }
}
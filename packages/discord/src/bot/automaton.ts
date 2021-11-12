import { REST as RestClient } from "@discordjs/rest";
import { AutocompleteInteraction, Client, CommandInteraction, Intents, Interaction } from "discord.js";
import { Routes } from "discord-api-types/v9";
import payload from "./command/payload";
import { MedleyMix } from "./mix";

export type MedleyAutomatonOptions = {
  clientId: string;
  botToken: string;
}

// Handle interactions, send message to channels
export class MedleyAutomaton {
  private client: Client;

  constructor(private dj: MedleyMix, private options: MedleyAutomatonOptions) {
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
    })
  }

  login() {
    this.client.login(this.options.botToken);
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

    // if (interaction.isContextMenu()) {
    //   return;
    // }

    // // Message component
    // if (interaction.isButton()) {
    //   return;
    // }

    // if (interaction.isSelectMenu()) {
    //   return;
    // }

    // if (interaction.isAutocomplete()) {
    //   return this.handleAutocomplete(interaction);
    // }
  }

  // private handleAutocomplete = async (autocomplete: AutocompleteInteraction) => {
  //   const value = autocomplete.options.getString('test') + '-auto';

  //   autocomplete.respond([
  //     {
  //       name: value,
  //       value
  //     }
  //   ])
  // }

  private handleTopLevelCommand = async (command: string, interaction: CommandInteraction) => {
    switch (command) {
      case 'join':
        return this.handleJoin(interaction);
    }
  }

  private handleGroupCommand = async (group: string, interaction: CommandInteraction) => {

  }

  private handleJoin = async (interaction: CommandInteraction) => {
    const channel = interaction.options.getChannel('channel');
    if (channel) {
      const c = await this.client.channels.fetch(channel.id);

      if (c?.isVoice()) {
        this.dj.join(c);
      }
    }

    const reply = `Joined ${channel}`;
    console.log(reply);
    interaction.reply(reply);
  }

  static async registerCommands(botToken: string, clientId: string, guildId: string) {
    const client = new RestClient({ version: '9' })
      .setToken(botToken);

    await client.put(
      Routes.applicationGuildCommands(clientId, guildId),
      {
        body: [payload]
      }
    );

    console.log('Registered');
  }

  async registerCommands(guildId: string) {
    return MedleyAutomaton.registerCommands(this.options.botToken, this.options.clientId, guildId);
  }
}
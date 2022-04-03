import { CommandInteraction, MessageEmbed, Permissions } from "discord.js";
import { ChannelType, CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { deny, guildIdGuard, HighlightTextType, makeHighlightedMessage, permissionGuard, reply, warn } from "../utils";
import { createStationSelector } from "./tune";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'join',
  description: 'Join a voice channel',
  options: [
    {
      type: OptionType.Channel,
      name: 'channel',
      description: 'Channel name to join',
      channel_types: [ChannelType.GuildVoice],
      required: true
    }
  ]
}

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = (automaton) => async (interaction) => {
  permissionGuard(interaction.memberPermissions, [
    Permissions.FLAGS.MANAGE_CHANNELS,
    Permissions.FLAGS.MANAGE_GUILD
  ]);

  const channel = interaction.options.getChannel('channel');

  if (!channel) {
    return;
  }

  const channelToJoin = automaton.client.channels.cache.get(channel.id);

  if (!channelToJoin?.isVoice()) {
    deny(interaction, 'Cannot join non-voice channel');
    return;
  }

  const guildId = guildIdGuard(interaction);

  const state = automaton.getGuildState(guildId);

  if (state?.voiceChannelId === channelToJoin.id) {
    warn(interaction, 'Already joined');
    return;
  }

  await reply(interaction, `Joining ${channelToJoin}`);

  const createEmbed = () => {
    const stationName = state?.stationLink?.station?.name;

    const embed = new MessageEmbed()
      .setColor('RANDOM')
      .setTitle('Joined')
      .addField('Channel', channel?.toString());

    if (stationName) {
      embed.addField('Station', stationName);
    }

    return embed;
  }

  try {
    const result = await automaton.join(channelToJoin);

    const newState = automaton.getGuildState(guildId);
    if (newState && !newState.textChannelId) {
      newState.textChannelId = interaction.channelId;
    }

    if (result.status === 'joined') {
      reply(interaction, {
        content: null,
        embeds: [createEmbed()]
      });

      return;
    }

    if (result.status === 'no_station') {
      createStationSelector(automaton, interaction, async (tuned) => {
        if (tuned) {
          if ((await automaton.join(channelToJoin)).status !== 'joined') {
            interaction.followUp(makeHighlightedMessage('Could not tune and join', HighlightTextType.Red));
            return;
          }
        }

        interaction.followUp({
          content: null,
          embeds: [createEmbed()]
        });
      });

      return;
    }

    deny(interaction, 'Could not join, error establishing a voice connection');
  }
  catch (e) {
    console.error(e);
    deny(interaction, 'Could not join, something went wrong');
  }
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;
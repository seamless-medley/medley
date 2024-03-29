import { ChatInputCommandInteraction, EmbedBuilder, hyperlink, PermissionsBitField, ChannelType as DJSChannelType } from "discord.js";
import { ChannelType, CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { deny, guildIdGuard, permissionGuard, reply } from "../utils";
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

const createCommandHandler: InteractionHandlerFactory<ChatInputCommandInteraction> = (automaton) => async (interaction) => {
  const isOwnerOverride = automaton.owners.includes(interaction.user.id);

  if (!isOwnerOverride) {
    permissionGuard(interaction.memberPermissions, [
      PermissionsBitField.Flags.ManageChannels,
      PermissionsBitField.Flags.ManageGuild,
      PermissionsBitField.Flags.MuteMembers,
      PermissionsBitField.Flags.MoveMembers
    ]);
  }

  const channel = interaction.options.getChannel('channel');

  if (!channel) {
    return;
  }

  const channelToJoin = automaton.client.channels.cache.get(channel.id);

  if (!channelToJoin?.isVoiceBased())  {
    deny(interaction, 'Cannot join non-voice channel');
    return;
  }

  const guildId = guildIdGuard(interaction);
  const state = automaton.ensureGuildState(guildId);

  await reply(interaction, `Joining ${channelToJoin}`);

  if (!state.textChannelId && interaction.channel?.type === DJSChannelType.GuildText && automaton.canSendMessageTo(interaction.channel)) {
    state.textChannelId = interaction.channelId;
  }

  const createEmbed = () => {
    const embed = new EmbedBuilder()
      .setColor('Random')
      .setTitle('Joined')
      .addFields({ name: 'Channel', value: channel?.toString() });

    const { tunedStation } = state;

    if (tunedStation?.iconURL) {
      embed.setThumbnail(tunedStation.iconURL);
    }

    if (tunedStation?.name) {
      embed.addFields({
        name: 'Station',
        value: tunedStation?.url ? hyperlink(tunedStation.name, tunedStation.url) : tunedStation.name
      });
    }

    return embed;
  }

  try {
    const result = await state.join(channelToJoin);

    switch (result.status) {
      case 'joined':
        reply(interaction, {
          content: null,
          embeds: [createEmbed()]
        });

        return;

      case 'no_station':
        createStationSelector(automaton, interaction, async (tuned) => {
          if (tuned) {
            if ((await state.join(channelToJoin)).status !== 'joined') {
              deny(interaction, 'Could not tune and join');
              return;
            }
          }

          reply(interaction, {
            content: null,
            embeds: [createEmbed()]
          });
        });

        return;

      case 'not_granted':
        deny(interaction, 'Could not join, not allowed');
        return;

      case 'not_joined':
        deny(interaction, 'Could not join, error establishing a voice connection');
        return;
    }
  }
  catch (e) {
    deny(interaction, 'Could not join, something went wrong');
    throw e;
  }
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;

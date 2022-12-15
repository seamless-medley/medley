import { ChatInputCommandInteraction, EmbedBuilder, PermissionsBitField } from "discord.js";
import { ChannelType, CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { deny, guildIdGuard, permissionGuard, reply, warn } from "../utils";
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
  permissionGuard(interaction.memberPermissions, [
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageGuild,
    PermissionsBitField.Flags.MuteMembers,
    PermissionsBitField.Flags.MoveMembers
  ]);

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

  const me = interaction.guild?.members.me;
  const myPermissions = me ? channelToJoin.permissionsFor(me) : undefined;

  if (!myPermissions?.has(PermissionsBitField.Flags.Connect)) {
    await deny(interaction, 'Could not join: no `connect` permission');
    return;
  }

  if (!myPermissions?.has(PermissionsBitField.Flags.Speak)) {
    await deny(interaction, 'Could not join: no `speak` permission');
    return;
  }

  await reply(interaction, `Joining ${channelToJoin}`);

  if (!state.textChannelId && myPermissions?.has(PermissionsBitField.Flags.SendMessages)) {
    state.textChannelId = interaction.channelId;
  }

  const createEmbed = () => {
    const stationName = state.stationLink?.station?.name;

    const embed = new EmbedBuilder()
      .setColor('Random')
      .setTitle('Joined')
      .addFields({ name: 'Channel', value: channel?.toString() });

    if (stationName) {
      embed.addFields({ name: 'Station', value: stationName });
    }

    return embed;
  }

  try {
    const result = await automaton.join(channelToJoin);

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

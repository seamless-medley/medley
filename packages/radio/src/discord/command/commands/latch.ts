import { ButtonInteraction, ChatInputCommandInteraction, PermissionsBitField } from "discord.js";
import { ansi } from "../ansi";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { accept, declare, deny, guildStationGuard, makeAnsiCodeBlock, permissionGuard, reply } from "../utils";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'latch',
  description: 'Bind track selection with the current crate',
  options: [
    {
      type: OptionType.Number,
      name: 'count',
      description: 'Number of tracks for the latch, specify 0 to cancel',
      min_value: 0,
      max_value: 20
    },
    {
      type: OptionType.Number,
      name: 'more',
      description: 'Number of tracks to increase for the latch',
      min_value: 1,
      max_value: 20
    }
  ]
}


const createCommandHandler: InteractionHandlerFactory<ChatInputCommandInteraction> = (automaton) => async (interaction) => {
  const { station } = guildStationGuard(automaton, interaction);

  const length = interaction.options.getNumber('count') ?? undefined;
  const increase = interaction.options.getNumber('more') ?? undefined;

  const hasLength = length !== undefined;
  const hasIncrease = increase !== undefined;

  const inquire = !hasLength && !hasIncrease;
  const exclusiveOption = (hasLength !== hasIncrease);

  if (!inquire && !exclusiveOption) {
    deny(interaction, 'Please use only one option at a time', { ephemeral: true });
    return;
  }

  const collection = station.trackPlay?.track?.collection;

  const latching = (() => {
    if (inquire) return station.latch(undefined);
    if (hasLength) return station.latch({ increase: false, collection, length });
    if (hasIncrease) return station.latch({ increase, collection });
  })();

  if (latching === undefined) {
    inquire
      ? reply(interaction, 'Not latching')
      : deny(interaction, 'Latching is not allowed for this track');

    return;
  }

  const { description = latching.collection.id } = latching.collection.extra;

  if (latching.max === 0) {
    declare(interaction, makeAnsiCodeBlock(ansi`{{green|b}}OK{{reset}}, Stop latching {{white|u}}{{bgOrange}}${description}{{reset}} collection`));
    return;
  }

  if (inquire) {
    const listing = station.allLatches.map((l) => {
      const from =  ` from \`${l.collection.extra.description}\``;
      return `Latching: \`${l.count}/${l.max}\`${from}`;
    });

    reply(interaction, listing.join('\n'));
    return;
  }

  if (hasIncrease) {
    const more = latching.max - latching.count;
    declare(interaction, makeAnsiCodeBlock(ansi`{{green|b}}OK{{reset}}, Latching {{pink|b}}${more}{{reset}} more tracks from {{white|u}}{{bgOrange}}${description}{{reset}} collection`));
  } else {
    declare(interaction, makeAnsiCodeBlock(ansi`{{green|b}}OK{{reset}}, Latching collection {{white|u}}{{bgOrange}}${description ?? latching.collection.id }{{reset}} for {{pink|b}}${latching.max}{{reset}} tracks`));
  }
}

const createButtonHandler: InteractionHandlerFactory<ButtonInteraction> = (automaton) => async (interaction, collectionId: string) => {
  const { station } = guildStationGuard(automaton, interaction);

  permissionGuard(interaction.memberPermissions, [
    PermissionsBitField.Flags.ManageChannels,
    PermissionsBitField.Flags.ManageGuild,
    PermissionsBitField.Flags.MuteMembers,
    PermissionsBitField.Flags.MoveMembers
  ]);

  const collection = station.trackPlay?.track?.collection;

  if (collection?.id !== collectionId) {
    deny(interaction, `Could not play more like this, currently playing another collection`, { ephemeral: true });
    return;
  }

  const latching = station.latch({
    increase: 1,
    important: true,
    collection
  });

  if (latching === undefined) {
    deny(interaction, 'Could not play more like this, latching is not allowed for this track', { ephemeral: true });
    return;
  }

  const more = latching.max - latching.count;
  const { description } = latching.collection.extra;

  declare(interaction,
    makeAnsiCodeBlock(ansi`{{green|b}}OK{{reset}}, Will play {{pink|b}}${more}{{reset}} more like this from {{white|u}}{{bgOrange}}${description}{{reset}} collection`),
    { mention: { type: 'user', subject: interaction.user.id }}
  );
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler,
  createButtonHandler
}

export default descriptor;

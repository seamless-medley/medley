import { MusicLibraryExtra } from "@seamless-medley/core";
import { ButtonInteraction, ChatInputCommandInteraction, PermissionsBitField } from "discord.js";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { accept, deny, guildStationGuard, permissionGuard, reply } from "../utils";

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
    deny(interaction, 'Please use only one option at a time', undefined, true);
    return;
  }

  const latching = (() => {
    if (inquire) return station.latch(undefined);
    if (hasLength) return station.latch({ increase: false, length });
    if (hasIncrease) return station.latch({ increase });
  })();

  if (latching === undefined) {
    inquire
      ? reply(interaction, 'Not latching')
      : deny(interaction, 'Latching is not allowed for this track');

    return;
  }

  const { descriptor: { description = latching.collection.id } } = latching.collection.extra as MusicLibraryExtra<any>;

  if (latching.max === 0) {
    accept(interaction, `OK: Stop latching "${description}" collection`);
    return;
  }

  if (inquire) {
    const listing = station.allLatches.map((l) => {
      const from =  ` from \`${(l.collection.extra as MusicLibraryExtra<any>).descriptor.description}\``;
      return `Latching: \`${l.count}/${l.max}\`${from}`;
    });

    reply(interaction, listing.join('\n'));
    return;
  }

  if (hasIncrease) {
    const more = latching.max - latching.count;
    accept(interaction, `OK: Latching ${more} more tracks from "${description}" collection`)
  } else {
    accept(interaction, `OK: Latching collection "${description ?? latching.collection.id }" for ${latching.max} tracks`);
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
    deny(interaction, `Could not play more like this, currently playing another collection`, undefined, true);
    return;
  }

  const latching = station.latch({
    increase: 1,
    important: true,
    collection
  });

  if (latching === undefined) {
    deny(interaction, 'Could not play more like this, latching is not allowed for this track', undefined, true);
    return;
  }

  const more = latching.max - latching.count;
  const { descriptor: { description } } = latching.collection.extra as MusicLibraryExtra<any>;

  accept(interaction,
    `OK: Will play ${more} more like this from "${description}" collection`,
    `@${interaction.user.id}`
  );
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler,
  createButtonHandler
}

export default descriptor;

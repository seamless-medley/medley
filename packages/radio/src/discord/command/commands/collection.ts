import { ActionRowBuilder, ButtonBuilder, ButtonStyle, CommandInteraction, MessageActionRowComponentBuilder, PermissionsBitField, SelectMenuComponentOptionData, StringSelectMenuBuilder } from "discord.js";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { deny, guildStationGuard, joinStrings, makeAnsiCodeBlock, permissionGuard, warn } from "../utils";
import { chain, startCase } from "lodash";
import { interact } from "../interactor";
import { ansi } from "../../format/ansi";
import { StationEvents, StationTrackCollection, TrackCollection, isRequestTrack } from "@seamless-medley/core";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'collection',
  description: 'Select the playback collection'
}

const onGoing = new Set<string>();

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = (automaton) => async (interaction) => {
  const isOwnerOverride = automaton.owners.includes(interaction.user.id);

  if (!isOwnerOverride) {
    permissionGuard(interaction.memberPermissions, [
      PermissionsBitField.Flags.ManageChannels,
      PermissionsBitField.Flags.ManageGuild,
      PermissionsBitField.Flags.MuteMembers,
      PermissionsBitField.Flags.MoveMembers
    ]);
  }

  const { station } = guildStationGuard(automaton, interaction);

  if (station.isLatchActive) {
    deny(interaction, `Could not select collection while a latch session is active`);
    return;
  }

  const getCollections = () => chain(station.crates)
    .flatMap(c => c.sources)
    .uniqBy(c => c.id)
    .value();

  if (getCollections().length <= 1) {
    warn(interaction, `No collections to change`);
    return;
  }

  await interact<TrackCollection<any>>({
    commandName: declaration.name,
    automaton,
    interaction,
    onGoing,
    ttl: 90_000,
    data: station.currentSequenceCollection,

    makeCaption: async () => [],
    async makeComponents(trackingCollection) {
      const collections = getCollections();

      if (getCollections().length <= 1) {
        return [];
      }

      const currentTrack = station.trackPlay?.track;

      const currentCollection = trackingCollection ?? (
        isRequestTrack(currentTrack)
          ? currentTrack.collection
          : station.currentSequenceCollection
      );

      const selectedCollection = currentCollection && collections.find(c => c.id === currentCollection?.id)
        ? currentCollection
        : undefined;

      const listing = collections.map<SelectMenuComponentOptionData>(c => ({
        label: c.extra.description ?? startCase(c.id),
        description: `${c.length} track(s)`,
        value: c.id,
        default: c.id === selectedCollection?.id
      }));

      return [
        new ActionRowBuilder<MessageActionRowComponentBuilder>()
          .addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('collection')
              .setPlaceholder('Select a collection')
              .addOptions(listing)
          ),
        new ActionRowBuilder<MessageActionRowComponentBuilder>()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('cancel_collection')
              .setLabel('Cancel')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('❌')
          )
      ];
    },
    async onCollect({ collected, done }) {
      const { customId } = collected;

      if (customId === 'cancel_collection') {
        await done();
        return;
      }

      if (customId === 'collection' && collected.isStringSelectMenu()) {
        await done(false);

        const collections = getCollections();
        const collection = collections.find(c => c.id === collected.values[0]);

        const result = collection
          ? station.forcefullySelectCollection(collection.id)
          : 'Invalid collection';

        await collected.update({
          content: joinStrings(makeAnsiCodeBlock(
            result === true
              ? ansi`{{green|b}}OK{{reset}}, will be playing from {{blue}}${startCase(collection!.id)}`
              : ansi`{{red}}Could not select collection: {{yellow}}${result}`
          )),
          components: []
        });

        return;
      }
    },

    hook({ refresh, cancel }) {
      const update = () => refresh({
        message: true,
        timer: true
      });

      const handleCollectionChange: StationEvents['collectionChange'] = (oldCollection, newCollection) => {
        this.data = newCollection;
        update();
      }

      const handleLatchCreated = () => {
        cancel('Canceled, a new latch session has been created');
      }

      const handleStationChange = () => {
        cancel('Canceled, the station has been changed');
      }

      station.on('collectionChange', handleCollectionChange);
      station.on('sequenceProfileChange', update);
      station.on('latchCreated', handleLatchCreated);
      automaton.on('stationTuned', handleStationChange);

      return () => {
        station.off('collectionChange', handleCollectionChange);
        station.off('sequenceProfileChange', update);
        station.off('latchCreated', handleLatchCreated);
        automaton.off('stationTuned', handleStationChange);
      }
    },
  });
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;

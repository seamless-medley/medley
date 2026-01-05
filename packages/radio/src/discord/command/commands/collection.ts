import { chain, clamp, startCase } from "lodash";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, MessageActionRowComponentBuilder, SelectMenuComponentOptionData, StringSelectMenuBuilder } from "discord.js";
import { AutomatonPermissionError, CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { deny, guildStationGuard, joinStrings, makeAnsiCodeBlock, warn } from "../utils";
import { interact } from "../interactor";
import { ansi } from "../../format/ansi";
import { AutomatonAccess } from "../../automaton";
import { isRequestTrack, StationEvents, TrackCollection } from "../../../core";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'collection',
  description: 'Select the playback collection'
}

const onGoing = new Set<string>();

type State = {
  page: number;
}

const createCommandHandler: InteractionHandlerFactory<ChatInputCommandInteraction> = (automaton) => async (interaction) => {
  const { station } = guildStationGuard(automaton, interaction);

  const access = await automaton.getAccessFor(interaction);

  if (access <= AutomatonAccess.None) {
    throw new AutomatonPermissionError(automaton, interaction);
  }

  if (station.isLatchActive) {
    deny(interaction, `Could not select collection while a latch session is active`);
    return;
  }

  const getCollections = (pinned?: TrackCollection<any>) => {
    return [
      ...(pinned ? [pinned] : []),
      ...chain(station.crates)
          .flatMap(c => c.sources)
          .uniqBy(c => c.id)
          .reject(c => pinned !== undefined && pinned.id === c.id)
          .value()
    ]
  }

  const collections = getCollections();

  if (collections.length <= 1) {
    warn(interaction, `No collections to change`);
    return;
  }

  const collectionsPerPage = 25; // Discord limit
  const totalPages = Math.ceil(collections.length / collectionsPerPage);

  const state: State = {
    page: 0
  }

  const cancelButtonBuilder = new ButtonBuilder()
    .setCustomId('cancel_collection')
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('❌');

  const prevPageButtonBuilder = new ButtonBuilder()
    .setCustomId('collection_prevPage')
    .setStyle(ButtonStyle.Secondary)

  const nextPageButtonBuilder = new ButtonBuilder()
    .setCustomId('collection_nextPage')
    .setStyle(ButtonStyle.Secondary);

  await interact<TrackCollection<any>>({
    commandName: declaration.name,
    automaton,
    interaction,
    onGoing,
    ttl: 90_000,
    data: station.temporalCollection ?? station.currentCollection,

    makeCaption: async () => totalPages > 1 ? [`Page ${state.page + 1}/${totalPages}:`] : [],
    async makeComponents(trackingCollection) {
      const listing = getCollections(trackingCollection);

      if (listing.length <= 1) {
        return [];
      }

      const { page } = state;

      const currentTrack = station.trackPlay?.track;

      const currentCollection = trackingCollection ?? (
        isRequestTrack(currentTrack)
          ? currentTrack.collection
          : station.currentCollection
      );

      const selectedCollection = currentCollection && listing.find(c => c.id === currentCollection?.id)
        ? currentCollection
        : undefined;

      const components: MessageActionRowComponentBuilder[] = [cancelButtonBuilder];

      if (page > 0) {
        components.push(prevPageButtonBuilder.setLabel(`⏮ Page ${page}`));
      }

      if (page < totalPages - 1) {
        components.push(nextPageButtonBuilder.setLabel(`Page ${page + 2} ⏭`));
      }

      return [
        new ActionRowBuilder<MessageActionRowComponentBuilder>()
          .addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('collection')
              .setPlaceholder('Select a collection')
              .addOptions(
                listing
                  .slice(page * collectionsPerPage, (page + 1) * collectionsPerPage)
                  .map<SelectMenuComponentOptionData>(c => ({
                    label: c.extra.description ?? startCase(c.id),
                    description: `${c.length} track(s)`,
                    value: c.id,
                    default: c.id === selectedCollection?.id
                  }))
              )
          ),
        new ActionRowBuilder<MessageActionRowComponentBuilder>()
          .addComponents(components)
      ];
    },
    async onCollect({ collected, buildMessage, resetTimer, done }) {
      const { customId } = collected;

      if (customId === 'cancel_collection') {
        await done();
        return;
      }

      resetTimer();

      // Paginate
      const paginationNavigation: Partial<Record<string, number>> = {
        'collection_back': 0,
        'collection_prevPage': -1,
        'collection_nextPage': 1
      };

      if (customId in paginationNavigation) {
        const increment = paginationNavigation[customId] ?? 0;

        state.page = clamp(state.page + increment, 0, totalPages - 1);

        collected.update(await buildMessage());

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

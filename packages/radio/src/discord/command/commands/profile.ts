import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, MessageActionRowComponentBuilder, SelectMenuComponentOptionData, StringSelectMenuBuilder } from "discord.js";
import { AutomatonCommandError, CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { guildStationGuard, joinStrings, makeAnsiCodeBlock, warn } from "../utils";
import { interact } from "../interactor";
import { ansi } from "../../format/ansi";
import { AutomatonAccess } from "../../automaton";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'profile',
  description: 'Change station profile'
}

const onGoing = new Set<string>();

const createCommandHandler: InteractionHandlerFactory<ChatInputCommandInteraction> = (automaton) => async (interaction) => {
  const access = await automaton.getAccessFor(interaction);

  if (access <= AutomatonAccess.None) {
    throw new AutomatonCommandError(automaton, 'Insufficient permissions');
  }

  const { station } = guildStationGuard(automaton, interaction);
  const { profiles } = station;

  if (profiles.length <= 1) {
    warn(interaction, `${station.name} has no profiles other than the default one`);
    return;
  }

  await interact({
    commandName: declaration.name,
    automaton,
    interaction,
    onGoing,
    ttl: 90_000,

    makeCaption: async () => [],
    async makeComponents() {
      const listing = profiles.map<SelectMenuComponentOptionData>(p => ({
        label: p.name,
        description: p.description ?? `${p.name} profile`,
        value: p.id,
        default: p === station.profile
      }));

      return [
        new ActionRowBuilder<MessageActionRowComponentBuilder>()
          .addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('profile')
              .setPlaceholder('Select a profile')
              .addOptions(listing)
          ),
        new ActionRowBuilder<MessageActionRowComponentBuilder>()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('cancel_profile')
              .setLabel('Cancel')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('❌')
          )
      ];
    },
    async onCollect({ collected, done }) {
      const { customId } = collected;

      if (customId === 'cancel_profile') {
        await done();
        return;
      }

      if (customId === 'profile' && collected.isStringSelectMenu()) {
        await done(false);

        const ok = station.changeProfile(collected.values[0]) !== undefined;

        await collected.update({
          content: joinStrings(makeAnsiCodeBlock(
            ok
              ? ansi`{{green|b}}OK{{reset}}, Station profile has been changed to {{blue}}${station.profile.name}`
              : ansi`{{red}}Could not change profile`
          )),
          components: []
        });

        return;
      }
    },

    hook({ cancel }) {
      const handleStationChange = () => {
        cancel('Canceled, the station has been changed');
      }

      automaton.on('stationTuned', handleStationChange);

      return () => {
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

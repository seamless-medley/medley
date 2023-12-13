import { ActionRowBuilder, ButtonBuilder, ButtonStyle, CommandInteraction, MessageActionRowComponentBuilder, PermissionsBitField, SelectMenuComponentOptionData, StringSelectMenuBuilder } from "discord.js";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { guildStationGuard, joinStrings, makeAnsiCodeBlock, permissionGuard, warn } from "../utils";
import { interact } from "../interactor";
import { ansi } from "../../format/ansi";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'profile',
  description: 'Select station profile'
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

    makeCaption: () => [],
    makeComponents() {
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
    }
  })
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;

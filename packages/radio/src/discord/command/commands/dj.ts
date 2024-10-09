import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, MessageActionRowComponentBuilder, roleMention, RoleSelectMenuBuilder } from "discord.js";
import { AutomatonCommandError, CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { AutomatonAccess } from "../../automaton";
import { interact } from "../interactor";
import { makeColoredMessage, reply } from "../utils";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'dj',
  description: 'Set roles for DJ'
}

const onGoing = new Set<string>();

const createCommandHandler: InteractionHandlerFactory<ChatInputCommandInteraction> = (automaton) => async (interaction) => {
  const access = await automaton.getAccessFor(interaction);

  if (access < AutomatonAccess.Moderator) {
    throw new AutomatonCommandError(automaton, 'Insufficient permissions');
  }

  if (!interaction.guildId) {
    return;
  }

  const config = automaton.getGuildConfig(interaction.guildId);

  if (!config) {
    return;
  }

  let roles = config.djRoles;

  await interact({
    commandName: declaration.name,
    ttl: 90_000,
    automaton,
    interaction,
    onGoing,
    makeCaption: async () => [],
    async makeComponents() {
      return [
        new ActionRowBuilder<MessageActionRowComponentBuilder>()
          .addComponents(
            new RoleSelectMenuBuilder()
              .setCustomId('dj_roles')
              .setPlaceholder('Select roles to be DJ')
              .setMinValues(0)
              .setMaxValues(interaction.guild?.roles.cache.size ?? 10)
              .addDefaultRoles(roles ?? [])
          ),
        new ActionRowBuilder<MessageActionRowComponentBuilder>()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('dj_confirm')
              .setLabel('OK')
              .setStyle(ButtonStyle.Primary)
              .setEmoji('✅'),
            new ButtonBuilder()
              .setCustomId('dj_cancel')
              .setLabel('Cancel')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('❌')
          )
      ]
    },
    async onCollect({ collected, done }) {
      if (collected.customId === 'dj_roles' && collected.isRoleSelectMenu()) {
        roles = collected.values;
        collected.deferUpdate();
        return;
      }

      if (collected.customId === 'dj_confirm' && collected.isButton())  {
        config.djRoles = roles;

        await reply(interaction, {
          content: roles?.length
            ? `${roles.map(roleMention).join(' ')} ${roles.length === 1 ? 'is' : 'are'} now DJ`
            : makeColoredMessage('pink|b', 'No roles for DJ'),
          components: []
        });

        await done(false);
        return;
      }

      if (collected.customId === 'dj_cancel' && collected.isButton())  {
        await done();
        return;
      }
    }
  });
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;

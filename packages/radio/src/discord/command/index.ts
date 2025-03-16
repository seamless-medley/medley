import { map, noop } from "lodash";
import { AutocompleteInteraction, ButtonInteraction, ChatInputCommandInteraction, Interaction, InteractionType } from "discord.js";
import { createLogger } from "@seamless-medley/logging";

import { all as descriptors  } from './commands';
import { AutomatonPermissionError, Command, CommandError, CommandType, GuardError, GuildHandler, InteractionHandler, SubCommandLikeOption } from "./type";
import { deny, makeColoredMessage } from "./utils";
import { MedleyAutomaton } from "../automaton";

export const createCommandDeclarations = (name: string = 'medley', description: string = 'Medley'): Command => {
  const options: SubCommandLikeOption[] = map(descriptors, desc => desc.declaration).filter((decl): decl is SubCommandLikeOption => !!decl);

  return {
    name,
    description,
    type: CommandType.ChatInput,
    options
  };
}

type Handlers = {
  command?: InteractionHandler<ChatInputCommandInteraction>;
  button?: InteractionHandler<ButtonInteraction>;
  autocomplete?: InteractionHandler<AutocompleteInteraction>;
  onGuildCreate?: GuildHandler;
  onGuildDelete?: GuildHandler;
}

export const createInteractionHandler = (automaton: MedleyAutomaton) => {
  const baseCommand = automaton.baseCommand;

  const commandHandlers = new Map<string, Handlers>(map(descriptors, (desc, name) => [name.toLowerCase(), {
    command: desc.createCommandHandler?.(automaton),
    button: desc.createButtonHandler?.(automaton),
    autocomplete: desc.createAutocompleteHandler?.(automaton),
    onGuildCreate: desc.createOnGuildCreateHandler?.(automaton),
    onGuildDelete: desc.createOnGuildDeleteHandler?.(automaton),
  }]));

  const logger = createLogger({ name: 'command' });

  // Inform each command about guild creation and deletion
  automaton.on('guildCreate', (guild) => {
    for (const { onGuildCreate } of commandHandlers.values()) {
      onGuildCreate?.(guild);
    }
  });

  automaton.on('guildDelete', (guild) => {
    for (const { onGuildDelete } of commandHandlers.values()) {
      onGuildDelete?.(guild);
    }
  });

  return async (interaction: Interaction) => {
    if (interaction.user.bot) {
      return;
    }

    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName !== baseCommand) {
          return;
        }

        const group = interaction.options.getSubcommandGroup(false);
        const command = interaction.options.getSubcommand();

        const groupOrCommand = (group || command).toLowerCase();

        const handlers = commandHandlers.get(groupOrCommand);

        if (handlers?.command) {
          return await handlers?.command?.(interaction);
        }

        logger.warn(
          {
            group: interaction.options.getSubcommandGroup(),
            command: interaction.options.getSubcommand()
          },
          'Unknown command'
        );

        interaction.reply({
          content: makeColoredMessage('red', `Sorry I don't understand that`)
        });

        return;
      }

      if (interaction.isButton()) {
        const { customId } = interaction;

        const [tag, ...params] = customId.split(':');

        const handlers = commandHandlers.get(tag);

        if (handlers?.button) {
          return await handlers.button(interaction, ...params);
        }
      }

      if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
        if (interaction.commandName !== baseCommand) {
          return;
        }

        const handlers = commandHandlers.get(interaction.options.getSubcommand().toLowerCase());

        if (!handlers?.autocomplete) {
          interaction.respond([]);
          return;
        }

        return await handlers.autocomplete(interaction);
      }
    }
    catch (e) {
      if (!(e instanceof GuardError)) {
        const error = e instanceof AutomatonPermissionError
          ? ({
            message: e.message,
            user: e.interaction.user,
            guild: e.interaction.guild
              ? {
                id: e.interaction.guild.id,
                name: e.interaction.guild.name
              }
              : undefined,
            automaton: e.automaton.id
          })
          : e;

        logger.error(error,
          interaction.isChatInputCommand()
            ? `Error in ${interaction.options.getSubcommand()} command`
            : 'Error in interaction'
        );
      }

      if (interaction.isRepliable()) {
        if (e instanceof CommandError) {
          deny(interaction, `Command Error: ${e.message}`).catch(noop);
          return;
        }

        deny(interaction, 'Internal Error').catch(noop);
        return;
      }
    }
  }
}

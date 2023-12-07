import { map } from "lodash";
import { AutocompleteInteraction, ButtonInteraction, ChatInputCommandInteraction, Interaction, InteractionType } from "discord.js";
import { createLogger } from "@seamless-medley/logging";
import join from "./commands/join";
import skip from './commands/skip';
import lyrics from "./commands/lyrics";
import request from "./commands/request";
import unrequest from './commands/unrequest';
import vote from './commands/vote';
import message from './commands/message';
import history from './commands/history';
import tune from './commands/tune';
import latch from './commands/latch';

import { Command, CommandError, CommandType, GuildHandler, InteractionHandler, SubCommandLikeOption } from "./type";
import { deny, isReplyable } from "./utils";
import { MedleyAutomaton } from "../automaton";

const descriptors = {
  join,
  skip,
  lyrics,
  request,
  unrequest,
  vote,
  message,
  history,
  tune,
  latch
}

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

        return await handlers?.command?.(interaction);
      }

      if (interaction.isButton()) {
        const { customId } = interaction;

        const [tag, ...params] = customId.split(':');

        const handler = commandHandlers.get(tag);

        return await handler?.button?.(interaction, ...params);
      }

      if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
        if (interaction.commandName !== baseCommand) {
          return;
        }

        const handler = commandHandlers.get(interaction.options.getSubcommand().toLowerCase());

        if (!handler) {
          interaction.respond([]);
          return;
        }

        return await handler.autocomplete?.(interaction);
      }
    }
    catch (e) {
      if (!(e instanceof CommandError)) {
        logger.error(e);
      }

      if (isReplyable(interaction)) {
        if (e instanceof CommandError) {
          deny(interaction, `Command Error: ${e.message}`, { ephemeral: true });
          return;
        }

        deny(interaction, 'Internal Error', { ephemeral: true });
        return;
      }
    }
  }
}

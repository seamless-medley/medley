import { AutocompleteInteraction, ButtonInteraction, ChatInputCommandInteraction, Interaction, InteractionType } from "discord.js";
import _ from "lodash";
import { createLogger } from "@seamless-medley/core";
import join from "./commands/join";
import skip from './commands/skip';
import volume from "./commands/volume";
import lyrics from "./commands/lyrics";
import request from "./commands/request";
import unrequest from './commands/unrequest';
import vote from './commands/vote';
import message from './commands/message';
import history from './commands/history';
import tune from './commands/tune';

import { Command, CommandError, CommandType, InteractionHandler, SubCommandLikeOption } from "./type";
import { deny, isReplyable } from "./utils";
import { MedleyAutomaton } from "../automaton";

const descriptors = {
  join,
  skip,
  volume,
  lyrics,
  request,
  unrequest,
  vote,
  message,
  history,
  tune
}

export const createCommandDeclarations = (name: string = 'medley', description: string = 'Medley'): Command => {
  const options: SubCommandLikeOption[] = _.map(descriptors, desc => desc.declaration).filter((decl): decl is SubCommandLikeOption => !!decl);

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
}

export const createInteractionHandler = (baseName: string, automaton: MedleyAutomaton) => {
  const handlers = new Map<string, Handlers>(_.map(descriptors, (desc, name) => [name.toLowerCase(), {
    command: desc.createCommandHandler?.(automaton),
    button: desc.createButtonHandler?.(automaton),
    autocomplete: desc.createAutocompleteHandler?.(automaton)
  }]));

  const logger = createLogger({ name: 'command' });

  return async (interaction: Interaction) => {
    if (interaction.user.bot) {
      return;
    }

    try {
      if (interaction.isChatInputCommand()) {
        if (interaction.commandName !== baseName) {
          return;
        }

        const group = interaction.options.getSubcommandGroup(false);
        const command = interaction.options.getSubcommand();

        const groupOrCommand = (group || command).toLowerCase();

        const handler = handlers.get(groupOrCommand);

        return await handler?.command?.(interaction);
      }

      if (interaction.isButton()) {
        const { customId } = interaction;

        const [tag, ...params] = customId.split(':');

        const handler = handlers.get(tag);

        return await handler?.button?.(interaction, ...params);
      }

      if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
        if (interaction.commandName !== baseName) {
          return;
        }

        const handler = handlers.get(interaction.options.getSubcommand().toLowerCase());

        if (!handler) {
          interaction.respond([]);
          return;
        }

        return await handler.autocomplete?.(interaction);
      }
    }
    catch (e) {
      logger.prettyError(e as Error);

      if (isReplyable(interaction)) {
        if (e instanceof CommandError) {
          deny(interaction, `Command Error: ${e.message}`, undefined, true);
          return;
        }

        deny(interaction, 'Internal Error', undefined, true);
        return;
      }
    }
  }
}

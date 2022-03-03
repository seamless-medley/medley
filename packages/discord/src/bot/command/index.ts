import { AutocompleteInteraction, ButtonInteraction, CommandInteraction, Interaction } from "discord.js";
import _ from "lodash";
import join from "./commands/join";
import skip from './commands/skip';
import volume from "./commands/volume";
import lyrics from "./commands/lyrics";
import request from "./commands/request";
import vote from './commands/vote';
import message from './commands/message';
import history from './commands/history';
import tune from './commands/tune';

// TODO: New command "history" for showing recent songs
// TODO: New command "unrequest" for deleting the requested song
// TODO: New command "tune" for tuning into (selection) a station

import { Command, CommandError, CommandType, InteractionHandler, SubCommandLikeOption } from "./type";
import { deny, isReplyable } from "./utils";
import { MedleyAutomaton } from "../automaton";

const descriptors = {
  join,
  skip,
  volume,
  lyrics,
  request,
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
  command?: InteractionHandler<CommandInteraction>;
  button?: InteractionHandler<ButtonInteraction>;
  autocomplete?: InteractionHandler<AutocompleteInteraction>;
}

export const createInteractionHandler = (baseName: string, automaton: MedleyAutomaton) => {
  const handlers: Map<string, Handlers> = new Map(_.map(descriptors, (desc, name) => [name.toLowerCase(), {
    command: desc.createCommandHandler?.(automaton),
    button: desc.createButtonHandler?.(automaton),
    autocomplete: desc.createAutocompleteHandler?.(automaton)
  }] as const));

  return async (interaction: Interaction) => {
    if (interaction.user.bot) {
      return;
    }

    try {
      if (interaction.isCommand()) {
        if (interaction.commandName !== baseName) {
          return;
        }

        const group = interaction.options.getSubcommandGroup(false);
        const command = interaction.options.getSubcommand();

        const groupOrCommand = (group || command).toLowerCase();

        const handler = handlers.get(groupOrCommand);

        return handler?.command?.(interaction);
      }

      if (interaction.isButton()) {
        const { customId } = interaction;

        const [tag, ...params] = customId.split(':');

        const handler = handlers.get(tag);

        return handler?.button?.(interaction, ...params);
      }

      if (interaction.isAutocomplete()) {
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
      if (e instanceof CommandError) {
        if (isReplyable(interaction)) {
          deny(interaction, `Command Error: ${e.message}`, undefined, true);
        }

        return;
      }

      console.error('Interaction Error', e);
    }
  }
}
import { ButtonInteraction, ChatInputCommandInteraction } from "discord.js";
import { AutomatonCommandError, CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../../type";
import { list } from './list';
import { set } from './set';
import { remove } from './remove';
import { declare, deny, guildStationGuard, makeAnsiCodeBlock } from "../../utils";
import { ansi } from "../../../format/ansi";
import { SubCommandHandlerOptions } from "./type";
import { AutomatonAccess } from "../../../automaton";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommandGroup,
  name: 'latch',
  description: 'Bind track selection with the current crate',
  options: [
    {
      type: OptionType.SubCommand,
      name: 'set',
      description: 'Set up a latch session'
    },
    {
      type: OptionType.SubCommand,
      name: 'list',
      description: 'List all active latch sessions'
    },
    {
      type: OptionType.SubCommand,
      name: 'remove',
      description: 'Remove latch session(s)'
    }
  ]
}

const subCommandHandlers: Partial<Record<string, (options: SubCommandHandlerOptions) => Promise<any>>> = {
  list,
  set,
  remove
}

const createCommandHandler: InteractionHandlerFactory<ChatInputCommandInteraction> = (automaton) => async (interaction) => {
  const subCommandName = interaction.options?.getSubcommand(true);

  subCommandHandlers[subCommandName]?.({
    automaton,
    interaction,
    commandName: declaration.name,
    subCommandName
  });
}

const createButtonHandler: InteractionHandlerFactory<ButtonInteraction> = (automaton) => async (interaction, collectionId: string) => {
  const { station } = guildStationGuard(automaton, interaction);

  const access = await automaton.getAccessFor(interaction);

  if (access <= AutomatonAccess.None) {
    throw new AutomatonCommandError(automaton, 'Insufficient permissions');
  }

  const collection = station.trackPlay?.track?.collection;

  if (collection?.id !== collectionId) {
    deny(interaction, `Could not play more like this, currently playing another collection`, { ephemeral: true });
    return;
  }

  const latching = station.latch({
    increase: 1,
    important: true,
    collection
  });

  if (latching === undefined) {
    deny(interaction, 'Could not play more like this, latching is not allowed for this track', { ephemeral: true });
    return;
  }

  const more = latching.max - latching.count;
  const { description } = latching.collection.extra;

  declare(interaction,
    makeAnsiCodeBlock(ansi`{{green|b}}OK{{reset}}, Will play {{pink|b}}${more}{{reset}} more like this from {{bgOrange}} {{white|u}}${description}{{bgOrange|n}} {{reset}} collection`),
    { mention: { type: 'user', subject: interaction.user.id }}
  );
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler,
  createButtonHandler
}

export default descriptor;

import { ChatInputCommandInteraction } from "discord.js";
import { AutomatonPermissionError, CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { SubCommandHandlerOptions } from "./latch/type";
import { deny, guildIdGuard, joinStrings, makeAnsiCodeBlock, reply } from "../utils";
import { GuildState } from "../../automaton/guild-state";
import { ansi } from "../../format/ansi";
import { AutomatonAccess } from "../../automaton";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommandGroup,
  name: 'karaoke',
  description: 'Control vocal removal (karaoke) function',
  options: [
    {
      type: OptionType.SubCommand,
      name: 'on',
      description: 'Remove vocal'
    },
    {
      type: OptionType.SubCommand,
      name: 'off',
      description: 'Turn off karaoke'
    }
  ]
}

function replyWithKaraokeState(guildState: GuildState, interaction: ChatInputCommandInteraction) {
  const s = guildState.karaokeEnabled ? ansi`{{green}}on` : ansi`{{yellow}}off`;

  reply(interaction, {
    content: joinStrings(makeAnsiCodeBlock(`Karaoke is now ${s}`))
  })
}

const subCommandHandlers: Partial<Record<string, (options: SubCommandHandlerOptions) => Promise<any>>> = {
  async on(options) {
    const { automaton, interaction } = options;
    const guildId = guildIdGuard(interaction);

    const state = automaton.getGuildState(guildId);

    if (!state) {
      deny(interaction, 'Unknown guild');
      return;
    }

    if (!state.setKaraokeParams({ enabled: true })) {
      deny(interaction, 'Could not set karaoke parameter');
      return;
    }

    replyWithKaraokeState(state, interaction);
  },

  async off(options) {
    const { automaton, interaction } = options;
    const guildId = guildIdGuard(interaction);

    const state = automaton.getGuildState(guildId);

    if (!state) {
      deny(interaction, 'Unknown guild');
      return;
    }

    if (!state.setKaraokeParams({ enabled: false })) {
      deny(interaction, 'Could not set karaoke parameter');
      return;
    }

    replyWithKaraokeState(state, interaction);
  }
}

const createCommandHandler: InteractionHandlerFactory<ChatInputCommandInteraction> = (automaton) => async (interaction) => {
  const access = await automaton.getAccessFor(interaction);

  if (access <= AutomatonAccess.None) {
    throw new AutomatonPermissionError(automaton, interaction);
  }

  const subCommandName = interaction.options?.getSubcommand(true);

  subCommandHandlers[subCommandName]?.({
    automaton,
    interaction,
    commandName: declaration.name,
    subCommandName
  });
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;

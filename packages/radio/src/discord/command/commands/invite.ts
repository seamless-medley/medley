import { CommandInteraction } from "discord.js";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'invite',
  description: 'Show invitation link'
}


const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = (automaton) => async (interaction) => {
  const { oAuth2Url } = automaton;

  interaction.reply(`Use the following link to add me to your server:\n> ${oAuth2Url.toString()}`)
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;

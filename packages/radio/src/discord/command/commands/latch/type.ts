import { ChatInputCommandInteraction } from "discord.js";
import { MedleyAutomaton } from "../../../automaton";

export type SubCommandHandlerOptions = {
  interaction: ChatInputCommandInteraction;
  automaton: MedleyAutomaton;
  commandName: string;
  subCommandName: string
}

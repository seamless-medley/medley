import {
  APIApplicationCommandOption as DiscordCommandOption,
  RESTPostAPIApplicationCommandsJSONBody
} from "discord-api-types/v9";
import { AutocompleteInteraction, ButtonInteraction, CommandInteraction, Interaction } from "discord.js";
import { MedleyAutomaton } from "../automaton";

export enum CommandType {
  ChatInput = 1,
  User = 2,
  Message = 3
}

export enum OptionType {
  SubCommand = 1,
  SubCommandGroup = 2,
  String = 3,
  Integer = 4,
  Boolean = 5,
  User = 6,
  Channel = 7,
  Role = 8,
  Mentionable = 9,
  Number = 10
}

export enum ChannelType {
  GuildText = 0,
  GuildVoice = 2,
  GuildCategory = 4,
  GuildNews = 5,
  GuildStore = 6,
  GuildNewsThread = 10,
  GuildPublicThread = 11,
  GuildPrivateThread = 12,
  GuildStageVoice = 13
}

export type Command = Omit<RESTPostAPIApplicationCommandsJSONBody, 'type' | 'options'> & {
  type: CommandType;
  description: string;
  options?: CommandOption[];
}

export type BasicCommandOption = Omit<DiscordCommandOption, 'type' | 'options'> & {
  type: OptionType;
  autocomplete?: boolean;
}

export type Choice<T extends string | number> = {
  name: string;
  value: T;
}

export type StringChoiceCommandOption = BasicCommandOption & {
  type: OptionType.String;
  choices: Choice<string>[];
}

export type IntegerOrNumberChoiceCommandOption = BasicCommandOption & {
  type: OptionType.Integer | OptionType.Number;
  choices: Choice<number>[];
}

export type SubCommandLikeOption = BasicCommandOption & {
  type: OptionType.SubCommand | OptionType.SubCommandGroup;
  options?: CommandOption[];
}

export type ChoiceCommandOption = StringChoiceCommandOption | IntegerOrNumberChoiceCommandOption;

export type ChannelCommandOption = BasicCommandOption & {
  type: OptionType.Channel;
  channel_types?: ChannelType[];
}

type MinMaxCommandOption = BasicCommandOption & {
  type: OptionType.Integer | OptionType.Number;
  min_value?: number;
  max_value?: number;
}

export type CommandOption = BasicCommandOption | ChoiceCommandOption | MinMaxCommandOption | ChannelCommandOption | SubCommandLikeOption;

export type InteractionHandler<T extends Interaction> = (interaction: T, ...args: any) => Promise<any>;

export type InteractionHandlerFactory<T extends Interaction> = (automaton: MedleyAutomaton) => InteractionHandler<T>;

export type CommandDescriptor = {
  declaration?: SubCommandLikeOption,
  createCommandHandler?: InteractionHandlerFactory<CommandInteraction>;
  createButtonHandler?: InteractionHandlerFactory<ButtonInteraction>;
  createAutocompleteHandler?: InteractionHandlerFactory<AutocompleteInteraction>;
}

export class CommandError extends Error { };
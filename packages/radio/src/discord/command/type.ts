import {
  APIApplicationCommandOption as DiscordCommandOption,
  RESTPostAPIApplicationCommandsJSONBody
} from "discord-api-types/v10";

import {
  AutocompleteInteraction,
  BaseInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Guild
} from "discord.js";

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
  Number = 10,
  Attachment = 11
}

export enum ChannelType {
  GuildText = 0,
  DM = 1,
  GuildVoice = 2,
  GroupDM = 3,
  GuildCategory = 4,
  GuildAnnouncement = 5,
  AnnouncementThread = 10,
  PublicThread = 11,
  PrivateThread = 12,
  GuildStageVoice = 13,
  GuildDirectory = 14,
  GuildForum = 15,
  GuildMedia = 16
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

export type InteractionHandler<T extends BaseInteraction> = (interaction: T, ...args: any) => Promise<any>;

export type InteractionHandlerFactory<T extends BaseInteraction> = (automaton: MedleyAutomaton) => InteractionHandler<T>;

export type GuildHandler = (guild: Guild) => Promise<any>;

export type GuildHandlerFactory = (automaton: MedleyAutomaton) => GuildHandler;

export type CommandDescriptor = {
  declaration?: SubCommandLikeOption,
  createCommandHandler?: InteractionHandlerFactory<ChatInputCommandInteraction>;
  createButtonHandler?: InteractionHandlerFactory<ButtonInteraction>;
  createAutocompleteHandler?: InteractionHandlerFactory<AutocompleteInteraction>;
  createOnGuildCreateHandler?: GuildHandlerFactory;
  createOnGuildDeleteHandler?: GuildHandlerFactory;
}

export class CommandError extends Error { };

export class AutomatonCommandError extends CommandError {
  constructor(readonly automaton: MedleyAutomaton, message?: string, options?: ErrorOptions) {
    super(message, options)
  }
};

export class AutomatonPermissionError extends AutomatonCommandError {
  constructor(automaton: MedleyAutomaton, readonly interaction: BaseInteraction, options?: ErrorOptions) {
    super(automaton, 'Insufficient permissions', options);
  }
}

export class GuardError extends AutomatonCommandError { }

export type Strings = (string | undefined)[];

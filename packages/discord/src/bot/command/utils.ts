import { APIMessage } from "discord-api-types";
import { BaseCommandInteraction, InteractionReplyOptions, Message, MessageComponentInteraction, MessagePayload, PermissionResolvable, Permissions } from "discord.js";
import { castArray } from "lodash";
import { CommandError } from "./type";

export enum HighlightTextType {
  Cyan = 'yaml',
  Yellow = 'fix',
  Red = 'diff'
}

type ReplyableInteraction = BaseCommandInteraction | MessageComponentInteraction;

export function makeHighlightedMessage(s: string | string[], type: HighlightTextType, mention?: string) {
  const isRed = type === HighlightTextType.Red;
  return (mention ? `<${mention}>` : '') +
    '```' + type + '\n' +
    castArray(s).map(line => (isRed ? '-' : '') + line).join('\n') + '\n' +
    '```'
    ;
}

export const reply = async (interaction: ReplyableInteraction, options: string | MessagePayload | InteractionReplyOptions) =>
  !interaction.replied && !interaction.deferred
    ? interaction.reply(options)
    : interaction.editReply(options);

type SimpleDeclareFn = (interaction: ReplyableInteraction, s: string, mention?: string, ephemeral?: boolean) => Promise<void | Message<boolean> | APIMessage>;

export const declare = (interaction: ReplyableInteraction, type: HighlightTextType, s: string, mention?: string, ephemeral?: boolean) => reply(interaction, {
  content: makeHighlightedMessage(s, type, mention),
  ephemeral
});

export const accept: SimpleDeclareFn = (interaction, s, mention?, ephemeral?) =>
  declare(interaction, HighlightTextType.Cyan, s, mention, ephemeral);

export const deny: SimpleDeclareFn = (interaction, s, mention?, ephemeral?) =>
  declare(interaction, HighlightTextType.Red, s, mention, ephemeral);

export const warn: SimpleDeclareFn = (interaction, s, mention?, ephemeral?) =>
  declare(interaction, HighlightTextType.Yellow, s, mention, ephemeral);

export function permissionGuard(permissions: Permissions | null, perm: PermissionResolvable, checkAdmin: boolean = true) {
  if (permissions && !permissions?.any(perm, checkAdmin)) {
    throw new CommandError('Insufficient permissions');
  }
}
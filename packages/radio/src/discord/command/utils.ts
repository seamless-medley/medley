import { getTrackBanner, RequestTrack, TrackPeek, Station, RequestAudience } from "@seamless-medley/core";
import { APIMessage } from "discord-api-types/v9";
import { BaseCommandInteraction, Interaction, InteractionReplyOptions, Message, MessageComponentInteraction, MessagePayload, PermissionResolvable, Permissions, User } from "discord.js";
import { castArray, isString, maxBy, padStart } from "lodash";
import { MedleyAutomaton } from "../automaton";
import { CommandError } from "./type";

export enum HighlightTextType {
  Cyan = 'yaml',
  Yellow = 'fix',
  Red = 'diff'
}

type ReplyableInteraction = BaseCommandInteraction | MessageComponentInteraction;

export function makeHighlightedMessage(s: string | (string | undefined)[], type: HighlightTextType, mention?: string) {
  const isRed = type === HighlightTextType.Red;
  return (mention ? `<${mention}>` : '') +
    '```' + type + '\n' +
    castArray(s).filter(isString).map(line => (isRed ? '-' : '') + line).join('\n') + '\n' +
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

export function isReplyable(interaction: Interaction): interaction is ReplyableInteraction {
  return interaction.isApplicationCommand() || interaction.isMessageComponent();
}

export function guildIdGuard(interaction: Interaction): string {

  const { guildId } = interaction;

  if (!guildId) {
    throw new CommandError('Not in a guild');
  }

  return guildId;
}

export function guildStationGuard(automaton: MedleyAutomaton, interaction: Interaction): { guildId: string, station: Station } {
  const guildId = guildIdGuard(interaction);
  const station = automaton.getTunedStation(guildId);

  if (!station) {
    throw new CommandError('No station linked');
  }

  return {
    guildId,
    station
  }
}

const previewTrack = ({ index, track }: TrackPeek<RequestTrack<RequestAudience>>, padding: number, focus: number | undefined) => {
  const label = padStart(`${focus === index ? '+ ' : ''}${index + 1}`, padding);
  return `${label}: ${getTrackBanner(track)} [${track.priority || 0}]`;
}

export async function makeRequestPreview(station: Station, index: number = 0, focus?: number, n: number = 5) {
  const peeking = station.peekRequests(index, n);

  if (peeking.length <= 0) {
    return;
  }

  const padding = 2 + (maxBy(peeking, 'index')?.index.toString().length || 0);

  const lines: string[] = [];

  if (peeking[0].index > 1) {
    const first = station.peekRequests(0, 1);
    if (first.length) {
      lines.push(previewTrack(first[0], padding, focus));
      lines.push(padStart('...', padding));
    }
  }

  for (const peek of peeking) {
    lines.push(previewTrack(peek, padding, focus));
  }

  return lines.length
    ? [
      '```diff',
      ...lines,
      '```'
    ]
    : undefined;
}

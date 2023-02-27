import { getTrackBanner, TrackPeek, Station, StationRequestedTrack } from "@seamless-medley/core";
import {
  BaseInteraction,
  CommandInteraction,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  InteractionResponse,
  InteractionType,
  Message,
  MessageComponentInteraction,
  MessagePayload,
  PermissionResolvable,
  PermissionsBitField
} from "discord.js";

import { castArray, isString, maxBy, padStart } from "lodash";
import { MedleyAutomaton } from "../automaton";
import { ansi, Colors, ColorsAndFormat, Formats, simpleFormat } from "./ansi";
import { CommandError } from "./type";

export const maxSelectMenuOptions = 25;

export type MentionType = 'user' | 'channel' | 'role';

export const formatMention = (type: MentionType, id: string) => {
  const p = ({user: '@', channel: '#', role: '@#'})[type];
  return `<${p}${id}>`;
}

type ReplyableInteraction = CommandInteraction | MessageComponentInteraction;

/** @deprecated */
export enum HighlightTextType {
  Cyan = 'yaml',
  Yellow = 'fix',
  Red = 'diff'
}

type Strings = (string | undefined)[];

/** @deprecated */
export function makeHighlightedMessage(s: Strings, type: HighlightTextType) {
  const isRed = type === HighlightTextType.Red;
  return '```' + type + '\n' +
    castArray(s).filter(isString).map(line => (isRed ? '-' : '') + line).join('\n') + '\n' +
    '```'
    ;
}

export function makeCodeBlockMessage(s: string | Strings, lang: string): Strings {
  return [
    '```' + lang,
    ...castArray(s),
    '```'
  ]
}

export const makeAnsiCodeBlock = (s: string | Strings) => makeCodeBlockMessage(s, 'ansi');

export function makeColoredMessage(color: ColorsAndFormat, s: string | Strings) {
  const [c, f = 'n'] = color.split('|', 1) as [color: Colors, f: Formats];
  const formatted = simpleFormat(joinStrings(s), `${c}|${f}`);
  return makeAnsiCodeBlock(formatted).join('\n')
}

export const reply = async (interaction: ReplyableInteraction, options: string | MessagePayload | InteractionReplyOptions | InteractionEditReplyOptions) =>
  !interaction.replied && !interaction.deferred
    ? interaction.reply(options as string | MessagePayload | InteractionReplyOptions)
    : interaction.editReply(options);

type DeclareOptions = {
  ephemeral?: boolean;
  mention?: {
    type: MentionType;
    subject: string;
  }
}

type SimpleDeclareFn = (interaction: ReplyableInteraction, s: string | Strings, options?: DeclareOptions) => Promise<Message<boolean> | InteractionResponse<boolean>>;

export const joinStrings = (s: string | Strings) => castArray(s).filter(isString).join('\n');

export const declare: SimpleDeclareFn = (interaction, s, options) => reply(interaction, {
  content: joinStrings([
    options?.mention ? formatMention(options.mention.type, options.mention.subject) : undefined,
    ...castArray(s)
  ]),
  ephemeral: options?.ephemeral
});

export const accept: SimpleDeclareFn = (interaction, s, ephemeral?) =>
  declare(interaction, makeColoredMessage('blue', s), ephemeral);

export const deny: SimpleDeclareFn = (interaction, s, ephemeral?) =>
  declare(interaction, makeColoredMessage('red', s), ephemeral);

export const warn: SimpleDeclareFn = (interaction, s, ephemeral?) =>
  declare(interaction, makeColoredMessage('yellow', s), ephemeral);

export function permissionGuard(permissions: PermissionsBitField | null, perm: PermissionResolvable, checkAdmin: boolean = true) {
  if (permissions && !permissions.any(perm, checkAdmin)) {
    throw new CommandError('Insufficient permissions');
  }
}

export function isReplyable(interaction: BaseInteraction): interaction is ReplyableInteraction {
  return interaction.type === InteractionType.ApplicationCommand || interaction.type === InteractionType.MessageComponent;
}

export function guildIdGuard(interaction: BaseInteraction): string {

  const { guildId } = interaction;

  if (!guildId) {
    throw new CommandError('Not in a guild');
  }

  return guildId;
}

export function guildStationGuard(automaton: MedleyAutomaton, interaction: BaseInteraction): { guildId: string, station: Station } {
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

const previewTrack = ({ index, track }: TrackPeek<StationRequestedTrack>, padding: number, focus: number | undefined) => {
  const isFocusing = focus === index;
  const label = padStart(`${index + 1}`, padding);
  return ansi`${isFocusing ? '{{bgDarkBlue|b}}' : ''}{{pink}}${label}{{${isFocusing ? 'blue' : 'white'}}}: ${getTrackBanner(track)} {{red|b}}[${track.priority || 0}]`;
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

  return lines.length ? makeAnsiCodeBlock(lines) : undefined;
}

export const formatDuration = (seconds: number) => seconds > 0
  ? ([[1, 60], [60, 60], [60 * 60, 24, true]] as [number, number, boolean | undefined][])
    .reverse()
    .map(([d, m, optional]) => {
      const v = Math.trunc(seconds / d) % m;
      return (v !== 0 || !optional)
        ? `${v}`.padStart(2, '0')
        : undefined
    })
    .filter(v => v !== undefined)
    .join(':')
  : undefined

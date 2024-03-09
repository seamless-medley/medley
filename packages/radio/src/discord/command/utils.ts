import { getTrackBanner, TrackPeek, Station, StationRequestedTrack, AudienceType, TrackWithRequester, BoomBoxTrack, Audience } from "@seamless-medley/core";
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
import { ansi, Colors, ColorsAndFormat, Formats, simpleFormat } from "../format/ansi";
import { formatMention, MentionType } from "../format/format";
import { CommandError, Strings } from "./type";

export const maxSelectMenuOptions = 25;

type ReplyableInteraction = CommandInteraction | MessageComponentInteraction;

export function makeCodeBlockMessage(s: string | Strings, lang: string): Strings {
  const items = castArray(s);

  if (!items.length) {
    return [];
  }

  return [
    '```' + lang,
    ...items,
    '```'
  ]
}

export const makeBlockmessage = (s: string | Strings) => makeCodeBlockMessage(s, '');

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

  const state = automaton.getGuildState(guildId);

  if (!state) {
    throw new CommandError('Unknown guild ' + interaction.guild?.name);
  }

  const station = state.tunedStation;

  if (!station) {
    throw new CommandError('No station linked');
  }

  return {
    guildId,
    station
  }
}

const previewTrackPeek = ({ index, localIndex, track }: TrackPeek<StationRequestedTrack>, padding: number, focus?: number) => {
  const isFocusing = focus === index;
  const label = padStart(`${localIndex + 1}`, padding);
  const priority = track.priority ? ` {{red|b}}[${track.priority}]` : '';
  return ansi`${isFocusing ? '{{bgDarkBlue|b}}' : ''}{{pink}}${label}{{${isFocusing ? 'blue' : 'white'}}}: ${getTrackBanner(track)}${priority}`;
}

export function isTrackRequestedFromGuild(track: TrackWithRequester<BoomBoxTrack, Audience>, guildId: string) {
  return track.requestedBy.some(({ type, group }) => (type === AudienceType.Discord) && (group.guildId === guildId));
}

export function peekRequestsForGuild(station: Station, bottomIndex: number, count: number, guildId: string) {
  return station.allRequests.peek(
    bottomIndex, count,
    track => isTrackRequestedFromGuild(track, guildId)
  );
}

export type MakePeekPreviewOptions = {
  bottomIndex?: number;

  focusIndex?: number;

  /**
   * @default 5
   */
  count?: number;
}

export type MakeRequestPreviewOptions = MakePeekPreviewOptions & {
  guildId: string;
}

export async function makeRequestPreview(station: Station, options: MakeRequestPreviewOptions) {
  const { bottomIndex = 0, focusIndex, count = 5, guildId } = options;
  const peekings = peekRequestsForGuild(station, bottomIndex, count, guildId);

  if (peekings.length <= 0) {
    return;
  }

  const padding = 2 + (maxBy(peekings, 'index')?.index.toString().length || 0);

  const lines: string[] = [];

  const topItem = peekings.at(0)!;

  const topMost = (topItem.localIndex > 0) ? station.allRequests.find(track => isTrackRequestedFromGuild(track, guildId)) : undefined;

  if (topMost) {
    peekings.splice(0, 1);

    lines.push(previewTrackPeek({ index: -1, localIndex: 0, track: topMost }, padding, undefined));
    lines.push(padStart('...', padding));
  }

  for (const peek of peekings) {
    lines.push(previewTrackPeek(peek, padding, focusIndex));
  }

  return lines.length ? makeAnsiCodeBlock(lines) : undefined;
}

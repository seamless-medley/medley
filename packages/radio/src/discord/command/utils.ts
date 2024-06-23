import {
  getTrackBanner,
  TrackPeek,
  Station,
  StationRequestedTrack,
  AudienceType,
  TrackWithRequester,
  BoomBoxTrack,
  Requester
} from "@seamless-medley/core";

import {
  BaseInteraction,
  InteractionDeferReplyOptions,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  InteractionResponse,
  Message,
  MessagePayload,
  PermissionResolvable,
  PermissionsBitField
} from "discord.js";

import { castArray, isString, maxBy, noop, padStart } from "lodash";
import { MedleyAutomaton } from "../automaton";
import { ansi, Colors, ColorsAndFormat, Formats, simpleFormat } from "../format/ansi";
import { formatMention, MentionType } from "../format/format";
import { AutomatonCommandError, CommandError, GuardError, Strings } from "./type";

export const maxSelectMenuOptions = 25;

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

export const deferReply = async (interaction: BaseInteraction, options?: InteractionDeferReplyOptions) => {
  if (!interaction.isRepliable()) {
    return;
  }

  if (!interaction.deferred && !interaction.replied) {
    return interaction.deferReply(options).catch(noop);
  }
}

export const reply = async (interaction: BaseInteraction, options: string | MessagePayload | InteractionReplyOptions | InteractionEditReplyOptions) => {
  if (!interaction.isRepliable()) {
    return;
  }

  return !interaction.replied && !interaction.deferred
    ? interaction.reply(options as string | MessagePayload | InteractionReplyOptions)
    : interaction.editReply(options);
}

type DeclareOptions = {
  ephemeral?: boolean;
  mention?: {
    type: MentionType;
    subject: string;
  }
}

type SimpleDeclareFn = (interaction: BaseInteraction, s: string | Strings, options?: DeclareOptions) => Promise<void | Message<boolean> | InteractionResponse<boolean>>;

export const joinStrings = (s: string | Strings) => castArray(s).filter(isString).join('\n');

export const declare: SimpleDeclareFn = (interaction, s, options) => reply(interaction, {
  content: joinStrings([
    options?.mention ? formatMention(options.mention.type, options.mention.subject) : undefined,
    ...castArray(s)
  ]),
  ephemeral: options?.ephemeral
});

export const accept: SimpleDeclareFn = (interaction, s, options?) =>
  declare(interaction, makeColoredMessage('blue', s), options);

export const deny: SimpleDeclareFn = (interaction, s, options?) =>
  declare(interaction, makeColoredMessage('red', s), options);

export const warn: SimpleDeclareFn = (interaction, s, options?) =>
  declare(interaction, makeColoredMessage('yellow', s), options);

export function permissionGuard(permissions: PermissionsBitField | null, perm: PermissionResolvable, checkAdmin: boolean = true) {
  if (permissions && !permissions.any(perm, checkAdmin)) {
    throw new CommandError('Insufficient permissions');
  }
}

export function guildIdGuard(interaction: BaseInteraction): string {

  const { guildId } = interaction;

  if (!guildId) {
    throw new CommandError('Not in a guild');
  }

  return guildId;
}

export function guildStationGuard(automaton: MedleyAutomaton, interaction: BaseInteraction, errorMessage?: string): { guildId: string, station: Station } {
  const guildId = guildIdGuard(interaction);

  const state = automaton.getGuildState(guildId);

  if (!state) {
    throw new AutomatonCommandError(automaton, 'Unknown guild ' + interaction.guild?.name);
  }

  const station = state.tunedStation;

  if (!station) {
    throw new GuardError(automaton, errorMessage ?? 'No station linked');
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

export function isTrackRequestedFromGuild(track: TrackWithRequester<BoomBoxTrack, Requester>, guildId: string) {
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
  const firstPeekLocalIndex = peekings.at(0)?.localIndex ?? -1;

  if (topMost && firstPeekLocalIndex > 0) {
    lines.push(previewTrackPeek({ index: -1, localIndex: 0, track: topMost }, padding, undefined));

    if (firstPeekLocalIndex > 1) {
      peekings.splice(0, 1);
      lines.push(padStart('...', padding));
    }
  }

  for (const peek of peekings) {
    lines.push(previewTrackPeek(peek, padding, focusIndex));
  }

  return lines.length ? makeAnsiCodeBlock(lines) : undefined;
}

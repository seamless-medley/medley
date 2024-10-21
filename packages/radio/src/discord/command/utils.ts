import {
  getTrackBanner,
  TrackPeek,
  Station,
  AudienceType,
  TrackWithRequester,
  BoomBoxTrack,
  Requester
} from "@seamless-medley/core";

import {
  BaseInteraction,
  GuildChannel,
  InteractionDeferReplyOptions,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  InteractionResponse,
  Message,
  MessagePayload,
  PermissionResolvable,
  PermissionsBitField
} from "discord.js";

import { castArray, chain, isString, max, noop, padStart } from "lodash";
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

export function guildStationGuard(automaton: MedleyAutomaton, interaction: BaseInteraction, errorMessage?: string) {
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
    guild: interaction.guild!,
    station
  }
}

type PreviewTrackOptions = {
  track: BoomBoxTrack;
  label: string;
  priority?: number;
  focused: boolean;
  padding: number
}

function previewTrack(options: PreviewTrackOptions) {
  const { track, label, priority, padding, focused } = options;
  const labelText = padStart(`${label}`, padding);
  const priorityText = priority ? ` {{red|b}}[${priority}]` : '';

  return ansi`${focused ? '{{bgDarkBlue|b}}' : ''}{{pink}}${labelText}{{${focused ? 'blue' : 'white'}}}: ${getTrackBanner(track)}${priorityText}`;
}

export function isTrackRequestedFromGuild(track: TrackWithRequester<BoomBoxTrack, Requester>, guildId: string) {
  return track.requestedBy.some(({ type, group }) => (type === AudienceType.Discord) && (group.guildId === guildId));
}

export type GuildTrackPeek = TrackPeek<TrackWithRequester<BoomBoxTrack, Requester>>;

export function peekRequestsForGuild(station: Station, centerIndex: number, count: number, guildId: string): Array<GuildTrackPeek> {
  return station.allRequests.peek(
    centerIndex, count,
    track => isTrackRequestedFromGuild(track, guildId)
  );
}

export type MakePeekPreviewOptions = {
  centerIndex?: number;

  focusIndex?: number;

  /**
   * @default 5
   */
  count?: number;
}

export type MakeRequestPreviewOptions = MakePeekPreviewOptions & {
  guildId: string;
}

export async function makeRequestPreview(station: Station, options: MakeRequestPreviewOptions): Promise<Strings | undefined> {
  const { centerIndex = -1, focusIndex, count = 5, guildId } = options;
  const peekings = peekRequestsForGuild(station, centerIndex, count, guildId);

  const cuedRequests = station.getFetchedRequests()
    .filter(track => isTrackRequestedFromGuild(track, guildId));

  if (peekings.length + cuedRequests.length <= 0) {
    return;
  }

  type PreviewConfig = {
    track: TrackWithRequester<BoomBoxTrack, Requester>;
    localIndex: number;
    requestIndex?: number;
  }

  const guildRequests = station.allRequests.all()
    .map((track, requestIndex) => ({ requestIndex, track }))
    .filter(({ track }) => isTrackRequestedFromGuild(track, guildId))
    .map<PreviewConfig>((item, localIndex) => ({ ...item, localIndex }))

  const configs: Array<PreviewConfig> = [];

  configs.push(...cuedRequests.map((track, cuedIndex) => ({
    track,
    localIndex: cuedIndex - cuedRequests.length,
  })));

  const headAndTail = [
    ...guildRequests.slice(0, 3),
    ...guildRequests.slice(-3)
  ];

  configs.push(...headAndTail.map(({ track, localIndex, requestIndex }) => ({
    track,
    requestIndex,
    localIndex
  })));

  configs.push(...peekings.map(({ track, localIndex, index: requestIndex }) => ({
    track,
    requestIndex,
    localIndex
  })));

  const fullConfigs = chain(configs)
    .uniqBy(cfg => cfg.requestIndex)
    .sortBy(cfg => cfg.requestIndex)
    .thru((o) => {
      const list: Array<PreviewConfig | undefined> = [];
      for (let i = 0; i < o.length; i++) {
        list.push(o[i]);

        if (i < o.length - 1) {
          const gap = o[i + 1].localIndex - o[i].localIndex - 1;

          if (gap > 0) {
            list.push(gap === 1 ? guildRequests.at(i + 1) : undefined);
          }
        }
      }

      return list;
    })
    .value();

  if (fullConfigs.length === 0) {
    return;
  }

  if (guildRequests.at(0)?.localIndex! > 0) {
    fullConfigs.unshift(undefined);
  }

  if (guildRequests.at(-1)?.localIndex! > fullConfigs.at(-1)?.localIndex!) {
    fullConfigs.push(undefined);
  }

  const cuedLabel = 'CUED';
  const padding = 2 + (cuedRequests.length > 0
    ? cuedLabel.length
    : max(fullConfigs.map(cfg => cfg ? cfg.localIndex.toString().length : 0)) || 0
  );

  return makeAnsiCodeBlock(fullConfigs.map((cfg) => cfg
    ? previewTrack({
        padding,
        label: cfg.localIndex < 0 ? cuedLabel : `${cfg.localIndex + 1}`,
        track: cfg.track,
        priority: cfg.track.priority,
        focused: focusIndex !== undefined && focusIndex === cfg.requestIndex,
      })
    : '...'
  ));
}

export function canSendMessageTo(channel: GuildChannel): boolean {
  const guild = channel.guild;
  const me = guild.members.me;

  if (!me) {
    return false;
  }

  return channel.members.has(me.id) && channel.permissionsFor(me).has(PermissionsBitField.Flags.SendMessages);
}

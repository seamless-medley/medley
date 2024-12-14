import {
  Requester,
  AudienceType,
  DeckPositions,
  isRequestTrack,
  Metadata,
  MetadataFields,
  Station,
  StationTrack,
  StationTrackPlay,
  TrackSequencingLatch,
  TrackWithRequester,
  CrateProfile
} from "@seamless-medley/core";

import { ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { chain, get, isEmpty, sample } from "lodash";
import { parse as parsePath } from 'node:path';
import { TrackMessage, TrackMessageStatus } from "../types";
import { CoverImageAttachment } from "../../helpers/message";

export type CreateTrackMessageOptions = {
  station: Station;
  trackPlay: StationTrackPlay;
  positions: DeckPositions;
  guildId: string;

  /**
   * A callback function to translate metadata `value` based on `kind` and return a new value
   */
  metadataLookup?: (kind: string, value: string) => Promise<string | undefined>;
}

export type CreateTrackMessageOptionsEx = CreateTrackMessageOptions & {
  embed: EmbedBuilder;
  requested?: TrackWithRequester<StationTrack, Requester>;
  requestedBy?: Requester[];
  track: StationTrack;
  playDuration: number;
}

export type CreatedTrackMessage = CreateTrackMessageOptionsEx & {
  embed: EmbedBuilder;
  cover?: CoverImageAttachment;
}

export abstract class TrackMessageCreator {
  abstract readonly name: string;

  protected abstract doCreate(options: CreateTrackMessageOptionsEx): Promise<CreatedTrackMessage>;

  async create(options: CreateTrackMessageOptions): Promise<TrackMessage> {
    const { guildId, station, trackPlay, positions, metadataLookup } = options;

    const requested = isRequestTrack<StationTrack, Requester>(trackPlay.track) ? trackPlay.track : undefined;
    const requestedBy = requested?.requestedBy;

    // Find the best track object by looking up the maybeCoverAndLyrics in which is already defined
    // If none was found, fallback to the track object from StationTrackPlay
    const track = [requested, requested?.original, trackPlay.track]
        .find((t): t is StationTrack => t?.extra?.maybeCoverAndLyrics !== undefined)
        ?? requested?.original ?? requested ?? trackPlay.track;

    const playDuration = positions.last! - positions.first!;

    const embed = new EmbedBuilder();
    embed.setTitle(requestedBy?.length ? 'Playing your request' : 'Playing');

    const created = await this.doCreate({
      station,
      trackPlay,
      positions,
      embed,
      guildId,
      requested,
      requestedBy,
      track,
      playDuration,
      metadataLookup
    });

    const lyricButton = new ButtonBuilder()
      .setLabel('Lyrics')
      .setEmoji('📜')
      .setStyle(ButtonStyle.Secondary)
      .setCustomId(`lyrics:${track.id}`);

    const skipButton = new ButtonBuilder()
      .setLabel('Skip')
      .setEmoji('⛔')
      .setStyle(ButtonStyle.Danger)
      .setCustomId(`skip:${trackPlay.uuid}`);

    const showMoreLikeThis = station.collections.length > 1 && !trackPlay.track.collection.latchDisabled;

    const moreButton = showMoreLikeThis
      ? new ButtonBuilder()
        .setLabel('More Like This')
        .setEmoji(sample(['❤️', '🧡', '💛', '💕', '💓', '💗', '💖', '💘', '💝'])!)
        .setStyle(ButtonStyle.Primary)
        .setCustomId(`latch:${trackPlay.track.collection.id}`)
      : undefined;

    return {
      station,
      trackPlay,
      status: TrackMessageStatus.Playing,
      playDuration,
      embed: created.embed,
      coverImage: created.cover?.builder,
      buttons: {
        lyric: lyricButton,
        skip: skipButton,
        more: moreButton
      },
      guildId
    }
  }
}


type EmbedDataForTrack = {
  description: string;
  fields: Partial<Record<MetadataFields, string>>;
  collection: string;
  profile?: CrateProfile<StationTrack>;
  latch?: TrackSequencingLatch<StationTrack, NonNullable<StationTrack['extra']>>;
}

export function getEmbedDataForTrack({ path, extra, sequencing, collection }: StationTrack, keys: MetadataFields[]): EmbedDataForTrack {
  let description = '';
  let collectionField = collection.id;
  let latch: EmbedDataForTrack['latch'];

  const fields: EmbedDataForTrack['fields'] = {};

  if (extra) {
    const { tags } = extra;

    if (tags) {
      const { title } = tags;

      if (title) {
        description = title;
      }

      for (const tag of keys) {
        const val = get<typeof tags, keyof Metadata, ''>(tags, tag, '').toString();

        if (!isEmpty(val)) {
          fields[tag] = val;
        }
      }
    }
  }

  if (!description) {
    description = parsePath(path).name;
  }

  if (collection.extra) {
    collectionField = collection.extra.description || collection.id;
    latch = sequencing?.latch;
  }

  const profile = sequencing?.crate?.profile;

  return {
    description,
    fields,
    collection: collectionField,
    profile,
    latch
  }
}

export function extractRequestersForGuild(guildId: string, requesters: Requester[]) {
  return chain(requesters)
    .map(({ type, group, requesterId }) => {
      if (type !== AudienceType.Discord) {
        return;
      }

      return (group.guildId === guildId) ? requesterId : undefined;
    })
    .filter((id): id is string => !!id)
    .uniq()
    .value()
}

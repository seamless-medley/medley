import {
  Audience,
  AudienceType,
  DeckPositions,
  isRequestTrack,
  Metadata,
  MetadataFields,
  MetadataHelper,
  Station,
  StationTrack,
  StationTrackCollection,
  StationTrackPlay,
  TrackSequencingLatch,
  TrackWithRequester
} from "@seamless-medley/core";

import { AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { chain, get, isEmpty, sample } from "lodash";
import mime from 'mime-types';
import { parse as parsePath } from 'path';
import { TrackMessage, TrackMessageStatus } from "../types";

export type CreateTrackMessageOptions = {
  station: Station;
  trackPlay: StationTrackPlay;
  positions: DeckPositions;
  guildId: string;
}

export type CreateTrackMessageOptionsEx = CreateTrackMessageOptions & {
  embed: EmbedBuilder;
  requested?: TrackWithRequester<StationTrack, Audience>;
  requestedBy?: Audience[];
  track: StationTrack;
  playDuration: number;
}

export abstract class TrackMessageCreator {
  abstract readonly name: string;

  protected abstract doCreate(options: CreateTrackMessageOptionsEx): Promise<CreateTrackMessageOptionsEx & Pick<TrackMessage, 'embed'> & { cover?: CoverImageAttachment }>;

  async create(options: CreateTrackMessageOptions): Promise<TrackMessage> {
    const { station, trackPlay, positions } = options;

    const requested = isRequestTrack<StationTrack, Audience>(trackPlay.track) ? trackPlay.track : undefined;
    const requestedBy = requested?.requestedBy;

    // Find the best track object by looking up the maybeCoverAndLyrics in which is already defined
    // If none was found, fallback to the track object from StationTrackPlay
    const track = [requested, requested?.original, trackPlay.track]
        .find((t): t is StationTrack => t?.extra?.maybeCoverAndLyrics !== undefined)
        ?? requested?.original ?? requested ?? trackPlay.track;

    const playDuration = positions.last! - positions.first!;

    const embed = new EmbedBuilder();
    embed.setTitle(requestedBy?.length ? 'Playing your request' : 'Playing');

    const { cover, ...created } = await this.doCreate({
      ...options,
      embed,
      requested,
      requestedBy,
      track,
      playDuration
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
      ...created,
      coverImage: cover?.builder,
      trackPlay,
      station,
      status: TrackMessageStatus.Playing,
      playDuration,
      buttons: {
        lyric: lyricButton,
        skip: skipButton,
        more: moreButton
      }
    }
  }
}

export type CoverImageAttachment = {
  builder: AttachmentBuilder;
  url: string;
}

export async function createCoverImageAttachment({ extra, path }: StationTrack): Promise<CoverImageAttachment | undefined> {
  if (!extra) {
    return;
  }

  const coverAndLyrics = await (extra.maybeCoverAndLyrics ?? MetadataHelper.coverAndLyrics(path));

  if (coverAndLyrics) {
    const { cover, coverMimeType } = coverAndLyrics;

    if (cover.length) {
      const ext = mime.extension(coverMimeType);
      const builder = new AttachmentBuilder(cover, { name: `cover.${ext}` });
      return {
        builder,
        url: `attachment://${builder.name}`
      }
    }
  }
}

type EmbedDataForTrack = {
  description: string;
  fields: Partial<Record<MetadataFields, string>>;
  collection: string;
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

  return {
    description,
    fields,
    collection: collectionField,
    latch
  }
}

export function extractRequestersForGuild(guildId: string, requesters: Audience[]) {
  return chain(requesters)
    .map(({ type, group, id }) => {
      if (type !== AudienceType.Discord) {
        return;
      }

      return group.guildId === guildId ? id : undefined;
    })
    .filter((id): id is string => !!id)
    .uniq()
    .value()
}

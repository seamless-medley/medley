import {
  Audience,
  BoomBoxTrack,
  BoomBoxTrackPlay,
  isRequestTrack,
  Metadata,
  MusicLibraryExtra,
  Station,
  extractAudienceGroup,
  AudienceType
} from "@seamless-medley/core";
import { MetadataHelper } from "@seamless-medley/core/src/metadata";

import {
  Message,
  ButtonStyle,
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  EmbedBuilder,
  MessageActionRowComponentBuilder,
  MessageEditOptions,
  APIEmbedField
} from "discord.js";

import { capitalize,
  isEmpty, get, sample } from "lodash";
import mime from 'mime-types';
import { parse as parsePath } from 'path';

export enum TrackMessageStatus {
  Playing,
  Paused,
  Ending,
  Played,
  Skipped
}

export type TrackMessage = {
  station: Station;
  trackPlay: BoomBoxTrackPlay;
  status: TrackMessageStatus;
  embed: EmbedBuilder;
  coverImage?: AttachmentBuilder;
  buttons: {
    skip?: ButtonBuilder,
    lyric?: ButtonBuilder,
    more?: ButtonBuilder
  };
  maybeMessage?: Promise<Message<boolean> | undefined>;
  lyricMessage?: Message;
}

export async function createTrackMessage(guildId: string, station: Station, trackPlay: BoomBoxTrackPlay): Promise<TrackMessage> {
  const requested = isRequestTrack<Audience>(trackPlay.track) ? trackPlay.track : undefined;
  const requestedBy = requested?.requestedBy;

  // Find the best track object by looking up the maybeCoverAndLyrics in which is already defined
  // If none was found, fallback to the track object from BoomBoxTrackPlay
  const track = [requested?.original, trackPlay.track]
      .find((t): t is BoomBoxTrack => t?.extra?.maybeCoverAndLyrics !== undefined)
      ?? requested?.original ?? trackPlay.track;


  const embed = new EmbedBuilder()
    .setColor('Random')
    .setTitle(requestedBy?.length ? 'Playing your request' : 'Playing');

  const { extra } = track;
  let shouldUseTrackPath = true;

  let coverImage: AttachmentBuilder | undefined;

  if (extra) {
    const { tags } = extra;

    if (tags) {
      const { title } = tags;

      if (title) {
        embed.setDescription(`> ${title}`);
        shouldUseTrackPath = false;
      }

      for (const tag of ['artist', 'album', 'genre']) {
        const val = get<typeof tags, keyof Metadata, ''>(tags,
          tag as keyof Metadata,
          ''
        ).toString();

        if (!isEmpty(val)) {
          embed.addFields({ name: capitalize(tag), value: `> ${val}`, inline: true });
        }
      }
    }

    const coverAndLyrics = await (extra.maybeCoverAndLyrics ?? MetadataHelper.coverAndLyrics(track.path));

    if (coverAndLyrics) {
      const { cover, coverMimeType } = coverAndLyrics;

      if (cover.length) {
        const ext = mime.extension(coverMimeType);
        coverImage = new AttachmentBuilder(cover, { name: `cover.${ext}` });
      }

    }
  }

  if (shouldUseTrackPath) {
    embed.setDescription(parsePath(track.path).name);
  }

  if (track.collection.extra) {
    const { description, owner: station } = track.collection.extra as MusicLibraryExtra<Station>;
    const { latch } = track.sequencing;

    const fields: APIEmbedField[] = [];

    fields.push({ name: 'Collection', value: description ?? track.collection.id });
    if (latch) {
      const { order, session } = latch;
      fields.push({ name: 'Latch', value: `${order} of ${session.max}`, inline: true });
    }
    fields.push({ name: 'Station', value: station.name });

    embed.addFields(fields);
  }

  const requesters = (requestedBy || [])
    .map(r => ({
      ...extractAudienceGroup(r.group),
      id: r.id
    }))
    .filter(({ type, groupId }) => type === AudienceType.Discord && groupId === guildId)
    .map(r => r.id);

  if (coverImage) {
    embed.setThumbnail(`attachment://${coverImage.name}`)
  }

  if (requestedBy?.length) {
    const mentions =  requesters.length > 0 ? requesters.map(id =>  `<@${id}>`).join(' ') : '> `Someone else`';
    embed.addFields({ name: 'Requested by', value: mentions });
  }

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

  const moreButton = station.isCollectionLatchable(trackPlay.track.collection)
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
    embed,
    coverImage,
    buttons: {
      lyric: lyricButton,
      skip: skipButton,
      more: moreButton
    }
  };
}

export type TrackMessageOptions = Pick<MessageEditOptions, 'embeds' | 'files' | 'components'> ;

export function trackMessageToMessageOptions<T>(msg: TrackMessage): TrackMessageOptions {
  const { embed, coverImage, buttons } = msg;

  const { lyric, skip, more } = buttons;

  let actionRow: ActionRowBuilder<MessageActionRowComponentBuilder> | undefined = undefined;

  if (lyric || skip || more) {
    actionRow = new ActionRowBuilder();

    if (lyric) {
      actionRow.addComponents(lyric);
    }

    if (more) {
      actionRow.addComponents(more);
    }

    if (skip) {
      actionRow.addComponents(skip);
    }
  }

  return {
    embeds: [embed],
    files: coverImage ? [coverImage] : undefined,
    components: actionRow ? [actionRow] : []
  }
}

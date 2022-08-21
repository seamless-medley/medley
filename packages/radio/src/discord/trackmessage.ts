import {
  RequestAudience,
  BoomBoxTrack,
  BoomBoxTrackPlay,
  isRequestTrack,
  Metadata,
  MusicLibraryExtra,
  Station,
  extractAudienceGroup,
  AudienceType
} from "@seamless-medley/core";

import {
  Message,
  ButtonStyle,
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  EmbedBuilder,
  MessageActionRowComponentBuilder,
  MessageOptions,
  MessageEditOptions
} from "discord.js";

import { capitalize,
  isEmpty, get } from "lodash";
import mime from 'mime-types';
import { parse as parsePath } from 'path';

export enum TrackMessageStatus {
  Playing,
  Paused,
  Played,
  Skipped
}

export type TrackMessage = {
  trackPlay: BoomBoxTrackPlay;
  status: TrackMessageStatus;
  embed: EmbedBuilder;
  coverImage?: AttachmentBuilder;
  buttons: {
    skip?: ButtonBuilder,
    lyric?: ButtonBuilder
  };
  sentMessage?: Message;
  lyricMessage?: Message;
}

export async function createTrackMessage(guildId: string, trackPlay: BoomBoxTrackPlay, actualTrack?: BoomBoxTrack): Promise<TrackMessage> {
  const requested = isRequestTrack<RequestAudience>(trackPlay.track) ? trackPlay.track : undefined;
  const requestedBy = requested?.requestedBy;
  const track  = actualTrack ?? requested?.original ?? trackPlay.track;

  const embed = new EmbedBuilder()
    .setColor('Random')
    .setTitle(requestedBy?.length ? 'Playing your request' : 'Playing');

  const { extra } = track;

  let coverImage: AttachmentBuilder | undefined;

  if (extra) {
    const { tags, maybeCoverAndLyrics } = extra;
    if (tags) {
      const { title } = tags;

      if (title) {
        embed.setDescription(`> ${title}`);
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

    const coverAndLyrics = await maybeCoverAndLyrics;

    if (coverAndLyrics) {
      const { cover, coverMimeType } = coverAndLyrics;

      if (cover.length) {
        embed.setColor('Random');

        const ext = mime.extension(coverMimeType);
        coverImage = new AttachmentBuilder(cover, { name: `cover.${ext}` });
      }

    }
  } else {
    embed.setDescription(parsePath(track.path).name);
  }

  if (track.collection.extra) {
    const { descriptor: { description }, owner: station } = track.collection.extra as MusicLibraryExtra<Station>;

    embed.addFields(
      { name: 'Collection', value: description ?? track.collection.id },
      { name: 'Station', value: station.name }
    );
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

  return {
    trackPlay,
    status: TrackMessageStatus.Playing,
    embed,
    coverImage,
    buttons: {
      lyric: lyricButton,
      skip: skipButton
    }
  };
}

export type TrackMessageOptions = Pick<MessageOptions & MessageEditOptions, 'embeds' | 'files' | 'components'> ;

export function trackMessageToMessageOptions<T>(msg: TrackMessage): TrackMessageOptions {
  const { embed, coverImage, buttons } = msg;

  const { lyric, skip } = buttons;

  let actionRow: ActionRowBuilder<MessageActionRowComponentBuilder> | undefined = undefined;

  if (lyric || skip) {
    actionRow = new ActionRowBuilder();

    if (lyric) {
      actionRow.addComponents(lyric);
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

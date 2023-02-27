import { DeckPositions, Station, StationTrackPlay } from '@seamless-medley/core';
import { ActionRowBuilder, MessageActionRowComponentBuilder, MessageEditOptions } from 'discord.js';
import { makeCreator } from './creator';
import { TrackMessage } from './types';

/** @deprecated */
export async function createTrackMessage(guildId: string, station: Station, trackPlay: StationTrackPlay, positions: DeckPositions): Promise<TrackMessage> {
  return makeCreator('extended').create({
    guildId,
    station,
    trackPlay,
    positions
  });
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


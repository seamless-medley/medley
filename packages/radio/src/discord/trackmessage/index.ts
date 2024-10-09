import { ActionRowBuilder, BaseChannel, ChannelType, MessageActionRowComponentBuilder, MessageEditOptions, StageChannel, TextChannel, VoiceChannel } from 'discord.js';
import { TrackMessage } from './types';

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

export function isChannelSuitableForTrackMessage(c: BaseChannel): c is TextChannel | VoiceChannel | StageChannel {
  return (c?.type !== undefined) && ([
    ChannelType.GuildText,
    ChannelType.GuildVoice,
    ChannelType.GuildStageVoice
  ]).includes(c.type);
}


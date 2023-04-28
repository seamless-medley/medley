import { MetadataFields } from "@seamless-medley/core";
import { APIEmbedField } from "discord.js";
import { chunk, isEmpty, startCase, upperCase } from "lodash";
import { formatDuration, formatMention } from "../../command/utils";
import { formatSpotifyField, metadataFields } from "../fields";
import { createCoverImageAttachment, CreateTrackMessageOptionsEx, extractRequestersForGuild, getEmbedDataForTrack, TrackMessageCreator } from "./base";

const emptyField = { name: '\u200B', value: '\u200B', inline: true };
const emptyRows = Array(3).fill(0).map<APIEmbedField>(_ => emptyField);

const fieldCaptionFuncs: Partial<Record<MetadataFields, () => any>> = {
  bpm: upperCase,
  isrc: upperCase
};

export class Normal extends TrackMessageCreator {
  protected async doCreate(options: CreateTrackMessageOptionsEx) {
    const { station, embed, guildId, track, playDuration, requestedBy } = options;

    const data = getEmbedDataForTrack(track, metadataFields);
    const cover = await createCoverImageAttachment(track);

    (embed)
      .setAuthor({
        name: station.name,
        url: station.url,
        iconURL: station.iconURL
      })
      .setDescription(`> ${data.description}`);

    for (const group of chunk(metadataFields, 2)) {
      const fields = group.map<APIEmbedField | undefined>(field => {
          const val = data.fields[field];

          return val && !isEmpty(val)
            ? ({
              name: (fieldCaptionFuncs[field] ?? startCase)(field),
              value: `> ${formatSpotifyField(field, val)}`,
              inline: true
            })
            : undefined
        })
        .filter((f): f is APIEmbedField => f !== undefined)

      if (fields.length > 0) {
        embed.addFields(fields.length < 3
          ? fields.concat(emptyRows).slice(0, emptyRows.length)
          : fields);
      }
    }

    embed.addFields({
      name: 'Collection',
      value: data.collection
    });

    if (data.latch) {
      const { order, session } = data.latch;
      embed.addFields({ name: 'Latch', value: `${order} of ${session.max}` });
    }

    const requesters = extractRequestersForGuild(guildId, requestedBy || []);

    if (requestedBy?.length) {
      const mentions =  requesters.length > 0 ? requesters.map(id => formatMention('user', id)).join(' ') : '> `Someone else`';
      embed.addFields({ name: 'Requested by', value: mentions });
    }

    if (cover) {
      embed.setThumbnail(cover.url);
    }

    embed.addFields({
      name: 'Powered by',
      value: '> <:medley:1101521522830618624> [**Medley**](https://github.com/seamless-medley/medley)'
    });

    const durationText = formatDuration(playDuration);

    if (durationText) {
      embed.setFooter({
        text: `🎧 Duration: ${durationText}`
      })
    }

    embed.setTimestamp(new Date());

    return {
      ...options,
      embed,
      cover
    };
  }
}

import { MetadataFields } from "@seamless-medley/core";
import { APIEmbedField } from "discord.js";
import { chunk, isEmpty, startCase, upperCase } from "lodash";
import { formatDuration, formatMention } from "../../command/utils";
import { createCoverImageAttachment, CreateTrackMessageOptionsEx, extractRequestersForGuild, getEmbedDataForTrack, TrackMessageCreator } from "./base";

const emptyField = { name: '\u200B', value: '\u200B', inline: true };
const emptyRows = Array(3).fill(0).map<APIEmbedField>(_ => emptyField);

const spotifyMarkdownLink = (q: string) => `[${q}](https://open.spotify.com/search/${encodeURIComponent(q)})`;

const spotifySearchFields: MetadataFields[] = ['artist', 'album', 'albumArtist', 'originalArtist'];
const metadataFields: MetadataFields[] = spotifySearchFields;

const fieldCaptionFuncs: Partial<Record<MetadataFields, () => any>> = {
  bpm: upperCase,
  isrc: upperCase
};

export class Normal extends TrackMessageCreator {
  protected async doCreate(options: CreateTrackMessageOptionsEx) {
    const { station, embed, guildId, track, playDuration, requestedBy } = options;

    const data = getEmbedDataForTrack(track, metadataFields);
    const cover = await createCoverImageAttachment(track);

    embed.setColor('Random');
    embed.setAuthor({
      name: station.name,
      url: station.url,
      iconURL: station.iconURL
    });
    embed.setDescription(`> ${data.description}`);

    for (const group of chunk(metadataFields, 2)) {
      const fields = group.map<APIEmbedField | undefined>(field => {
          const val = data.fields[field];

          return val && !isEmpty(val)
            ? ({
              name: (fieldCaptionFuncs[field] ?? startCase)(field),
              value: `> ${spotifySearchFields.includes(field) ? spotifyMarkdownLink(val) : val}`,
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

    const durationText = formatDuration(playDuration);

    if (durationText) {
      embed.addFields({
        name: 'Duration 🎧',
        value: `**\`${durationText}\`**`,
        inline: true
      })
    }

    embed.addFields({
      name: 'Collection',
      value: data.collection,
      inline: true,
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

    embed.setFooter({
      text: 'Powered by Medley',
      iconURL: 'https://cdn.discordapp.com/emojis/1101521522830618624?size=96'
    });

    return {
      ...options,
      embed,
      cover
    };
  }
}

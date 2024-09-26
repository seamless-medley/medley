import { MetadataFields } from "@seamless-medley/core";
import { APIEmbedField, bold, hyperlink, inlineCode, quote, userMention } from "discord.js";
import { chunk, isEmpty, startCase, upperCase } from "lodash";
import { formatDuration } from "../../format/format";
import { CreateTrackMessageOptionsEx, extractRequestersForGuild, getEmbedDataForTrack, TrackMessageCreator } from "./base";
import { createCoverImageAttachment } from "../../helpers/message";
import { extractSpotifyMetadata, formatSpotifyField, spotifySearchLink, spotifyLink } from "../../helpers/spotify";

const emptyField = { name: '\u200B', value: '\u200B', inline: true };
const emptyRows = Array(3).fill(0).map<APIEmbedField>(_ => emptyField);

export const metadataFields: MetadataFields[] = ['artist', 'album', 'albumArtist', 'originalArtist'];

const fieldCaptionFuncs: Partial<Record<MetadataFields, () => any>> = {
  isrc: upperCase
};

export class Normal extends TrackMessageCreator {
  name = "normal";

  protected async doCreate(options: CreateTrackMessageOptionsEx) {
    const { station, embed, guildId, track, playDuration, requestedBy } = options;

    const data = getEmbedDataForTrack(track, metadataFields);
    const spotifyMetadata = extractSpotifyMetadata(track);
    const cover = await createCoverImageAttachment(track);

    (embed)
      .setAuthor({
        name: station.name,
        url: station.url,
        iconURL: station.iconURL
      })
      .setDescription(quote(
        spotifyMetadata.track
          ? spotifyLink(data.description, 'track', spotifyMetadata.track, "More about this track on Spotify")
          : spotifySearchLink(data.description, 'tracks')
      ));

    for (const group of chunk(metadataFields, 2)) {
      const fields = group.map<APIEmbedField | undefined>(field => {
          const val = data.fields[field];

          return val && !isEmpty(val)
            ? ({
              name: (fieldCaptionFuncs[field] ?? startCase)(field),
              value: quote(formatSpotifyField(field, val, spotifyMetadata[field])),
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

    const profileDisplay = data.profile ? data.profile.description || data.profile.name : undefined;
    const hasProfile = profileDisplay !== undefined;

    embed.addFields({
      name: 'Collection',
      value: data.collection,
      inline: hasProfile
    });

    if (hasProfile) {
      embed.addFields({
        name: 'Profile',
        value: profileDisplay,
        inline: true
      });
    }

    if (data.latch) {
      const { order: [count, max] } = data.latch;
      embed.addFields({ name: 'Latch', value: `${count} of ${max}` });
    }

    if (requestedBy?.length) {
      const requesters = extractRequestersForGuild(guildId, requestedBy);

      const mentions = [
          requesters.map(userMention).join(' '),
          requestedBy.length > requesters.length
            ? inlineCode(`${requestedBy.length - requesters.length} others`)
            : undefined
        ].filter(Boolean).join(' and ')

      embed.addFields({ name: 'Requested by', value: mentions });
    }

    if (cover) {
      embed.setThumbnail(cover.url);
    }

    embed.addFields({
      name: 'Powered by',
      value: quote(`${hyperlink(bold('Medley'), 'https://github.com/seamless-medley/medley', "GitHub project")}`)
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

import { MetadataFields } from "@seamless-medley/core";
import { APIEmbedField, blockQuote, bold, hyperlink, inlineCode, quote, userMention } from "discord.js";
import { chunk, isEmpty, startCase, upperCase, zip } from "lodash";
import { formatDuration } from "@seamless-medley/utils";
import { CreateTrackMessageOptionsEx, extractRequestersForGuild, getEmbedDataForTrack, TrackMessageCreator } from "./base";
import { createCoverImageAttachment } from "../../helpers/message";
import { extractSpotifyMetadata, formatSpotifyField, spotifySearchLink, spotifyLink } from "../../helpers/spotify";
import { joinStrings } from "../../command/utils";

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
    const spotifyIds = extractSpotifyMetadata(track);
    const cover = await createCoverImageAttachment(track, `track-message-${this.automaton.id}`);

    (embed)
      .setAuthor({
        name: station.name,
        url: station.url,
        iconURL: station.iconURL
      })
      .setDescription(quote(
        spotifyIds.track
          ? spotifyLink(data.description, 'track', spotifyIds.track, "More about this track on Spotify")
          : spotifySearchLink(data.description, 'tracks')
      ));

    for (const group of chunk(metadataFields, 2)) {
      const fieldsForEmbed = await Promise.all(group.map(async (field): Promise<APIEmbedField | undefined> => {
          const val = data.fields[field];

          if (!val || isEmpty(val)) {
            return
          }

          const fieldTitle = (fieldCaptionFuncs[field] ?? startCase)(field);
          const spotifyId = spotifyIds[field];

          if (/artist/i.test(field) && spotifyId) {
            const artistIds = spotifyId.split(',');

            // Found artist field with multiple spotify id
            if (artistIds.length > 1) {
              let artistNames = val.split(/[/,]/);

              let aligned = (artistNames.length > 0) && (artistNames.length % artistIds.length) === 0;

              if (!aligned) {
                // Try to align it by using metadataLookup
                const { metadataLookup } = options;

                if (metadataLookup) {
                  aligned = true;

                  const newNames: string[] = [];

                  for (const artistId of artistIds) {
                    const name = await metadataLookup('spotify:artist', artistId);

                    if (!name) {
                      // could not lookup, this is likely to be un-aligned, stop lookup now
                      aligned = false;
                      break;
                    }

                    newNames.push(name);
                  }

                  if (aligned) {
                    artistNames = newNames;
                  }
                }
              }

              // names and ids are aligned
              if (aligned) {
                const alignment = artistNames.length / artistIds.length;
                const artistGroups = chunk(artistNames, alignment).map(g => g.join('/'));

                const artistText = zip(artistGroups, artistIds)
                  .map(([group, id]) => formatSpotifyField(field, group!, id))
                  .join(', ');

                return {
                  name: fieldTitle,
                  value: quote(artistText),
                  inline: true
                }
              }

              // Un-aligned, use the first id instead
              return {
                name: fieldTitle,
                value: quote(formatSpotifyField(field, val, artistIds[0])),
                inline: true
              }
            }
          }

          return {
            name: fieldTitle,
            value: quote(formatSpotifyField(field, val, spotifyId)),
            inline: true
          }
        })
      );

      const embedFields = fieldsForEmbed.filter((f): f is APIEmbedField => f !== undefined);

      if (embedFields.length > 0) {
        embed.addFields(embedFields.length < 3
          ? embedFields.concat(emptyRows).slice(0, emptyRows.length)
          : embedFields);
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
      value: blockQuote(joinStrings([
        hyperlink(bold('Medley'), 'https://github.com/seamless-medley/medley', "GitHub project"),
        hyperlink('Discord Server', 'https://discord.gg/vrzCvV2hjS', "Discord Server")
      ]))
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

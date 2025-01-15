import { BoomBoxCoverAnyLyrics, getTrackBanner, MetadataHelper, searchLyrics, StationTrack } from "@seamless-medley/core";
import { ButtonInteraction, Message, AttachmentBuilder, EmbedBuilder, hyperlink, messageLink, inlineCode } from "discord.js";
import { findLast } from "lodash";
import { CommandDescriptor, InteractionHandlerFactory } from "../type";
import { deferReply, deny, guildStationGuard, joinStrings, reply, warn } from "../utils";
import { LyricsSearchResult } from "@seamless-medley/core/src/metadata/lyrics/types";
import { lyricsToText, parseLyrics } from "@seamless-medley/utils";

const createButtonHandler: InteractionHandlerFactory<ButtonInteraction> = (automaton) => async (interaction, trackId: StationTrack['id']) => {
  const { guildId, station } = guildStationGuard(automaton, interaction);

  const track = station.findTrackById(trackId);

  if (!track) {
    deny(interaction, 'Invalid track identifier', { ephemeral: true });
    return;
  }

  const state = automaton.getGuildState(guildId);
  const trackMsg = state ? findLast(state.trackMessages, m => m.trackPlay.track.id === trackId) : undefined;

  if (!trackMsg) {
    warn(interaction, 'Track has been forgotten');
    return;
  }

  const banner = getTrackBanner(track);

  if (trackMsg?.lyricMessage) {
    const { id: messageId, channelId } = trackMsg.lyricMessage;

    await interaction.reply(`${interaction.member} Lyrics for ${inlineCode(banner)} is right here: ${messageLink(channelId, messageId, guildId)}`)
    return;
  }

  const trackExtra = track.extra;

  const { lyrics: lyricsText, lyricsSource } = await new Promise<BoomBoxCoverAnyLyrics>(async (resolve) => {
    const bbCoverAndLyrics = await (trackExtra?.maybeCoverAndLyrics ?? MetadataHelper.coverAndLyrics(track.path));

    let { lyrics, lyricsSource } = bbCoverAndLyrics;
    const { cover, coverMimeType } = bbCoverAndLyrics;

    let searchResult: LyricsSearchResult | undefined;

    if (!lyrics && trackExtra?.tags) {
      const artist = trackExtra.tags.artist;
      const title = trackExtra.tags.title;

      if (artist && title) {
        await deferReply(interaction);

        searchResult = await searchLyrics(artist, title).catch(() => undefined);

        if (searchResult?.lyrics) {
          lyrics = searchResult.lyrics;
          lyricsSource = searchResult.source;
        }
      }
    }

    const parsed = parseLyrics(lyrics);

    const coverAndLyrics: BoomBoxCoverAnyLyrics = {
      cover,
      coverMimeType,
      lyricsSource,
      lyrics: parsed.timeline.length > 0
        ? joinStrings(lyricsToText(parsed, false))
        : lyrics.trim()
    }

    if (trackExtra) {
      trackExtra.maybeCoverAndLyrics = Promise.resolve(coverAndLyrics);
    }

    resolve(coverAndLyrics);
  })

  if (!lyricsText) {
    warn(interaction, 'No lyrics');
    automaton.removeLyricsButton(trackId);
    return
  }

  const lyricMessage = await reply(interaction, {
    embeds: [
      new EmbedBuilder()
        .setTitle('Lyrics')
        .setDescription(banner)
        .addFields(
          { name: 'Requested by', value: `${interaction.member}`, inline: true },
          {
            name: 'Source',
            value: lyricsSource.href ? hyperlink(lyricsSource.text, lyricsSource.href) : lyricsSource.text,
            inline: true
          }
        )
    ],
    files: [
      new AttachmentBuilder(Buffer.from(lyricsText), { name: `${banner} lyrics.txt` })
    ],
    fetchReply: true
  });

  if (trackMsg && lyricMessage instanceof Message) {
    trackMsg.lyricMessage = lyricMessage;
  }
}


const descriptor: CommandDescriptor = {
  createButtonHandler
}

export default descriptor;

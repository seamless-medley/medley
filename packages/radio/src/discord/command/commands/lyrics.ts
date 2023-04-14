import { CoverAndLyrics, getTrackBanner, lyricsToText, MetadataHelper, parseLyrics, StationTrack } from "@seamless-medley/core";
import { ButtonInteraction, Message, AttachmentBuilder, EmbedBuilder } from "discord.js";
import { findLast } from "lodash";
import { CommandDescriptor, InteractionHandlerFactory } from "../type";
import { deny, guildStationGuard, joinStrings, reply, warn } from "../utils";

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
    const referringMessage = await trackMsg.lyricMessage.reply({
      content: `${interaction.member} Lyrics for \`${banner}\` is right here ↖`,
    });

    setTimeout(() => referringMessage.delete(), 10_000);

    await interaction.reply('.');
    await interaction.deleteReply();
    return;
  }

  const trackExtra = track.extra;

  let lyricsText: string | undefined = undefined;
  let source = 'N/A';

  const { lyrics, cover, coverMimeType } = await (trackExtra?.maybeCoverAndLyrics ?? MetadataHelper.coverAndLyrics(track.path));

  if (lyrics) {
    const parsed = parseLyrics(lyrics);

    lyricsText = parsed.timeline.length > 0
      ? joinStrings(lyricsToText(parsed, false))
      : lyrics.trim();

    source = 'metadata';

  } else if (trackExtra?.tags) {
    const artist = trackExtra.tags.artist;
    const title = trackExtra.tags.title;

    if (artist && title) {
      await interaction.deferReply();

      trackExtra.maybeCoverAndLyrics = new Promise<CoverAndLyrics>(async (resolve) => {
        const lyrics = await MetadataHelper.searchLyrics(artist, title).catch(() => undefined);

        resolve({
          cover: cover ?? Buffer.alloc(0),
          coverMimeType: coverMimeType ?? '',
          lyrics: lyrics ?? ''
        });
      });

      lyricsText = (await trackExtra.maybeCoverAndLyrics).lyrics;
      if (lyricsText) {
        source = 'Google';
      }
    }
  }

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
          { name: 'Source', value: source, inline: true }
        )
    ],
    files: [
      new AttachmentBuilder(Buffer.from(lyricsText), { name: 'lyrics.txt' })
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

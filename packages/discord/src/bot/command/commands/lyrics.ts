import { BoomBoxTrack, getTrackBanner, lyricsToText, MetadataHelper, parseLyrics } from "@seamless-medley/core";
import { ButtonInteraction, Message, MessageAttachment, MessageEmbed } from "discord.js";
import { findLast } from "lodash";
import { CommandDescriptor, InteractionHandlerFactory } from "../type";
import { deny, guildStationGuard, reply, warn } from "../utils";

const createButtonHandler: InteractionHandlerFactory<ButtonInteraction> = (automaton) => async (interaction, trackId: BoomBoxTrack['id']) => {
  const { guildId, station } = guildStationGuard(automaton, interaction);

  const track = station.findTrackById(trackId);

  if (!track) {
    deny(interaction, 'Invalid track identifier', undefined, true);
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

  let lyricsText: string | undefined = undefined;
  let source = 'N/A';

  const lyrics = track.metadata?.coverAndLyrics?.lyrics;

  if (lyrics) {
    lyricsText = lyricsToText(parseLyrics(lyrics), false).join('\n');
    source = 'metadata';

  } else {
    const artist = track.metadata?.tags?.artist;
    const title = track.metadata?.tags?.title;

    if (artist && title) {
      await interaction.deferReply();
      lyricsText = await MetadataHelper.searchLyrics(artist, title).catch(() => undefined);
      source = 'Google';
    }
  }

  if (!lyricsText) {
    warn(interaction, 'No lyrics');
    automaton.removeLyricsButton(trackId);
    return
  }

  const lyricMessage = await reply(interaction, {
    embeds: [
      new MessageEmbed()
        .setTitle('Lyrics')
        .setDescription(banner)
        .addField('Requested by', `${interaction.member}`, true)
        .addField('Source', source, true)
    ],
    files: [
      new MessageAttachment(Buffer.from(lyricsText), 'lyrics.txt')
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
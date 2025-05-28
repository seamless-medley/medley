// @ts-check
const { Musixmatch } = require('./client');

/**
 * @typedef {import("../types").LyricsSearcher} LyricsSearcher
 * @typedef {import("../types").LyricProviderName} LyricProviderName
 * @typedef {import("../types").LyricsSearchResult} LyricsSearchResult
 */

/**
 * @type {LyricProviderName}
 */
const sourceName = 'musixmatch';

/** @type {import("../../../playout").LyricSource} */
const source = {
  text: 'Musixmatch',
  href: 'https://www.musixmatch.com'
}

/**
 * @implements {LyricsSearcher}
 */
class Searcher {
  /**
   * @private
   * @type {Musixmatch}
   */
  client = new Musixmatch();

  /**
   *
   * @param {string} artist
   * @param {string} title
   * @returns {Promise<LyricsSearchResult | undefined>}
   */
  async searchLyrics(artist, title) {
    if (!title || !artist) {
      return;
    }

    try {
      const mmTracks = await this.client.search(title, artist);

      if (mmTracks.length === 0) {
        return;
      }

      const trackWithSubTitle = mmTracks.find(s => s.has_subtitles);

      if (trackWithSubTitle?.commontrack_id) {
        const subtitle = await this.client.subtitle({ commontrack_id: trackWithSubTitle.commontrack_id });
        if (subtitle) {
          return {
            source,
            lyrics: subtitle.subtitle_body
          }
        }
      }

      const trackWithLyrics = mmTracks.find(s => s.has_lyrics);

      if (trackWithLyrics?.commontrack_id) {
        const lyrics = await this.client.lyrics({ commontrack_id: trackWithLyrics.commontrack_id });
        if (lyrics) {
          return {
            source,
            lyrics: lyrics.lyrics_body
          }
        }
      }
    }
    catch {

    }
  }
}

module.exports = {
  sourceName,
  Searcher
}

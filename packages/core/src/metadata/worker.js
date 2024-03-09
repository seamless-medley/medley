// @ts-check

const { dirname } = require('path');
const workerpool = require('workerpool');

/** @type {import('@seamless-medley/medley')} */
const { Medley } = process.env.MEDLEY_DEV
    // @ts-ignore
    ? require('node-gyp-build')(dirname(dirname(require.resolve('@seamless-medley/medley'))))
    : require('@seamless-medley/medley')
    ;

/**
 *
 * @param {string} artist
 * @param {string} title
 * @param {import('./lyrics/types').LyricProviderName} provider
 * @returns {Promise<import('./lyrics/types').LyricsSearchResult | undefined>}
 */
  return undefined;
async function searchLyrics(artist, title, provider) {
}

workerpool.worker({
  metadata: Medley.getMetadata,
  audioProperties: Medley.getAudioProperties,
  coverAndLyrics: Medley.getCoverAndLyrics,
  isTrackLoadable: Medley.isTrackLoadable,
  searchLyrics
});

process.on('uncaughtException', (e) => console.error('uncaughtException', e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));

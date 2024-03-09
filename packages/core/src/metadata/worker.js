// @ts-check

const { dirname } = require('path');
const workerpool = require('workerpool');

/** @type {import('@seamless-medley/medley')} */
const { Medley } = process.env.MEDLEY_DEV
    // @ts-ignore
    ? require('node-gyp-build')(dirname(dirname(require.resolve('@seamless-medley/medley'))))
    : require('@seamless-medley/medley')
    ;

// TODO: Refactor this
/**
 *
 * @param {string} artist
 * @param {string} title
 * @returns {Promise<{ source: LyricSource; lyrics: string[] } | undefined>}
 */
async function searchLyrics(artist, title) {
  return undefined;
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

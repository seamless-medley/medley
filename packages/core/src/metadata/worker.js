// @ts-check

const { dirname } = require('path');
const workerpool = require('workerpool');

/** @type {import('@seamless-medley/medley')} */
const { Medley } = require('@seamless-medley/medley');

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
  coverAndLyrics: Medley.getCoverAndLyrics,
  isTrackLoadable: Medley.isTrackLoadable,
  searchLyrics
});

process.on('uncaughtException', (e) => console.error('uncaughtException', e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));

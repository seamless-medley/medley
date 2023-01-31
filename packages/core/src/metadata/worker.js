// @ts-check

const { dirname } = require('path');
const workerpool = require('workerpool');
const lyricsSearcher = require('lyrics-searcher');

/** @type {import('@seamless-medley/medley')} */
const { Medley } = process.env.MEDLEY_DEV
    // @ts-ignore
    ? require('node-gyp-build')(dirname(dirname(require.resolve('@seamless-medley/medley'))))
    : require('@seamless-medley/medley')


workerpool.worker({
  metadata: Medley.getMetadata,
  coverAndLyrics: Medley.getCoverAndLyrics,
  isTrackLoadable: Medley.isTrackLoadable,
  searchLyrics: lyricsSearcher
});

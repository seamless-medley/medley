// @ts-check

const workerpool = require('workerpool');
const lyricsSearcher = require('lyrics-searcher');

/** @type {import('@seamless-medley/medley')} */
const { Medley } = require('node-gyp-build')(process.cwd() + '/../core/node_modules/@seamless-medley/medley');

workerpool.worker({
  metadata: Medley.getMetadata,
  coverAndLyrics: Medley.getCoverAndLyrics,
  isTrackLoadable: Medley.isTrackLoadable,
  searchLyrics: lyricsSearcher
});
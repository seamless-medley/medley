const workerpool = require('workerpool');
const lyricsSearcher = require('lyrics-searcher');
const { Medley } = require('node-gyp-build')(process.cwd() + '/../core/node_modules/@seamless-medley/medley');

workerpool.worker({
  metadata: Medley.getMetadata,
  coverAndLyrics: Medley.getCoverAndLyrics,
  searchLyrics: lyricsSearcher
});
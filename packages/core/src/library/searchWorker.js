// @ts-check

const { get, noop } = require('lodash');
const workerpool = require('workerpool');
const MiniSearch = require('minisearch');

/** @typedef {import('minisearch').default<TrackIndex>} Search */
/** @typedef {import('minisearch').Query} Query */
/** @typedef {import('minisearch').SearchOptions} SearchOptions */
/** @typedef {import('./search').TrackIndex} TrackIndex */

/** @type {Map<string, Search>} */
const instances = new Map();

/**
 *
 * @param {string} id
 */
function acquire(id) {
  if (instances.has(id)) {
    return instances.get(id);
  }

  /** @type {Search} */
  // @ts-expect-error
  const miniSearch = new MiniSearch({
    fields: ['artist', 'title'],
    extractField: get
  });

  instances.set(id, miniSearch);

  return miniSearch;
}

/**
 *
 * @param {string} id
 * @param {TrackIndex} track
 */
function add(id, track) {
  acquire(id).add(track);
}

/**
 *
 * @param {string} id
 * @param {TrackIndex[]} tracks
 */
function removeAll(id, tracks) {
  acquire(id).removeAll(tracks);
}

/**
 *
 * @param {string} id
 * @param {Query} query
 * @param {SearchOptions | undefined} searchOptions
 */
function search(id, query, searchOptions) {
  return acquire(id).search(query, searchOptions)
}

/**
 *
 * @param {string} id
 * @param {string} queryString
 * @param {SearchOptions | undefined} options
 */
function autoSuggest(id, queryString, options) {
  return acquire(id).autoSuggest(queryString, options)
}

workerpool.worker({
  add,
  removeAll,
  search,
  autoSuggest
});

process.on('uncaughtException', noop);
process.on('unhandledRejection', noop);

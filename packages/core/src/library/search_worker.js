// @ts-check

const { noop, omit } = require('lodash');
const workerpool = require('workerpool');
const MiniSearch = require('minisearch');

/** @typedef {import('minisearch').default<TrackIndex>} Search */
/** @typedef {import('minisearch').Query} Query */
/** @typedef {import('minisearch').SearchOptions} MiniSearchOptions */
/** @typedef {import('./search').SearchOptions} SearchOptions */
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

  const fields = ['artist', 'title'];

  /** @type {Search} */
  // @ts-expect-error
  const miniSearch = new MiniSearch({
    fields,
    storeFields: fields
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
  const { narrow } = options;

  /** @type {MiniSearchOptions} */
  const miniSearchOptions = omit(options, 'narrow');

  if (narrow) {
    miniSearchOptions.filter = (result) => {
      /** @type {string?} */
      const narrowing = result[narrow.by];
      const match = narrowing?.toLowerCase().includes(narrow.term) ?? false;
      return match;
    }
  }

  return acquire(id).autoSuggest(queryString, miniSearchOptions);
}

workerpool.worker({
  add,
  removeAll,
  search,
  autoSuggest
});

process.on('uncaughtException', noop);
process.on('unhandledRejection', noop);

// @ts-check

const { noop, omit } = require('lodash');
const workerpool = require('workerpool');
const MiniSearch = require('minisearch');

/** @typedef {import('minisearch').default<TrackDocument>} Search */
/** @typedef {import('minisearch').Query} Query */
/** @typedef {import('minisearch').SearchOptions} MiniSearchOptions */
/** @typedef {import('minisearch').SearchResult} SearchResult */
/** @typedef {import('./search').SearchOptions} SearchOptions */
/** @typedef {import('./search').TrackDocument} TrackDocument */

/** @type {Search} */
let miniSearch;
/**
 *
 * @returns {Search}
 */
function acquire() {
  if (!miniSearch) {
    const fields = ['artist', 'title'];

    // @ts-expect-error
    miniSearch = new MiniSearch({
      fields,
      storeFields: fields
    });
  }

  return miniSearch;
}

/**
 * @param {TrackDocument} track
 */
function add(track) {
  acquire().add(track);
}

/**
 *
 * @param {TrackDocument['id'][]} trackIds
 */
function removeAll(trackIds) {
  const m = acquire();
  for (const id of trackIds) {
    try {
      m.discard(id);
    }
    catch (e) {
      console.error(e);
    }
  }
}

/**
 *
 * @param {Query} query
 * @param {SearchOptions | undefined} searchOptions
 * @returns {SearchResult[]}
 */
function search(query, searchOptions) {
  return acquire().search(query, searchOptions)
}

/**
 *
 * @param {string} queryString
 * @param {SearchOptions | undefined} options
 */
function autoSuggest(queryString, options) {
  const { narrow } = options ?? {};

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

  return acquire().autoSuggest(queryString, miniSearchOptions);
}

workerpool.worker({
  add,
  removeAll,
  search,
  autoSuggest
});

process.on('uncaughtException', noop);
process.on('unhandledRejection', noop);

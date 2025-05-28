// @ts-check

const { noop, omit, chain } = require('lodash');
const workerpool = require('workerpool');
const MiniSearch = require('minisearch');

/** @typedef {import('minisearch').default<TrackDocument>} Search */
/** @typedef {import('minisearch').Query} Query */
/** @typedef {import('minisearch').SearchOptions} MiniSearchOptions */
/** @typedef {import('minisearch').SearchResult} SearchResult */
/** @typedef {import('./search').SearchOptions} SearchOptions */
/** @typedef {import('./search').TrackDocument} TrackDocument */
/** @typedef {import('./search').TrackDocumentResult} TrackDocumentResult */

/** @type {Search} */
let miniSearch;
/**
 *
 * @returns {Search}
 */
function acquire() {
  if (!miniSearch) {
    const fields = ['title', 'artist', 'originalArtist', 'albumArtist'];

    // @ts-expect-error
    miniSearch = new MiniSearch({
      fields,
      storeFields: fields
    });
  }

  return miniSearch;
}

/**
 * @param {TrackDocument[]} tracks
 */
function add(tracks) {
  try {
    acquire().addAll(tracks);
  }
  catch (e) {

  }
}

/**
 *
 * @param {TrackDocument[]} tracks
 */
function removeAll(tracks) {
  const m = acquire();
  for (const { id } of tracks) {
    try {
      m.discard(id);
    }
    catch (e) {

    }
  }
}

/**
 *
 * @param {Query} query
 * @param {SearchOptions | undefined} searchOptions
 * @returns {TrackDocumentResult[]}
 */
function search(query, searchOptions) {
  const results = acquire().search(query, searchOptions);

  return chain(results)
    .map(r => ({
      ...r,
      trackId: r.id.match(/([^:]+)(:.+)*/)?.at(1) ?? ''
    }))
    .filter(r => !!r.trackId)
    .uniqBy('trackId')
  .value();
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

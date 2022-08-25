const workerpool = require('workerpool');
const { MongoClient, Db, Collection } = require('mongodb');
const { random } = require('lodash');

/** @typedef {import('@seamless-medley/core').MusicDb} MusicDb */
/** @typedef {import('@seamless-medley/core').MusicTrack} MusicTrack */
/** @typedef {import('@seamless-medley/core').SearchHistory} SearchHistory */
/** @typedef {import('@seamless-medley/core').SearchQuery} SearchQuery */
/** @typedef {import('./mongo').Options} Options */

/** @type {MongoClient} */
let client;

/** @type {Db} */
let db;

/** @type {Collection<MusicTrack>} */
let musics;

/** @type {Collection<SearchQuery>} */
let searchHistory;

/** @type {[min: number, max: number]} */
let ttls = [
  60 * 60 * 24,
  60 * 60 * 36
];

/**
 *
 * @param {Options} options
 */
async function configure(options) {
  if (options?.ttls) {
    ttls = options.ttls;
  }

  client = new MongoClient(options.url);
  db = client.db(options.database);

  musics = db.collection('musics');
  await musics.createIndexes([
    { key: { trackId: 1 } },
    { key: { path: 1 } },
    { key: { isrc: 1 } }
  ]);

  searchHistory = db.collection('searchHistory');
  await searchHistory.createIndexes([
    { key: { artist: 1 } },
    { key: { title: 1 } },
    { key: { query: 1 } }
  ]);
}

/**
 * @type {MusicDb['findById']}
 */
const findById = (trackId) => find(trackId, 'trackId');

/**
 * @type {MusicDb['findByPath']}
 */
const findByPath = (path) => find(path, 'path');

/**
 * @type {MusicDb['findByISRC']}
 */
const findByISRC = (musicId) => find(musicId, 'isrc');

/**
 * @param {string} value
 * @param {'trackId' | 'path' | 'isrc'} by
 * @returns {Promise<MusicTrack | undefined>}
 */
async function find(value, by) {
  const found = await musics.findOne({
    [by]: value,
    expires: { $gte: Date.now() }
  }, { projection: { _id: 0 }});

  return found ? found : undefined;
}

/**
 * @type {MusicDb['update']}
 */
const update = async (trackId, fields) => {
  await musics.updateOne({ trackId }, {
    $set: {
      ...fields,
      expires: Date.now() + random(...ttls) * 1000
    }
  }, { upsert: true });
}

/**
 * @type {MusicDb['update']}
 */
const _delete = async (trackId) => {
  await musics.deleteOne({ trackId });
}

/**
 * @type {SearchHistory['add']}
 */
const search_add = async (query) => {
  // TODO: Timestamp?
  await searchHistory.insertOne({
    ...query,
    timestamp: new Date
  });
}

/**
 * @type {SearchHistory['recentItems']}
 */
const search_recentItems = async(key, $limit) => {
  const field = `$${key}`;

  const pipelines = [
    { $unwind: field },
    {
      $group: {
        _id: field,
        timestamp: { $max: "$timestamp" },
        count: { $sum: 1 }
      }
    },
    {
      $sort: {
        timestamp: -1,
        count: -1
      }
    },
    {
      $project: {
        _id: 0,
        count: 1,
        timestamp: 1,
        [key]: "$_id"
      }
    }
  ]

  if ($limit) {
    pipelines.push({ $limit });
  }

  const cursor = searchHistory.aggregate(pipelines);

  const result = [];

  for await (const doc of cursor) {
    result.push([
      doc[key],
      doc.count,
      doc.timestamp
    ])
  }

  return result;
}

// TODO: TrackHistory

workerpool.worker({
  configure,
  findById,
  findByPath,
  findByISRC,
  update,
  delete: _delete,
  search_add,
  search_recentItems
})

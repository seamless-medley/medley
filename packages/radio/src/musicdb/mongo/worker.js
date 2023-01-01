const workerpool = require('workerpool');
const { MongoClient, Db, Collection } = require('mongodb');
const { random, omitBy } = require('lodash');

/** @typedef {import('@seamless-medley/core').MusicDb} MusicDb */
/** @typedef {import('@seamless-medley/core').MusicTrack} MusicTrack */
/** @typedef {import('@seamless-medley/core').SearchHistory} SearchHistory */
/** @typedef {import('@seamless-medley/core').SearchQuery} SearchQuery */
/** @typedef {import('@seamless-medley/core').TrackHistory} TrackHistory */
/** @typedef {import('@seamless-medley/core').RecentSearchRecord} RecentSearchRecord */
/** @typedef {import('@seamless-medley/core').SearchRecord} SearchRecord */
/** @typedef {import('@seamless-medley/core').TimestampedTrackRecord} TimestampedTrackRecord */
/** @typedef {import('./mongo').Options} Options */

/** @type {MongoClient} */
let client;

/** @type {Db} */
let db;

/** @type {Collection<MusicTrack>} */
let musics;

/** @type {Collection<SearchQuery & { stationId: string, timestamp: Date }>} */
let searchHistory;

/** @type {Collection<TimestampedTrackRecord & { stationId: string }>} */
let trackHistory;

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

  client = new MongoClient(options.url, options.connectionOptions);
  db = client.db(options.database);

  musics = db.collection('musics');
  await musics.createIndexes([
    { key: { trackId: 1 } },
    { key: { path: 1 } },
    { key: { isrc: 1 } }
  ]);

  searchHistory = db.collection('searchHistory');
  await searchHistory.createIndexes([
    { key: { stationId: 1 }},
    { key: { artist: 1 } },
    { key: { title: 1 } },
    { key: { query: 1 } },
    { key: { timestamp: -1 } },
    { key: { resultCount: 1 } }
  ]);

  trackHistory = db.collection('trackHistory');
  await trackHistory.createIndexes([
    { key: { stationId: 1 } },
    { key: { playedTime: 1 } }
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
  if (!musics) {
    throw new Error('Not initialized');
  }

  const found = await musics.findOne({
    [by]: value,
    expires: { $gte: Date.now() }
  }, { projection: { _id: 0 }});

  if (!found) {
    return;
  }

  // @ts-ignore
  return omitBy(found, (v, p) => ['expires', 'path'].includes(p));
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
const search_add = async (stationId, query) => {
  await searchHistory.insertOne({
    ...query,
    stationId,
    timestamp: new Date
  });
}

/**
 * @type {SearchHistory['recentItems']}
 */
const search_recentItems = async(stationId, key, $limit) => {
  const field = `$${key}`;

  /** @type {import('mongodb').Document[]} */
  const pipelines = [
    {
      $match: {
        stationId,
        resultCount: { $gt: 0 }
      }
    },
    { $unwind: field },
    {
      $group: {
        _id: field,
        timestamp: { $max: "$timestamp" },
        count: { $sum: 1 }
      }
    },
    {
      $project: {
        _id: 0,
        count: 1,
        [key]: "$_id",
        timebin: {
          $dateTrunc: {
            date: "$timestamp",
            unit: "minute",
            binSize: 15
          }
        },
        timestamp: 1
      }
    },
    {
      $sort: {
        timebin: -1,
        count: -1,
        timestamp: -1
      }
    }
  ];

  if ($limit) {
    pipelines.push({ $limit });
  }

  const cursor = searchHistory.aggregate(pipelines);

  /** @type {Array<RecentSearchRecord>} */
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

/**
 * @type {SearchHistory['unmatchItems']}
 */
const search_unmatchItems = async(stationId) => {
  /** @type {import('mongodb').Document[]} */
  const pipelines = [
    {
      $match: {
        stationId,
        resultCount: { $eq: 0 }
      },
      $project: {
        _id: 0,
        artist: 1,
        title: 1,
        query: 1,
        count: "$resultCount",
        timestamp: 1
      }
    }
  ];

  const cursor = searchHistory.aggregate(pipelines);

  /** @type {Array<SearchRecord>} */
  const result = [];

  for await (const doc of cursor) {
    result.push({
      artist: doc.artist ?? undefined,
      title: doc.title ?? undefined,
      query: doc.query ?? undefined,
      count: doc.count,
      timestamp: doc.timestamp
    })
  }

  return result;
}

/**
 * @type {TrackHistory['add']}
 */
 const track_add = async(stationId, record, max) => {
  if (!max) {
    return;
  }

  await trackHistory.insertOne({
    stationId,
    ...record
  });

  const count = await trackHistory.countDocuments({ stationId });

  if (count > max) {
    const deleteCount = max - count;

    const ids = await trackHistory.find({ stationId })
      .sort('playedTime', 'asc')
      .limit(deleteCount)
      .map(doc => doc._id)
      .toArray();

    await trackHistory.deleteMany({
      _id: { $in: ids }
    })
  }
 }

 /**
  * @type {TrackHistory['getAll']}
  */
 const track_getAll = async (stationId) => await trackHistory.find({ stationId })
    .sort('playedTime', 'asc')
    .map(({ _id, ...record }) => record)
    .toArray();

workerpool.worker({
  configure,
  findById,
  findByPath,
  findByISRC,
  update,
  delete: _delete,
  search_add,
  search_recentItems,
  search_unmatchItems,
  track_add,
  track_getAll
})

const workerpool = require('workerpool');
const { threadId } = require('node:worker_threads');
const { MongoClient, Db, Collection } = require('mongodb');
const { random, omitBy } = require('lodash');
const { createLogger } = require('@seamless-medley/logging');

/** @typedef {import('@seamless-medley/core').MusicDb} MusicDb */
/** @typedef {import('@seamless-medley/core').MusicDbTrack} MusicDbTrack */
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

/** @type {Collection<MusicDbTrack>} */
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

const logger = createLogger({
  name: 'musicdb:mongo',
  id: `${threadId}`
});

process.on('uncaughtException', (e) => {
  logger.error(e, 'Uncaught exception');
});

process.on('unhandledRejection', (e) => {
  logger.error(e, 'Unhandled rejection');
});

/**
 *
 * @param {Options} options
 */
async function configure(options) {
  if (options?.ttls) {
    ttls = options.ttls;
  }

  client = new MongoClient(options.url, options.connectionOptions);

  client.on('connectionPoolCreated', (e) => {
    logger.info('connection pool created');
  });

  client.on('connectionPoolCleared', (e) => {
    logger.info('connection pool cleared');
  });

  client.on('connectionCreated', (e) => {
    logger.info(`connection created, connectionId: ${e.connectionId}`);
  });

  client.on('connectionClosed', ({ connectionId, reason }) => {
    logger.info(`connection closed, connectionId: ${connectionId}, reason: ${reason}`);
  });

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

  client.on('error', (e) => {
    logger.error(e);
  });
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
 * @returns {Promise<MusicDbTrack | undefined>}
 */
async function find(value, by) {
  if (!musics) {
    throw new Error('Not initialized');
  }

  // @ts-ignore
  const found = await musics.findOne({
    [by]: value,
    expires: { $gte: Date.now() }
  }, { projection: { _id: 0 }})
  .catch((e) => {
    logger.error(e, 'Error in find');
  });

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
  }, { upsert: true })
  .catch((e) => {
    logger.error(e, 'Error in update');
  });
}

/**
 * @type {MusicDb['update']}
 */
const _delete = async (trackId) => {
  await musics.deleteOne({ trackId })
  .catch((e) => {
    logger.error(e, 'Error in delete');
  });
}

/**
 * @type {SearchHistory['add']}
 */
const search_add = async (stationId, query) => {
  await searchHistory.insertOne({
    ...query,
    stationId,
    timestamp: new Date
  })
  .catch((e) => {
    logger.error(e, 'Error in insert');
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
          $function: {
            args: ["$timestamp"],
            lang: "js",

            body: (function(/** @type {number} */ date) {
              const binSizeMillis = 15 * 60000; // 15 minutes

              let distance = date.valueOf() % binSizeMillis;

              if (distance < 0) {
                distance += binSizeMillis;
              }

              return new Date(date.valueOf() - distance);
            }).toString()
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

  /** @type {Array<RecentSearchRecord>} */
  const result = [];

  try {
    const cursor = searchHistory.aggregate(pipelines);

    for await (const doc of cursor) {
      result.push([
        doc[key],
        doc.count,
        doc.timestamp
      ]);
    }

  } catch(e) {
    logger.error(e, 'Error in recent search');
  }
  return result;
}

/**
 * @type {SearchHistory['unmatchedItems']}
 */
const search_unmatchedItems = async(stationId) => {
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

  /** @type {Array<SearchRecord>} */
  const result = [];

  try {
    const cursor = searchHistory.aggregate(pipelines);

    for await (const doc of cursor) {
      result.push({
        artist: doc.artist ?? undefined,
        title: doc.title ?? undefined,
        query: doc.query ?? undefined,
        count: doc.count,
        timestamp: doc.timestamp
      })
    }
  }
  catch (e) {
    logger.error(e, 'Error in unmatched items');
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
  })
  .catch((e) => {
    logger.error(e, 'Error in TrackHistory::add, while inserting');
  });

  const count = await trackHistory.countDocuments({ stationId })
  .catch((e) => {
    logger.error(e, 'Error in TrackHistory::add, while counting');
    return 0;
  });

  if (count > max) {
    const deleteCount = max - count;

    const ids = await trackHistory.find({ stationId })
      .sort('playedTime', 'asc')
      .limit(deleteCount)
      .map(doc => doc._id)
      .toArray()
      .catch((e) => {
        logger.error(e, 'Error in TrackHistory::add, while getting result');
        return [];
      });

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
    .toArray()
    .catch((e) => {
      logger.error(e, 'Error in getAll');
      return [];
    });

workerpool.worker({
  configure,
  findById,
  findByPath,
  findByISRC,
  update,
  delete: _delete,
  search_add,
  search_recentItems,
  search_unmatchedItems,
  track_add,
  track_getAll
})

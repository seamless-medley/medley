// @ts-check

const argon2 = require('@node-rs/argon2');
const workerpool = require('workerpool');
const { threadId } = require('node:worker_threads');
const { MongoClient, Db, Collection, AggregationCursor } = require('mongodb');
const { random, omitBy, capitalize } = require('lodash');
const { createLogger } = require('../../../logging');

/** @typedef {import('../../../core').MusicDb} MusicDb */
/** @typedef {import('../../../core').MusicDbTrack} MusicDbTrack */
/** @typedef {import('../../../core').SearchHistory} SearchHistory */
/** @typedef {import('../../../core').SearchQuery} SearchQuery */
/** @typedef {import('../../../core').TrackHistory} TrackHistory */
/** @typedef {import('../../../core').RecentSearchRecord} RecentSearchRecord */
/** @typedef {import('../../../core').SearchRecord} SearchRecord */
/** @typedef {import('../../../core').TimestampedTrackRecord} TimestampedTrackRecord */
/** @typedef {import('../../../core').FindByCommentOptions} FindByCommentOptions */
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
  60 * 60 * 24 * 1,
  60 * 60 * 24 * 1.5
];

const logger = createLogger({
  name: 'musicdb:mongo',
  id: `${threadId}`
});

/**
 *
 * @param {*} e
 * @param {string=} s
 */
function logError(e, s) {
  if (e.cause) {
    e = e.cause;
  }

  logger.error(`${s || ''}${'message' in e ? ` - ${e.message}` : ''}`);
}

process.on('uncaughtException', (e) => {
  logError(e, 'Uncaught exception');
});

process.on('unhandledRejection', (e) => {
  logError(e, 'Unhandled rejection');
});

/**
 *
 * @param {Options} options
 */
async function configure(options) {
  if (options?.ttls) {
    ttls = options.ttls;
  }

  client?.removeAllListeners();

  client = new MongoClient(options.url, {
    serverSelectionTimeoutMS: 5000,
    ...options.connectionOptions
  });

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

  client.on('error', (e) => {
    logError(e);
  });

  await client.connect();

  db = client.db(options.database);

  if (options.seed) {
    const hasUsers = await db.listCollections().toArray().then(all => all.find(c => c.name === 'users') !== undefined);

    if (!hasUsers) {
      argon2.hash('admin').then((password) => {
        const users = db.collection('users');
        users.createIndexes([
          { key: { username: 1 } }
        ]);
        users.insertOne({ username: 'admin', password, flags: (1n<<22n).toString() });
      });
    }
  }

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
 * @returns {Promise<MusicDbTrack | undefined>}
 */
async function find(value, by) {
  if (!musics) {
    throw new Error('Not initialized');
  }

  const found = await musics.findOne({
    [by]: value,
    expires: { $gte: Date.now() }
  }, { projection: { _id: 0 } })
  .catch((e) => {
    logError(e, `Error in findBy${capitalize(by)} (${value})`);
  });

  if (!found) {
    return;
  }

  // @ts-ignore
  return omitBy(found, (v, p) => ['expires', 'path'].includes(p));
}

/**
 *
 * @param {string} field
 * @param {string} value
 * @param {FindByCommentOptions | undefined} options
 * @return {Promise<MusicDbTrack[]>}
 */
async function findByComment(field, value, options) {
  if (!musics) {
    throw new Error('Not initialized');
  }

  /** @type {import('mongodb').Document[]} */
  const pipelines = [
    {
      $addFields: {
        comments: {
          $arrayToObject: !options?.valueDelimiter
            ? "$comments"
            : {
              $map: {
                input: "$comments",
                as: "value",
                in: [
                  { $toLower: { $arrayElemAt: ["$$value", 0] } },
                  {
                    $split: [
                      { $arrayElemAt: ["$$value", 1] },
                      options.valueDelimiter,
                    ]
                  }
                ]
              }
            }
        }
      }
    },
    {
      $match: {
        [`comments.${field}`]: {
          $in: [value]
        }
      }
    },
    {
      $sort: {
        expires: -1
      }
    }
  ];

  if (options?.sort) {
    pipelines.push({ $sort: options?.sort });
  }

  if (options?.limit) {
    pipelines.push({ $limit: options?.limit });
  }

  pipelines.push({ $project: { _id: 0 }});

  /**
   * @type {MusicDbTrack[]}
   */
  const result = [];

  try {
    /**
     * @type {AggregationCursor<MusicDbTrack>}
     */
    const cursor = musics.aggregate(pipelines);

    for await (const doc of cursor) {
      result.push({ ...doc })
    }
  }
  catch (e) {
    logError(e, 'Error in findByComment');
  }

  return result;
}

/**
 * @type {MusicDb['update']}
 */
const update = async (trackId, fields) => {
  const track = {
    ...fields,
    timestamp: fields.timestamp ?? Date.now()
  }

  await musics.updateOne({ trackId },
    {
      $set: {
        ...track,
        expires: Date.now() + random(...ttls) * 1000
      }
    },
    { upsert: true }
  )
  .catch((e) => {
    logError(e, 'Error in update');
  });

  return {
    trackId,
    ...track
  }
}

/**
 * @type {MusicDb['delete']}
 */
const _delete = async (trackId) => {
  await musics.deleteOne({ trackId })
    .catch((e) => {
      logError(e, 'Error in delete');
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
    logError(e, 'Error in insert');
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
    logError(e, 'Error in recent search');
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
    logError(e, 'Error in unmatched items');
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

  try {
    await trackHistory.insertOne(
      {
        stationId,
        ...record
      }
    )
    .catch((e) => {

    });
  }
  catch (e) {
    logError(e, 'Error in TrackHistory::add, while inserting');
    return;
  }

  const count = await trackHistory.countDocuments({ stationId })
    .catch((e) => {
      logError(e, 'Error in TrackHistory::add, while counting');
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
        logError(e, 'Error in TrackHistory::add, while getting result');
        return [];
      });

    await trackHistory.deleteMany(
      { _id: { $in: ids }}
    );
  }
 }

 /**
  * @type {TrackHistory['getAll']}
  */
 const track_getAll = async (stationId) => await trackHistory
    .find({ stationId })
    .sort('playedTime', 'asc')
    .map(({ _id, ...record }) => record)
    .toArray()
    .catch((e) => {
      logError(e, 'Error in TrackHistory::getAll');
      return [];
    });


/* SettingsDb */

/** @typedef {import('../../persistent/user').PlainUser} RawUser*/

/**
 *
 * @param {string} username
 * @param {string} password
 */
async function settings_verifyLogin(username, password) {
  if (!db) {
    throw new Error('Not initialized');
  }

  const row = await db.collection('users')
    .findOne({ username })
    .catch(() => undefined)
    ?? undefined;

  if (row && await argon2.verify(row.password, password)) {
    const { password: ignored, _id, ...user }  = row;
    return {
      ...user,
      _id: _id.toHexString()
    };
  }
}

workerpool.worker({
  configure,
  findById,
  findByPath,
  findByISRC,
  findByComment,
  update,
  delete: _delete,
  search_add,
  search_recentItems,
  search_unmatchedItems,
  track_add,
  track_getAll,
  // SettingsDb
  settings_verifyLogin
})

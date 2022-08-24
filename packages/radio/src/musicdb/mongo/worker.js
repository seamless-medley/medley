const workerpool = require('workerpool');
const { MongoClient, Db, Collection } = require('mongodb');
const { random } = require('lodash');

/** @typedef {import('@seamless-medley/core').MusicTrack} MusicTrack */
/** @typedef {import('./mongo').Options} Options */

/** @type {MongoClient} */
let client;

/** @type {Db} */
let db;

/** @type {Collection<MusicTrack>} */
let musics;

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
}

/**
 *
 * @param {string} trackId
 */
async function findById(trackId) {
  return find(trackId, 'trackId');
}

/**
 *
 * @param {string} path
 */
async function findByPath(path) {
  return find(path, 'path');
}

/**
 *
 * @param {string} musicId
 */
async function findByISRC(musicId) {
  return find(value, 'isrc');
}

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
 *
 * @param {string} trackId
 * @param {Omit<MusicTrack, 'trackId'>} fields
 */
async function update(trackId, fields) {
  await musics.updateOne({ trackId }, {
    $set: {
      ...fields,
      expires: Date.now() + random(ttls[0], ttls[1]) * 1000
    }
  }, { upsert: true });
}

async function _delete(trackId) {
  await musics.deleteOne({ trackId });
}

workerpool.worker({
  configure,
  findById,
  findByPath,
  findByISRC,
  update,
  delete: _delete
})

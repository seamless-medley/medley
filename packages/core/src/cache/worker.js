// @ts-check

const { worker } = require('workerpool');
const Keyv = require("keyv");
const KeyvRedis = require('@keyv/redis');
const KeyvSqlite = require('@keyv/sqlite');
const KeyvMongo = require('@keyv/mongo');
const { stubFalse, noop } = require('lodash');

/** @typedef {import('./types').CacheStore} CacheStore */
/** @typedef {import('./types').CacheOptions} CacheOptions */

/** @type {Keyv} */
let container;

/**
 * @param {CacheStore} config
 */
function createStore(config) {
  if (config.type === 'sqlite') {
    return new KeyvSqlite({
      ...config,
      uri: `sqlite://${config.path}`
    });
  }

  if (config.type === 'redis') {
    return new KeyvRedis(config);
  }

  if (config.type === 'mongo') {
    return new KeyvMongo(config);
  }
}

/**
 * @param {CacheOptions} options
 */
function configure(options) {
  container = new Keyv({
    namespace: options.namespace || 'medley',
    store: createStore(options.store),
    adapter: options.store.type
  });
}

/**
 * @param {string} key
 */
function get(key) {
  return container?.get(key);
}

/**
 * @param {string} key
 * @param {any} value
 * @param {number | undefined} ttl
 */
async function set(key, value, ttl) {
  if (!container) {
    return false;
  }

  for (let i = 0; i < 10; i++) {
    const ok = await container.set(key, value, ttl).catch(stubFalse);
    if (ok) {
      return true;
    }
  }

  return false;
}

/**
 * @param {string} key
 */
function del(key) {
  container?.delete(key);
}

worker({
  configure,
  get,
  set,
  del
});

process.on('uncaughtException', noop);
process.on('unhandledRejection', noop);

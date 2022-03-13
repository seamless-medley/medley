// @ts-check

const { worker } = require('workerpool');
const Keyv = require("keyv");
const KeyvRedis = require('@keyv/redis');
const KeyvSqlite = require('@keyv/sqlite');
const { stubFalse, noop } = require('lodash');

/** @type {Keyv} */
let container;

/** @param {import('./cache').MetadataCacheStore} config */
function createStore(config) {
  if (config.type === 'sqlite') {
    return new KeyvSqlite({
      ...config,
      uri: `sqlite://${config.path}`
    })
  }

  if (config.type === 'redis') {
    return new KeyvRedis(config);
  }
}

/**
 * @param {import('./cache').MetadataCacheOptions} options
 */
function configure(options) {
  container = new Keyv({
    namespace: options.namespace || 'medley',
    ttl: options.ttl || (60 * 60 * 24 * 1000),
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
 */
async function set(key, value) {
  if (!container) {
    return false;
  }

  for (let i = 0; i < 10; i++) {
    const ok = await container.set(key, value).catch(stubFalse);
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
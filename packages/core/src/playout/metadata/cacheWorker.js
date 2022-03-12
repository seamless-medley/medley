const { worker } = require('workerpool');
const Keyv = require("keyv");
const KeyvRedis = require('@keyv/redis');
const KeyvSqlite = require('@keyv/sqlite');

/** @type {Keyv.Store} */
let store;

/** @type {Keyv} */
let container;

function init() {
  store = new KeyvSqlite({
    uri: 'sqlite://metadata.db' // TODO: Configurable
    // TODO: Table name
  });

  container = new Keyv({
    // TODO: Namespace
    store
  })
}

const isInitialized = () => !!container;


const get = (key) => container.get(key);
const set = (key, value) => container.set(key, value);
const del = (key) => container.delete(key);

worker({
  isInitialized,
  init,
  get,
  set,
  del
});
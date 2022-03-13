// @ts-check

const { worker } = require('workerpool');
const Keyv = require("keyv");
const KeyvRedis = require('@keyv/redis');
const KeyvSqlite = require('@keyv/sqlite');
const { stubFalse } = require('lodash');

/** @type {Keyv.Store} */
let store;

/** @type {Keyv} */
let container;

// TODO: change to configure
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

function acquire() {
  if (!isInitialized()) {
    init();
  }

  return container;
}


const get = (key) => acquire().get(key);

const set = async (key, value) => {
  acquire();

  for (let i = 0; i < 10; i++) {
    const ok = await container.set(key, value).catch(stubFalse);
    if (ok) {
      return true;
    }
  }

  return false;
}

const del = (key) => acquire().delete(key);

worker({
  isInitialized,
  init,
  get,
  set,
  del
});
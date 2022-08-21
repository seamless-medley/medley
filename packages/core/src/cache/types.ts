import KeyvMongo from "@keyv/mongo";
import KeyvRedis from "@keyv/redis";
import KeyvSqlite from "@keyv/sqlite";

/** @deprecated */
export type CacheSqliteStore = {
  type: 'sqlite';
  path: string;
} & Omit<KeyvSqlite.Options, 'uri'>

/** @deprecated */
export type CacheRedisStore = {
  type: 'redis';
} & KeyvRedis.Options;

/** @deprecated */
export type CacheMongoStore = {
  type: 'mongo';
} & KeyvMongo.Options;

/** @deprecated */
export type CacheStore = CacheSqliteStore | CacheRedisStore | CacheMongoStore;

/** @deprecated */
export type StoreType = CacheStore['type'];

/** @deprecated */
export type CacheOptions = {
  namespace?: string;
  /**
   * TTL in milliseconds, default to 24 hours
   * @default 86400e3 (24 hours)
   */
  ttls?: [min: number, max: number];

  store: CacheStore
}

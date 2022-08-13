import KeyvMongo from "@keyv/mongo";
import KeyvRedis from "@keyv/redis";
import KeyvSqlite from "@keyv/sqlite";

export type CacheSqliteStore = {
  type: 'sqlite';
  path: string;
} & Omit<KeyvSqlite.Options, 'uri'>

export type CacheRedisStore = {
  type: 'redis';
} & KeyvRedis.Options;

export type CacheMongoStore = {
  type: 'mongo';
} & KeyvMongo.Options;

export type CacheStore = CacheSqliteStore | CacheRedisStore | CacheMongoStore;

export type StoreType = CacheStore['type'];

export type CacheOptions = {
  namespace?: string;
  /**
   * TTL in milliseconds, default to 24 hours
   * @default 86400e3 (24 hours)
   */
  ttls?: [min: number, max: number];

  store: CacheStore
}

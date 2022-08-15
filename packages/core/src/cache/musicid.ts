import normalizePath from "normalize-path";
import { MusicIdendifier } from "../track";
import { BaseCache } from "./base";

interface Methods {
  get(path: string): MusicIdendifier | undefined;
  set(path: string, identifier: MusicIdendifier, ttl: number | undefined): Promise<void>;
  del(path: string): Promise<void>;
}

export class MusicIdentifierCache extends BaseCache<Methods> {
  async get(path: string) {
    return this.exec('get', normalizePath(path));
  }

  async set(path: string, identifier: MusicIdendifier) {
    this.exec('set', normalizePath(path), identifier, this.makeTTL());
  }

  async del(path: string) {
    this.exec('del', normalizePath(path));
  }
}

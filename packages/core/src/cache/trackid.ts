import normalizePath from "normalize-path";
import { Track } from "../track";
import { BaseCache } from "./base";

type TrackId = Track<any>['id'];

interface Methods {
  get(path: string): TrackId;
  set(path: string, trackId: TrackId, ttl: number | undefined): Promise<void>;
  del(path: string): Promise<void>;
}

export class TrackIdCache extends BaseCache<Methods> {
  async get(path: string) {
    return this.exec('get', normalizePath(path));
  }

  async set(path: string, trackId: TrackId) {
    this.exec('set', normalizePath(path), trackId, this.makeTTL());
  }

  async del(path: string) {
    this.exec('del', normalizePath(path));
  }
}

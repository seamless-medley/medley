import { MusicDb, MusicTrack } from "@seamless-medley/core";
import { random } from "lodash";
import { Collection, Db } from "mongodb";

type ExpiryMusicTrack = MusicTrack & { expires: number };

export type Options = {
  /**
   * TTL in seconds, default to 24,36 hours
   * @default [86400,129600]  (24,36 hours)
   */
   ttls?: [min: number, max: number];
}

export class MongoMusicDb implements MusicDb {
  private musics: Collection<ExpiryMusicTrack>;

  private ttls: [min: number, max: number] = [
    60 * 60 * 24,
    60 * 60 * 36
  ];

  constructor(private db: Db, options?: Options) {
    this.musics = db.collection<ExpiryMusicTrack>('musics');

    this.musics.createIndexes([
      { key: { trackId: 1 } },
      { key: { path: 1 } },
      { key: { isrc: 1 } }
    ]);

    if (options?.ttls) {
      this.ttls = options.ttls;
    }
  }

  findById(trackId: string): Promise<MusicTrack | undefined> {
    return this.find(trackId, 'trackId');
  }

  findByPath(path: string): Promise<MusicTrack | undefined> {
    return this.find(path, 'path');
  }

  findByISRC(musicId: string): Promise<MusicTrack | undefined> {
    return this.find(musicId, 'isrc');
  }

  private async find(value: string, by: 'trackId' | 'path' | 'isrc' = 'trackId'): Promise<MusicTrack | undefined> {
    const found = await this.musics.findOne({
      [by]: value,
      expires: { $gte: Date.now() }
    }, { projection: { _id: 0 }});

    return found ? found : undefined;
  }

  async update(trackId: string, fields: Omit<MusicTrack, 'trackId'>) {
    await this.musics.updateOne({ trackId }, {
      $set: {
        ...fields,
        expires: Date.now() + random(this.ttls[0], this.ttls[1]) * 1000
      }
    }, { upsert: true });
  }

  async delete(trackId: string) {
    await this.musics.deleteOne({ trackId });
  }
}

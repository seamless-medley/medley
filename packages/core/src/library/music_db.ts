import { Metadata } from "@seamless-medley/medley";

export interface MusicDb {
  findById(trackId: string): Promise<MusicTrack | undefined>;

  findByPath(path: string): Promise<MusicTrack | undefined>;

  findByISRC(musicId: string): Promise<MusicTrack | undefined>;

  update(trackId: string, update: Omit<MusicTrack, 'trackId'>): Promise<void>;

  delete(trackId: string): Promise<void>;
}

export interface MusicTrack extends Partial<Metadata> {
  trackId: string;
  path: string;
}

import { castArray, uniq } from "lodash";

export function formatDuration(seconds: number, options?: { withMs?: boolean }) {
  if (seconds <= 0) {
    return;
  }

  const parts = [
    [1/(60 * 60), 24, true], // hours
    [1/60, 60], // minutes
    [1, 60], // seconds
    [100, 100]
  ] as Array<[multiplier: number, modulus: number, optional: boolean | undefined]>;

  const [h, m, s, ms] = parts
    .map(([mul, mod, optional]) => {
      const v = Math.trunc(seconds * mul) % mod;
      return (v !== 0 || !optional) ? `${v}`.padStart(2, '0') : undefined;
    })

  const result = [h, m, s].filter(v => v !== undefined).join(':');

  return options?.withMs ? `${result}.${ms}` : result;
}

export const extractArtists = (artists: string) => uniq(artists.split(/[/;,]/)).map(s => s.trim());

export type SongBannerFormatOptions = {
  title?: string;
  artists?: string[] | string;
  separators?: Partial<Record<'title' | 'artist', string>>;
}

export function formatSongBanner(options: SongBannerFormatOptions): string | undefined {
  const { title, artists, separators } = options;
  const info: string[] = [];

  if (artists) {
    info.push(castArray(artists).join(separators?.artist ?? ','));
  }

  if (title) {
    info.push(title);
  }

  return info.length ? info.join(separators?.title ?? ' - ') : undefined;
}

// share
export const formatTags = (tags: { title?: string; artist?: string }) => formatSongBanner({
  title: tags.title,
  artists: tags.artist ? extractArtists(tags.artist) : undefined,
  separators: {
    artist: '/'
  }
});

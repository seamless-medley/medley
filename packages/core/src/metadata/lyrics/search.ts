import { chain } from "lodash";
import { MetadataHelper } from "../helper";
import { LyricProviderName } from "./types";

type SourceStats = {
  errorCount: number;
}

const sourceStats: Record<LyricProviderName, SourceStats> = {
  musixmatch: { errorCount: 0 }
};

export async function searchLyrics(artist: string, title: string) {
  const sources = chain(sourceStats)
    .map((stats, name) => ({ name: name as LyricProviderName, stats }))
    .sortBy(({ stats }) => -stats.errorCount)
    .value();

  for (const source of sources) {
    const result = await MetadataHelper.searchLyrics(artist, title, source.name);

    if (result?.lyrics) {
      source.stats.errorCount = 0;
      return result;
    }

    source.stats.errorCount++;
  }
}


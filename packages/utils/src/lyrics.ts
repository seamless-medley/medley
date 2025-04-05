import { chain, clamp, findIndex, flatMap, max, reject, some } from "lodash";

type ParsedLine = {
  infos: [string, string][];
  times: number[];
  text: string;
}

const tagExpr = /^\s*(\[([^\]]*)\])/;
const infoExpr = /([^\d:]+):\s*(.*)\s*/;
const timeExpr = /(\d+):(\d+\.\d+)/;

function parseLine(line: string): ParsedLine | undefined {
  const tags = [];
  let m: RegExpMatchArray | null;

  while (m = line.match(tagExpr)) {
    tags.push(m[2]);
    line = line.substring(line.indexOf(']') + 1).trim();
  }

  const infos: [string, string][] = [];
  const times: number[] = [];

  for (const tag of tags) {
    // Info tag
    {
      const match = tag.match(infoExpr);

      if (match) {
        const [, key, value] = match;
        infos.push([key, value]);
        continue;
      }
    }

    // Time tag
    {
      const match = tag.match(timeExpr);
      if (match) {
        const [, mm, ss] = match;
        times.push((+mm*60 + +ss) * 1000)
        continue;
      }
    }

    // Ignore other
  }

  return {
    infos,
    times,
    text: line
  }
}

export type LyricLine<T = string> = {
  time: number;
  far?: boolean;
  line: T;
}

export type Timeline<T = string> = LyricLine<T>[];

export type SyncLyrics = {
  type: 'sync';
  infos: Record<string, string[]>;
  timeline: Timeline;
}

export type EnhancedLineElement = {
  time: number;
  token: string;
};

export type EnhancedLine = Array<EnhancedLineElement>;

export type EnhancedLyrics = {
  type: 'enhanced';
  infos: Record<string, string[]>;
  timeline: Timeline<EnhancedLine>;
}

export type Lyrics = SyncLyrics | EnhancedLyrics;

export type ParseLyricOptions = {
  bpm?: number;
}

const isLyricLine = (line: any): line is LyricLine => line && 'time' in line;

export function parseLyrics(s: string, { bpm = 90 }: ParseLyricOptions = {}): Lyrics {
  const lines = s.replace(/\r\n/g, "\n").split(/\n/).map(parseLine);

  const infos = chain(lines)
    .flatMap(line => line?.infos ?? [])
    .groupBy(([key]) => key)
    .mapValues(list => list.map(([, val]) => val))
    .value();

  const offset = max((infos.offset || []).map(Number)) || 0;

  const timeline = flatMap<ParsedLine | undefined, LyricLine | undefined>(lines, line => {
    if (line === undefined) {
      return;
    }

    const { text, times } = line;
    return times.map(time => ({ time: time - offset, line: text }))
  });

  if (some(timeline, isLyricLine)) {
    let index = 0;
    while (index < timeline.length) {
      const nextIndex = findIndex(timeline, isLyricLine, index + 1);

      if (nextIndex < 0) {
        break;
      }

      const current = timeline[index];
      const next = timeline[nextIndex];

      if (current === undefined) {
        index = nextIndex;
        continue;
      }

      if (next === undefined) {
        break;
      }

      const gaps = nextIndex - index - 1;
      if (gaps > 0) {
        const idlingTime = Math.min(current.time + 6000, next.time);
        const duration = (next.time - idlingTime) / gaps;
        // interpolate time between gaps
        const newTimes = Array(gaps).fill(0).map((t, i) => current.time + (i * duration));

        let fillers = chain(newTimes)
          .map(time => ({ time: clamp(time, idlingTime, next.time), line: '' }))
          .sortBy('time')
          .value()

        const dups = chain(fillers)
          .filter(f => f.line === '')
          .groupBy('time')
          .omitBy(group => group.length <= 1)
          .map<[number, number]>(group => [ group![0].time, group!.length - 1 ])
          .sortBy(([time]) => -time)
          .value();

        for (const [t, c] of dups) {
          fillers = reject(fillers, ({ time }) => (time === t) && (c > 1));
        }

        timeline.splice(index + 1, gaps, ...fillers);
      }

      index = nextIndex;
    }
  }

  const finalTimeline = chain(timeline)
    .filter(isLyricLine)
    .sortBy('time')
    .dropRightWhile(({ time, line }) => time >= 59940000 || /^\*{3}.*\*{3}$/.test(line))
    .value()

  if (bpm > 0) {
    const beatInterval = 6e4 / bpm;
    const measureInterval = 4 * beatInterval;

    let i = 0;
    let lastNext = -1;
    while (i < finalTimeline.length) {
      // be careful with this, lodash's findIndex() should always be used here
      // since Array.findIndex does not accept the `fromIndex` parameter hence the loop will not advance to the next line
      const next = findIndex(finalTimeline, ({ line }) => line.trim().length > 0, i + 1);

      if (next > lastNext) {
        lastNext = next;

        if (next !== -1 && next !== i) {
          const distance =  finalTimeline[next].time - finalTimeline[i].time;
          if (distance >= beatInterval * 12) {
            finalTimeline[next].far = true;
          }

          i = next;
          continue;
        }
      }

      i++;
    }

    if (finalTimeline[0]?.time >= 1.5 * measureInterval) {
      finalTimeline[0].far = true;
    }
  }

  if (finalTimeline.find(({ line }) => /<\d+:\d+\.\d+?>/g.test(line))) {
    let lastLinetokens: EnhancedLine | undefined = undefined;

    const timeline = finalTimeline.map<LyricLine<EnhancedLine>>(({ time, far, line }) => {
      const matches = Array.from(line.matchAll(/<(\d+):(\d+\.\d+)>/g));

      const tokens: EnhancedLine = [];

      for (let i = 0; i < matches.length; i++) {
        const [curr, next] = [matches[i], matches[i+1]];
        const [ts, mm, ss] = curr;
        //
        const token = line.substring(curr.index + ts.length, next?.index);
        const time = (+mm*60 + +ss) * 1000;

        tokens.push({ token, time: time - offset });
      }

      // The right most info of the each line should end with an empty string
      // but if that's not the case, add the stop mark using current line's start time
      if (lastLinetokens?.at(-1)?.token) {
        lastLinetokens.push({
          token: '',
          time
        })
      }

      lastLinetokens = tokens;

      return {
        time,
        far,
        line: tokens
      }
    });

    return {
      type: 'enhanced',
      infos,
      timeline
    }
  }


  return {
    type: 'sync',
    infos,
    timeline: finalTimeline
  };
}

export const lyricsToText = (lyrics: Lyrics, removeEmptyLine: boolean = true) => {
  const texts = lyrics.type === 'enhanced'
    ? lyrics.timeline.map(({ line }) => line.join(''))
    : lyrics.timeline.map(({ line }) => line);

  return removeEmptyLine ? texts.filter(text => !!text) : texts;
}

export function findLyricLine(timeline: Timeline<any>, posMs: number, from: number = 0) {
  for (let i = Math.max(0, from); i < timeline.length; i++) {
    const { time: l } = timeline[i];
    const { time: r } = timeline[i + 1] ?? { time: 1e7 };

    if (l <= posMs && posMs <= r) {
      return i;
    }
  }

  return -1;
}

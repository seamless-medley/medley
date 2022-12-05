import { chain, clamp, findIndex, flatMap, max, reject, some } from "lodash";

export type LyricLine = {
  time: number;
  text: string;
  far?: boolean; // TODO: calculate far flag from BPM and gap between lines
}

export type Timeline = LyricLine[];

type Line = {
  infos: [string, string][];
  times: number[];
  text: string;
}

export type Lyrics = {
  infos: Record<string, string[]>;
  timeline: Timeline;
}


const attnExpr = /\[([^\]]*)\]/g;
const infoExpr = /([^\d:]+):\s*(.*)\s*/;
const timeExpr = /(\d+):(\d+\.\d+)/;

type MaybeLine = Line | undefined;

const isLyricLine = (line: any): line is LyricLine => line && 'time' in line;

function parseLine(line: string): MaybeLine {
  const match = line.match(/(\[[^\]]*\])\s*(.*)/);
  if (!match) {
    return;
  }

  const [, annotation, text] = match;

  const tags = [];
  let m: RegExpExecArray | null;
  while (m = attnExpr.exec(annotation)) {
    tags.push(m[1]);
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
    text
  }
}

export function parseLyrics(s: string): Lyrics {
  const lines = s.replace(/\r\n/g, "\n").split(/\n/).map(parseLine);

  const infos = chain(lines)
    .flatMap(line => line?.infos ?? [])
    .groupBy(([key]) => key)
    .mapValues(list => list.map(([, val]) => val))
    .value();

  const offset = max((infos.offset || []).map(Number)) || 0;

  const timeline = flatMap<MaybeLine, LyricLine | undefined>(lines, line => {
    if (line === undefined) {
      return;
    }

    const { text, times } = line;
    return times.map(time => ({ time: time - offset, text }))
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
          .map(time => ({ time: clamp(time, idlingTime, next.time), text: '' }))
          .sortBy('time')
          .value()

        const dups = chain(fillers)
          .filter(f => f.text === '')
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
    .dropRightWhile(line => line.time >= 59940000 || /^\*{3}.*\*{3}$/.test(line.text))
    .value()

  return {
    infos,
    timeline: finalTimeline
  };
}

export const lyricsToText = (lyrics: Lyrics, removeEmptyLine: boolean = true) => {
  const texts = lyrics.timeline.map(({ text }) => text);
  return removeEmptyLine ? texts.filter(text => !!text) : texts;
}

import { ChildProcessByStdio, spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { camelCase } from "lodash";
import { createInterface } from "readline";
import { Readable, Writable } from "stream";
import { CamelCase } from "type-fest";

export type FFmpegChildProcess = ChildProcessByStdio<Writable, Readable, Readable>;

export const spawnFFmpeg = (exePath: string, args: string[]): FFmpegChildProcess => spawn(
  exePath,
  ['-hide_banner', ...args],
  { stdio: [ null, null, null ] }
)

export type FFmpegOverseerOptions = {
  exePath?: string;
  args: string[];
  respawnDelay?: {
    min: number;
    max: number;
  };
  beforeSpawn?: () => Promise<boolean | undefined>;
  afterSpawn?: (process: FFmpegChildProcess) => Promise<void>;
  started?: (error?: FFMpegOverseerStartupError) => any;
  log?: (line: FFMpegLine) => any;
}

export type FFmpegOverseer = {
  process: FFmpegChildProcess;
  respawn: () => Promise<void>;
  stop: () => void;
  get running(): boolean;
  get stalled(): boolean;
}

export type InfoLine = {
  type: 'info';
  tag: string;
  text: string;
}

export type ProgressValue = {
  /**
   * Size in kilo bytes
   */
  size: number;
  /**
   * Duration in seconds
   */
  duration: number;

  speed: number;

  /**
   * bitrate in kilo bits per second
   */
  bitrate?: number;

  /**
   * Other values
   */
  values: Record<string, string>;
}

export type ProgressLine = {
  type: 'progress';
  values: ProgressValue;
}

export type ErrorLine = {
  type: 'error';
  text: string;
}

export type FFMpegLine = InfoLine | ProgressLine | ErrorLine;

export class FFMpegOverseerStartupError extends Error {
  constructor(message: string, readonly info?: InfoLine) {
    super(message)
  }
}


function parseStdErr(line: string): FFMpegLine | undefined {
  if (/^\s+/.test(line)) {
    return;
  }

  if (/^(guessed |(in|out)put #|(duration|audio|video|stream mapping):)/i.test(line)) {
    return;
  }

  {
    const m = line.match(/^\[(.+) @ [^\]].+\] (.+)$/);
    if (m) {
      const [, tag, text] = m;
      return {
        type: 'info',
        tag,
        text
      }
    }
  }

  {
    const tokens = line.replace(/=\s+/g,'=').trim().split(' ');

    const progress = tokens.map(e => e.split('=', 2))
      .reduce<Record<string, string>>((r, [k, v]) => {
        if (k && v) {
          r[k.trim()] = v.trim();
        }
        return r;
      }, {});

    if (Object.keys(progress).length > 0) {
      const { size: s, time, bitrate: b, speed: sp, ...rest } = progress;

      const [size, speed, bitrate] = [s, sp, b].map(s => +s.replace(/[^\d.]+/,''));
      const duration = [...time.matchAll(/(\d{2})/g)].slice(0, 4).map(([, v], i) => +v * [60**2, 60**1 , 60**0, 1/100][i]).reduce((a, v) => a+v, 0);

      return {
        type: 'progress',
        values: {
          size,
          duration,
          speed,
          bitrate,
          values: rest
        }
      }
    }
  }

  return {
    type: 'error',
    text: line
  }
}

export async function createFFmpegOverseer(options: FFmpegOverseerOptions): Promise<FFmpegOverseer> {
  let process: FFmpegChildProcess | undefined = undefined;
  let running = false;
  let stalled = false;
  let stopped = false;
  let lastInfo: InfoLine | undefined = undefined;
  let timer: NodeJS.Timeout | undefined = undefined;
  let lastProgress: number;
  let spawning = false;

  const { min, max = 30_000 } = options.respawnDelay ?? {};
  let respawnAttempts = 0;

  const delay = () => (min && min <= max)
    ? new Promise(resolve => setTimeout(resolve, Math.min(max, min * Math.pow(1.097, ++respawnAttempts))))
    : Promise.resolve();

  function watch() {
    unwatch();

    timer = setInterval(() => {
      const Δ = Date.now() - lastProgress;
      if (Δ >= 1000) {
        unwatch();
        running = false;
        stalled = true;
        kill();
      }
    }, 200);
  }

  function unwatch() {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function kill() {
    unwatch();

    if (process && !process.killed) {
      process.kill();
      process = undefined;
    }
  }

  function stop() {
    stopped = true;
    kill();
  }

  const handleStdErr = (line: string) => {
    const parsed = parseStdErr(line);
    if (parsed) {
      switch (parsed.type) {
        case 'info':
          lastInfo = parsed;
          break;

        case 'progress':
          lastProgress = Date.now();
          stalled = false;
          stopped = false;

          if (!running) {
            running = true;
            respawnAttempts = 0;
            watch();
            options?.started?.();
          }

          break;

        case 'error':
          if (!running) {
            stopped = true;
            options?.started?.(new FFMpegOverseerStartupError(parsed.text, lastInfo));
            return;
          }
          break;
      }

      options.log?.(parsed);
    }
  }

  async function spawn() {
    if (spawning) {
      return;
    }

    if (!(await options?.beforeSpawn?.() ?? true)) {
      return;
    }

    return new Promise<void>(async (resolve, reject) => {
      spawning = true;
      kill();

      process = spawnFFmpeg(options?.exePath ?? ffmpegPath!, options.args);

      if (!process.pid) {
        process.on('error', err => reject(new FFMpegOverseerStartupError(err.message)));
        return;
      }

      const stdErrorLine = createInterface(process.stderr);

      stdErrorLine.on('line', handleStdErr);

      process.on('exit', () => {
        running = false;

        unwatch();

        if (!stopped) {
          delay().then(spawn);
        }
      });

      await options.afterSpawn?.(process);

      spawning = false;
      resolve();
    });
  }

  return {
    process: process!,
    respawn: spawn,
    stop,
    get running() {
      return running;
    },
    get stalled() {
      return stalled;
    }
  }
}

type FFMpegCapabilities<C extends keyof CapabilityFlags> = {
  [name: string]: CapablityInfo<C>;
}

type CapablityInfo<C extends keyof CapabilityFlags> = {
  description: string;
  caps: CapabilityFlags[C];
}

type Caps<T extends string> = Partial<Record<CamelCase<T>, true>>;

type FormatCaps = Caps<'muxing' | 'demuxing'>;
type CodecCaps = Caps<'decoding' | 'encoding' | 'video' | 'audio' | 'subtitle' | 'infraFrameOnly' | 'lossy' | 'lossless'>;

type EncoderCaps = Caps<'video' | 'audio' | 'subtitle' | 'frameLevel' | 'sliceLevel' | 'experimental' | 'drawHorizontalBand' | 'directRendering1'>;

type CapabilityFlags = {
  formats: FormatCaps;
  codecs: CodecCaps;
  encoders: EncoderCaps;
  decoders: EncoderCaps;
}

export async function getFFmpegCaps<C extends keyof CapabilityFlags>(capsType: C, exePath: string = ffmpegPath!) {
  const process = spawn(exePath, [`-${capsType}`]);

  const lines: string[] = [];
  createInterface(process.stdout).on('line', line => lines.push(line.trim()));

  return new Promise<FFMpegCapabilities<C>>((resolve) => {
    process.on('exit', () => {
      const sep = lines.findIndex(line => line.startsWith('-') && line.endsWith('-'));
      const heads = lines.slice(1, sep);
      const listing = lines.slice(sep + 1);

      const flagsTable = heads.reduce((flags, h) => {
        const [flagString, description] = h.split('=', 2);
        const index = flagString.split('').findIndex(f => f !== '.');
        const flag = flagString[index]!;

        flags[index] ??= {};

        flags[index][flag] = camelCase(
          description
            .replace(/(supported|codec|compression|multithreading)$/i, '')
            .replace(/Supports draw_horiz_band/, 'drawHorizontalBand')
            .replace(/Supports direct rendering method (.+)/, 'directRendering\\1')
            .replace(/experimental$/, 'experimental')
            .trim()
        );

        return flags;
      }, [] as { [flag: string]: string }[]);

      const listingTable = listing.reduce((v, l) => {
        const m = l.match(/([^\s]+)\s+([^\s]+)\s+(.+)$/);

        if (!m) {
          return v;
        }

        const [, flagString, name, ...description] = m;

        const caps = flagString.split('').reduce((caps, subType, type) => {
          if (subType in flagsTable[type]) {
            (caps as any)[flagsTable[type][subType]] = true;
          }

          return caps;
        }, {} as CapabilityFlags[C]);

        v[name] = {
          description: description.join(' '),
          caps
        }

        return v
      }, {} as FFMpegCapabilities<C>);

      resolve(listingTable);
    });
  });
}

import { ChildProcessByStdio, spawn } from "child_process";
import path from "ffmpeg-static";
import internal from "stream";

export type FFmpegChildProcess = ChildProcessByStdio<internal.Writable, internal.Readable, null>;

export const spawnFFmpeg = (args: string[]): FFmpegChildProcess => spawn(
  path,
  ['-loglevel', '0'].concat(args),
  { stdio: [ null, null, 'ignore' ] }
);
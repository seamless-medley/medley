import { ChildProcessByStdio, spawn } from "child_process";
import path from "ffmpeg-static";
import internal from "stream";

export type FFmpegChildProcess = ChildProcessByStdio<internal.Writable, internal.Readable, null>;

export const spawnFFmpeg = (args: string[]): FFmpegChildProcess => spawn(
  path,
  ['-loglevel', '0'].concat(args),
  { stdio: [ null, null, 'ignore' ] }
);

export type FFmpegOverseerOptions = {
  args: string[];
  afterSpawn?: (overseer: FFmpegOverseer) => Promise<void>;
}

export type FFmpegOverseer = {
  process: FFmpegChildProcess;
  respawn: () => Promise<void>;
  kill: () => void;
}

export async function createFFmpegOverseer(options: FFmpegOverseerOptions): Promise<FFmpegOverseer> {
  let process: FFmpegChildProcess;

  function kill() {
    if (process && !process.killed) {
      process?.kill();
    }
  }

  async function spawn() {
    kill();

    process = spawnFFmpeg(options.args);

    await options.afterSpawn?.({
      process,
      respawn: spawn,
      kill
    });
  }

  await spawn();

  return {
    process: process!,
    respawn: spawn,
    kill
  }
}

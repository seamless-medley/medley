import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';
import { DbConfig } from './db';
import { StationConfig } from './station';
import { AutomatonConfig } from './automaton';
import { pickBy } from 'lodash';
import { paraphrase, dollar } from "paraphrase";
import { ServerConfig } from './server';
import { WebRtcConfig } from './webrtc';
import { StreamingConfigs } from './streaming';

async function parseYAML(s: string) {
  return parse(s);
}

const Config = z.object({
  server: ServerConfig.optional(),
  db: DbConfig,
  webrtc: WebRtcConfig.optional(),
  stations: z.record(z.string(), StationConfig, { error: () => 'No stations' }),
  automatons: z.record(z.string(), AutomatonConfig, { error: () => 'No automatons' }),
  streaming: StreamingConfigs.optional()
}, {
  error: (issue) => 'Configuration file is empty or malformed'
}).strict();

export type Config = z.infer<typeof Config>;

const catchError = (e: any) => e as Error;

/**
 * Parse configurations from file
 */
export async function loadConfig(configFile: string): Promise<Config | Error> {
  const fileData = await readFile(configFile).catch(catchError);

  if (fileData instanceof Error) {
    return fileData;
  }

  const phrase = paraphrase(...dollar.patterns, { clean: true });
  const yaml = phrase(
    fileData.toString(),
    pickBy(process.env, (_, key) => /^MEDLEY_[A-Z0-9_]+$/.test(key))
  )

  const data = await parseYAML(yaml).catch(catchError);

  if (data instanceof Error) {
    return data;
  }

  const parsed = await Config.safeParseAsync(data ?? undefined);

  return (parsed.success) ? parsed.data : parsed.error;
}

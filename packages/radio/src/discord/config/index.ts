import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';
import { DbConfig } from './db';
import { StationConfig } from './station';
import { AutomatonConfig } from './automaton';
import { pickBy, startsWith } from 'lodash';
import { dollar as phrase } from "paraphrase";

async function parseYAML(s: string) {
  return parse(s);
}

function fetchEnvWithPrefix(env: object, prefix: string) {
  const envs = pickBy(env, function(value, key) {
    return startsWith(key, prefix);
  });

  return envs;
}

const Config = z.object({
  db: DbConfig,
  stations: z.record(StationConfig, { required_error: 'No stations' }),
  automatons: z.record(AutomatonConfig, { required_error: 'No automatons' })
}, {
  required_error: 'Configuration file is empty or malformed'
}).strict();

export type Config = z.infer<typeof Config>;

const catchError = (e: any) => e as Error;



/**
 * Parse configurations from file
 */
async function parseConfig(configFile: string): Promise<Config | Error> {
  const fileData = await readFile(configFile).catch(catchError);

  if (fileData instanceof Error) {
    return fileData;
  }

  const parsedString = phrase(fileData.toString(), fetchEnvWithPrefix(process.env, "MEDLEY_"));

  const data = await parseYAML(parsedString).catch(catchError);

  if (data instanceof Error) {
    return data;
  }

  const parsed = await Config.safeParseAsync(data ?? undefined);

  return (parsed.success) ? parsed.data : parsed.error;
}

/**
 * Parse configurations from file and override some settings via environment variables
 */
export async function loadConfig(configFile: string): Promise<Config | Error> {
  const parsed = await parseConfig(configFile);
  //
  return parsed;
}

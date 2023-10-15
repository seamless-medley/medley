import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { z } from 'zod';
import { DbConfig } from './db';
import { StationConfig } from './station';
import { AutomatonConfig } from './automaton';
import { pickBy } from 'lodash';
import { dollar as phrase } from "paraphrase";
import { ServerConfig } from './server';

async function parseYAML(s: string) {
  return parse(s);
}

const Config = z.object({
  server: ServerConfig,
  db: DbConfig,
  stations: z.record(StationConfig, { required_error: 'No stations' }),
  automatons: z.record(AutomatonConfig, { required_error: 'No automatons' })
}, {
  required_error: 'Configuration file is empty or malformed'
}).strict();

const DiscordOnlyConfig = Config.omit({
  server: true
});

export type Config = z.infer<typeof Config>;

export type DiscordOnlyConfig = z.infer<typeof DiscordOnlyConfig>;

const catchError = (e: any) => e as Error;

/**
 * Parse configurations from file
 */
export async function loadConfig(configFile: string, discordOnly: true): Promise<DiscordOnlyConfig | Error>;
export async function loadConfig(configFile: string, discordOnly: false): Promise<Config | Error>;
export async function loadConfig(configFile: string, discordOnly: boolean): Promise<Config | DiscordOnlyConfig | Error> {
  const fileData = await readFile(configFile).catch(catchError);

  if (fileData instanceof Error) {
    return fileData;
  }

  const data = await parseYAML(
    phrase(fileData.toString(),
    pickBy(process.env, (_, key) => /^MEDLEY_[A-Z0-9_]+$/.test(key))
  ))
  .catch(catchError);

  if (data instanceof Error) {
    return data;
  }

  const parsed = await (discordOnly ? DiscordOnlyConfig : Config).safeParseAsync(data ?? undefined);

  return (parsed.success) ? parsed.data : parsed.error;
}

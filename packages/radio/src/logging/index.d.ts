import type { Logger as PinoLogger } from 'pino';

export type Logger = PinoLogger;

export type LoggerOptions = {
  name: string;
  id?: string;
}

export type LoggerMetadata = Omit<LoggerOptions, 'name'> & {
  type: string;
}

export type PrettyTransportData = {
  configs?: Array<string>;
}

declare export function createLogger(options: LoggerOptions): Logger;

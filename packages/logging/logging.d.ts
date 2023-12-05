import type { Logger } from 'pino';
export type { Logger } from 'pino';

export type LoggerOptions = {
  name: string;
  id?: string;
}

export type LoggerMetadata = Omit<LoggerOptions, 'name'> & {
  type: string;
}

declare export function createLogger(options: LoggerOptions): Logger;

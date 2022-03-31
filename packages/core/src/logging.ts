import { ISettingsParam, Logger } from "tslog";
export { Logger } from "tslog";

// TODO: automatically set log level from env

export function createLogger(options?: ISettingsParam, parrent?: Logger) {
  const settings: ISettingsParam = {
    displayFilePath: 'hidden',
    displayFunctionName: false,
    ...options
  }

  return parrent ? parrent.getChildLogger(settings) : new Logger(settings);
}
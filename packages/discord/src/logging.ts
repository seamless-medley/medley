import { ISettingsParam, Logger } from "tslog";


export function createLogger(options?: ISettingsParam, parrent?: Logger) {
  const settings: ISettingsParam = {
    displayFilePath: 'hidden',
    displayFunctionName: false,
    ...options
  }

  return parrent ? parrent.getChildLogger(settings) : new Logger(settings);
}
import { ISettingsParam, Logger } from "tslog";
export { Logger } from "tslog";

export function createLogger(options?: ISettingsParam, parrent?: Logger) {
  const settings: ISettingsParam = {
    type: !!process.env.NO_LOG ? 'hidden' : 'pretty',
    displayFilePath: 'hidden',
    displayFunctionName: false,
    minLevel: !!process.env.DEBUG ? 'debug' : 'info',
    ...options
  }

  return parrent ? parrent.getChildLogger(settings) : new Logger(settings);
}
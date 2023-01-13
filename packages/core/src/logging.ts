import { type ISettingsParam, Logger } from "tslog";
import { ILogObj } from "tslog/dist/types/interfaces";
export { Logger } from "tslog";
export type { ILogObj } from "tslog/dist/types/interfaces";

export function createLogger<LogObj extends ILogObj>(options: ISettingsParam<LogObj>, logObj: LogObj = {} as LogObj, parrent?: Logger<LogObj>) {
  const settings: ISettingsParam<LogObj> = {
    type: !!process.env.NO_LOG ? 'hidden' : 'pretty',
    minLevel: !!process.env.DEBUG ? 2 : 3,
    stylePrettyLogs: true,
    prettyLogTimeZone: 'local',
    prettyLogTemplate: '{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}} {{logLevelName}} [{{name}}] ',
    prettyLogStyles: {
      name: 'blue',
      logLevelName: {
        "*": ["bold", "black", "bgWhiteBright", "dim"],
        SILLY: ["bold", "white"],
        TRACE: ["bold", "whiteBright"],
        DEBUG: ["bold", "green"],
        INFO: ["bold", "blue"],
        WARN: ["bold", "yellow"],
        ERROR: ["bold", "red"],
        FATAL: ["bold", "redBright"],
      }
    },
    ...options
  }

  return parrent ? parrent.getSubLogger(settings, logObj) : new Logger(settings, logObj);
}

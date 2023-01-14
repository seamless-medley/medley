import { Config } from "./config";
import { Station } from "./station";


export type {
  Config,
  Station,
}

export interface RemoteTypes {
  config: Config;
  station: Station;
}


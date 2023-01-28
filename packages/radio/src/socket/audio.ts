export const enum AudioSocketCommand {
  Identify,
  Tune
}

export type AudioSocketCommandMap = {
  [AudioSocketCommand.Identify]: (socketId: string) => void;
  [AudioSocketCommand.Tune]: (stationId: string) => void;
}

export const enum AudioSocketReply {
  Audio = 0xCC
}

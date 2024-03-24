export const enum AudioSocketCommand {
  Identify,
  Tune,
  Detune
}

export type AudioSocketCommandMap = {
  [AudioSocketCommand.Identify]: (socketId: string) => void;
  [AudioSocketCommand.Tune]: (stationId: string) => void;
  [AudioSocketCommand.Detune]: () => void;
}

export const enum AudioSocketReply {
  Opus = 0xCC
}

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
  Latency = 0x00,
  Opus = 0xCC,
}

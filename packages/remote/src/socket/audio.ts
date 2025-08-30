export type AudioSocketCommand_Identify = 0;
export type AudioSocketCommand_Tune = 1;
export type AudioSocketCommand_Detune = 2;

export type AudioSocketCommand = AudioSocketCommand_Identify | AudioSocketCommand_Tune | AudioSocketCommand_Detune;

export type AudioSocketReply_Latency = 0x00;
export type AudioSocketReply_Opus = 0xCC;

export type AudioSocketReply = AudioSocketReply_Latency | AudioSocketReply_Opus;

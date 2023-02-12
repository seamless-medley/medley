import { decode, encode } from "notepack.io";
import { AudioSocketCommand, AudioSocketCommandMap, AudioSocketReply } from "../../socket/audio";
import Decoder from "./decoder?worker";
import type { Decoder as DecoderInft } from "./decoder";
import type { AudioTransportExtra } from "../../audio/types";
import { RingBuffer } from "./ringbuffer";

export type InitMessage = {
  type: 'init';
  pcmBuffer: RingBuffer;
}

export type ConnectMessage = {
  type: 'connect';
  socketId: string;
}

export type DisconnectMessage = {
  type: 'disconnect';
}

export type PlayMessage = {
  type: 'play';
  stationId: string;
}

export type InputMessage = InitMessage | ConnectMessage | DisconnectMessage | PlayMessage;

export type OpenMessage = {
  type: 'open';
}

export type OutputMessage = OpenMessage;

export interface AudioClientEventMap extends AbstractWorkerEventMap {
  "message": MessageEvent<OutputMessage>;
  "messageerror": MessageEvent;
}

export interface AudioClientIntf extends Worker {
  onmessage: ((this: AudioClientIntf, ev: MessageEvent<OutputMessage>) => any) | null;
  onmessageerror: ((this: AudioClientIntf, ev: MessageEvent) => any) | null;

  postMessage(input: InputMessage): void;

  addEventListener<K extends keyof AudioClientEventMap>(type: K, listener: (this: AudioClientIntf, ev: AudioClientEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof AudioClientEventMap>(type: K, listener: (this: AudioClientIntf, ev: AudioClientEventMap[K]) => any, options?: boolean | EventListenerOptions): void;
}

let ws: WebSocket | undefined;

let _socketId: string | undefined;

const decoder = new Decoder() as unknown as DecoderInft<AudioTransportExtra>;

let pcmBuffer: RingBuffer | undefined;

decoder.addEventListener('message', (e) => {
  const { decoded: { channelData, samplesDecoded }, extra } = e.data;

  if (!pcmBuffer) {
    return;
  }

  pcmBuffer.push(channelData.slice(0, 2), samplesDecoded, extra);
});

async function connect(socketId: string): Promise<void> {
  const isConnectingOrOpen = ws && [WebSocket.CONNECTING, WebSocket.OPEN].includes(ws.readyState);

  if (isConnectingOrOpen && socketId === socketId) {
    return;
  }

  _socketId = socketId;

  const websocketUrl = location.protocol.replace('http', 'ws') + '//' + location.host + '/socket.audio';
  ws = new WebSocket(websocketUrl, 'medley-audio');
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    self.postMessage({ type: 'open' });
    sendCommand(AudioSocketCommand.Identify, socketId);
  }

  ws.addEventListener('message', handleStream);
}

function disconnect() {
  ws?.close();
}

function sendCommand<T extends AudioSocketCommand>(command: T, data: Parameters<AudioSocketCommandMap[T]>[0]) {
  if (ws?.readyState !== WebSocket.OPEN) {
    return;
  }

  const dataBuffer = encode(data) as ArrayBuffer;
  const buffer = new Uint8Array(1 + dataBuffer.byteLength);
  const view = new DataView(buffer.buffer);
  view.setUint8(0, command);
  buffer.set(new Uint8Array(dataBuffer), 1);

  ws.send(buffer);
}

function play(stationId: string) {
  sendCommand(AudioSocketCommand.Tune, stationId);
}

function handleStream(ev: MessageEvent<ArrayBuffer>) {
  const view = new DataView(ev.data);
  const op = view.getUint8(0);

  const data = new Uint8Array(ev.data, 1);

  if (op === AudioSocketReply.Opus) {
    handleOpus(data);
    return;
  }
}

function handleOpus(data: Uint8Array) {
  const infoLength = new DataView(data.buffer, data.byteOffset).getUint16(0, true);
  const extra = decode(data.subarray(2, 2 + infoLength));
  const opus = data.subarray(2 + infoLength);

  decoder.postMessage({
    opus,
    extra
  });
}

self.addEventListener('message', (e: MessageEvent<InputMessage>) => {
  const { type } = e.data;

  switch (type) {
    case 'init':
      pcmBuffer = e.data.pcmBuffer;
      Object.setPrototypeOf(pcmBuffer, RingBuffer.prototype);
      return;

    case 'connect':
      connect(e.data.socketId);
      return;

    case 'disconnect':
      disconnect();
      return;

    case 'play':
      play(e.data.stationId);
      return;
  }
});

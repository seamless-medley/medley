/**
 * This is the audio client code running in a background as a Web Worker
 *
 * The client connects to a WebSocket endpoint for audio transportation and playback control
 *
 */

import { decode, encode } from "notepack.io";
import { AudioSocketCommand, AudioSocketCommandMap, AudioSocketReply } from "../../../../socket";
import Decoder from "./decoder?worker";
import type { Decoder as DecoderInft } from "./decoder";
import type { AudioTransportExtraPayload } from "../../../../audio/types";
import { RingBufferWithExtra } from "./ringbuffer";

export type InitMessage = {
  type: 'init';
  pcmBuffer: RingBufferWithExtra;
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

export type StopMessage = {
  type: 'stop';
}

export type InputMessage = InitMessage | ConnectMessage | DisconnectMessage | PlayMessage | StopMessage;

export type OpenMessage = {
  type: 'open';
}

export type StoppedMessage = {
  type: 'stopped';
}

export type AudioLatencyMessage = {
  type: 'audio-latency';
  latencyMs: number;
}

export type OutputMessage = OpenMessage | StoppedMessage | AudioLatencyMessage;

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

/**
 * The WebSocket connection for audio data transportation
 */
let ws: WebSocket | undefined;

/**
 * The id of Socket.IO connection
 */
let _socketId: string | undefined;

/**
 * Circular buffer for temporarily storing PCM data before passing it to the Web Audio API
 * An instance of it is passed from AudioPipeline, the RingBuffer internally holds a shared memory region using SharedArrayBuffer
 * This shared memory can then be accessed from multiple threads/workers
 */
let pcmBuffer: RingBufferWithExtra | undefined;

/**
 * Another Web Worker for docoding Opus Packets
 */
const decoder = new Decoder() as unknown as DecoderInft<AudioTransportExtraPayload>;

decoder.addEventListener('message', (e) => {
  const { decoded: { channelData, samplesDecoded }, extra, timestamp } = e.data;

  if (!pcmBuffer) {
    return;
  }

  // Write PCM data to the RingBuffer, to be comsumed by the stream-processor
  pcmBuffer.push(channelData.slice(0, 2), samplesDecoded, { extra, timestamp });
});

/**
 * Handle data stream from audio WebSocket
 */
function handleStream(ev: MessageEvent<ArrayBuffer>) {
  const view = new DataView(ev.data);
  const op = view.getUint8(0);



  if (op === AudioSocketReply.Latency) {
    // milliseconds
    const latency = view.getUint32(1, true);
    self.postMessage({ type: 'audio-latency', latency });
    return;
  }

  if (op === AudioSocketReply.Opus) {
    const data = new Uint8Array(ev.data, 1);
    handleOpus(data);
    return;
  }
}

/**
 * Unpack an Opus Packet and send it to the Decoder
 * A new `message` event will be fired once the packet decoding is done
 */
function handleOpus(data: Uint8Array) {
  const infoLength = new DataView(data.buffer, data.byteOffset).getUint16(0, true);
  const extra = decode(data.subarray(2, 2 + infoLength));
  const opus = data.subarray(2 + infoLength);

  decoder.postMessage({
    opus,
    extra,
    timestamp: Math.trunc(performance.timeOrigin + performance.now())
  });
}

async function connect(socketId: string): Promise<void> {
  const isConnectingOrOpen = ws && [WebSocket.CONNECTING as number, WebSocket.OPEN as number].includes(ws.readyState);

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

function stop() {
  sendCommand(AudioSocketCommand.Detune, undefined);
  self.postMessage({ type: 'stopped' });
}

self.addEventListener('message', (e: MessageEvent<InputMessage>) => {
  const { type } = e.data;

  switch (type) {
    case 'init': // This message was sent from AudioPipeline
      pcmBuffer = e.data.pcmBuffer;
      Object.setPrototypeOf(pcmBuffer, RingBufferWithExtra.prototype);
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

    case 'stop':
      stop();
      return;
  }
});

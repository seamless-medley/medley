import { EventEmitter } from "eventemitter3";
import { encode, decode } from 'notepack.io';
import worklet from "./worklet.js?worker&url";
import Decoder from "./decoder?worker";
import { RingBuffer } from "./ringbuffer";

import type { AudioTransportExtra } from "../../audio/types";
import type { MedleyStreamProcessorNodeOptions } from "./stream-processor";
import type { Decoder as DecoderInft } from "./decoder";
import { AudioSocketCommand, AudioSocketCommandMap, AudioSocketReply } from "../../socket/audio";

export type AudioClientEvents = {
  audioExtra(extra: AudioTransportExtra): void;
}

export class AudioClient extends EventEmitter<AudioClientEvents> {
  #decoder = new Decoder() as unknown as DecoderInft<AudioTransportExtra>;

  #ctx?: AudioContext;

  #node!: AudioWorkletNode;

  #pcmBuffer = new RingBuffer(960 * 100, 2);

  #ws?: WebSocket;

  #socketId?: string;

  constructor() {
    super();
  }

  async connect(socketId: string): Promise<void> {
    await this.#prepareAudioContext();

    const isConnectingOrOpen = this.#ws && [WebSocket.CONNECTING, WebSocket.OPEN].includes(this.#ws.readyState);

    if (isConnectingOrOpen && socketId === this.#socketId) {
      return;
    }

    this.#socketId = socketId;

    const websocketUrl = location.protocol.replace('http', 'ws') + '//' + location.host + '/socket.audio';
    this.#ws = new WebSocket(websocketUrl, 'medley-audio');
    this.#ws.binaryType = 'arraybuffer';

    this.#ws.onopen = () => {
      this.#pcmBuffer.reset();
      this.#sendCommand(AudioSocketCommand.Identify, socketId);
    }

    this.#ws.addEventListener('message', this.#handleStream);
  }

  disconnect() {
    this.#ws?.close();
  }

  play(stationId: string) {
    this.#sendCommand(AudioSocketCommand.Tune, stationId);
    this.#ctx?.resume();
  }

  async #prepareAudioContext() {
    if (this.#ctx) {
      return;
    }

    try {
      this.#ctx = new AudioContext();
      await this.#ctx.audioWorklet.addModule(worklet);
    }
    catch (e) {
      console.log('Error adding AudioWorklet module', e);
      return;
    }

    const options: MedleyStreamProcessorNodeOptions = {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        pcmBuffer: this.#pcmBuffer,
      }
    }

    this.#node = new AudioWorkletNode(this.#ctx, 'medley-stream-processor', options);
    this.#node.onprocessorerror = this.#handleProcessorError;
    this.#node.port.onmessage = this.#handleWorkletNodeMessage;

    this.#node.connect(this.#ctx.destination);

    this.#decoder.addEventListener('message', (e) => {
      const { decoded: { channelData, samplesDecoded }, extra } = e.data;
      this.#pcmBuffer.push(channelData.slice(0, 2), samplesDecoded, extra);
    });
  }

  #sendCommand<T extends AudioSocketCommand>(command: T, data: Parameters<AudioSocketCommandMap[T]>[0]) {
    if (!this.#ws) {
      return;
    }

    const dataBuffer = encode(data) as ArrayBuffer;
    const buffer = new Uint8Array(1 + dataBuffer.byteLength);
    const view = new DataView(buffer.buffer);
    view.setUint8(0, command);
    buffer.set(new Uint8Array(dataBuffer), 1);

    this.#ws.send(buffer)
  }

  #handleProcessorError = (e: Event) => {
    console.log('Processor error', e);
  }

  #handleWorkletNodeMessage = (e: MessageEvent<AudioTransportExtra>) => {
    this.emit('audioExtra', e.data);
  }

  #handleAudioData(data: Uint8Array) {
    if (!this.#ctx) {
      return;
    }


    if (this.#ctx.state === 'running') {
      const infoLength = new DataView(data.buffer, data.byteOffset).getUint16(0, true);
      const extra = decode(new Uint8Array(data.buffer, 2 + data.byteOffset, infoLength));
      const opus = new Uint8Array(data.buffer, 2 + data.byteOffset + infoLength);

      this.#decoder.postMessage({
        opus,
        extra
      });
    }
  }

  #handleStream = (ev: MessageEvent<ArrayBuffer>) => {
    const view = new DataView(ev.data);
    const op = view.getUint8(0);

    const data = new Uint8Array(ev.data).subarray(1);

    if (op === AudioSocketReply.Audio) {
      this.#handleAudioData(data);
    }
  }
}

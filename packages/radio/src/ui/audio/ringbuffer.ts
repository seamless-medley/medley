import type { DeckIndex } from "@seamless-medley/core";
import type { TypedArray } from "type-fest";
import type { AudioTransportExtra, Level } from "../../audio/types";

enum State {
  Read,
  Write
}

function createTypedSharedArrayBuffer<T extends TypedArray>(Ctor: new (buffer: SharedArrayBuffer) => T, elementCount: number) {
  return new Ctor(new SharedArrayBuffer(elementCount * (Ctor as any).BYTES_PER_ELEMENT));
}

export class RingBuffer {
  readonly bufferLength: number;
  private channelData: Float32Array[];

  private deckData: Int8Array;
  private positionData: Float32Array;
  private magnitudeData: Float32Array[];
  private peakData: Float32Array[];
  private reductionData: Float32Array;

  // For storing read/write position
  // private states = new Uint32Array(new SharedArrayBuffer(Object.values(State).length * Uint32Array.BYTES_PER_ELEMENT))
  private states = createTypedSharedArrayBuffer(Uint32Array, Object.values(State).length);

  constructor(readonly size: number, readonly channels: number = 2) {
    this.bufferLength = size + 1;
    this.channels = channels;

    const chanelList = Array(channels).fill(0);
    this.channelData = chanelList.map<Float32Array>(() => new Float32Array(
      new SharedArrayBuffer(this.bufferLength * Float32Array.BYTES_PER_ELEMENT)
    ));

    this.deckData = new Int8Array(new SharedArrayBuffer(this.bufferLength * Uint8Array.BYTES_PER_ELEMENT));
    this.positionData = new Float32Array(new SharedArrayBuffer(this.bufferLength * Float32Array.BYTES_PER_ELEMENT));
    this.magnitudeData = chanelList.map<Float32Array>(() => new Float32Array(
      new SharedArrayBuffer(this.bufferLength * Float32Array.BYTES_PER_ELEMENT)
    ));
    this.peakData = chanelList.map<Float32Array>(() => new Float32Array(
      new SharedArrayBuffer(this.bufferLength * Float32Array.BYTES_PER_ELEMENT)
    ));
    this.reductionData = new Float32Array(new SharedArrayBuffer(this.bufferLength * Float32Array.BYTES_PER_ELEMENT));
  }

  push(inputs: Float32Array[], blockLength: number, extra: AudioTransportExtra) {
    const [currentRead, currentWrite] = this.getCurrentReadWrite();

    if (this.getAvailableWrite(currentRead, currentWrite) < blockLength) {
      return false;
    }

    const [deck, position, levelL, levelR, reduction] = extra;
    const levels = [levelL, levelR];

    let nextWrite = currentWrite + blockLength;

    if (nextWrite > this.bufferLength) {
      nextWrite -= this.bufferLength;

      for (const [channel, data] of this.channelData.entries()) {
        const blockA = data.subarray(currentWrite);
        const blockB = data.subarray(0, nextWrite);

        const input = inputs[channel];

        blockA.set(input.subarray(0, blockA.length));
        blockB.set(input.subarray(blockA.length));
      }

      {
        const blockA = this.deckData.subarray(currentWrite);
        const blockB = this.deckData.subarray(0, nextWrite);

        const d = deck !== undefined ? deck : -1;
        blockA.fill(d);
        blockB.fill(d);
      }

      {
        const blockA = this.positionData.subarray(currentWrite);
        const blockB = this.positionData.subarray(0, nextWrite);

        blockA.fill(position);
        blockB.fill(position);
      }

      for (const [channel, data] of this.magnitudeData.entries()) {
        const blockA = data.subarray(currentWrite);
        const blockB = data.subarray(0, nextWrite);

        blockA.fill(levels[channel][0]);
        blockB.fill(levels[channel][0]);
      }

      for (const [channel, data] of this.peakData.entries()) {
        const blockA = data.subarray(currentWrite);
        const blockB = data.subarray(0, nextWrite);

        blockA.fill(levels[channel][1]);
        blockB.fill(levels[channel][1]);
      }

      {
        const blockA = this.reductionData.subarray(currentWrite);
        const blockB = this.reductionData.subarray(0, nextWrite);

        blockA.fill(reduction);
        blockB.fill(reduction);
      }
    } else {
      for (const [channel, data] of this.channelData.entries()) {
        const block = data.subarray(currentWrite, nextWrite);

        block.set(inputs[channel].subarray(0, blockLength));
      }

      {
        const block = this.deckData.subarray(currentWrite, nextWrite);
        block.fill(deck !== undefined ? deck : -1);
      }

      {
        const block = this.positionData.subarray(currentWrite, nextWrite);
        block.fill(position);
      }

      for (const [channel, data] of this.magnitudeData.entries()) {
        const block = data.subarray(currentWrite, nextWrite);
        block.fill(levels[channel][0]);
      }

      for (const [channel, data] of this.peakData.entries()) {
        const block = data.subarray(currentWrite, nextWrite);
        block.fill(levels[channel][1]);
      }

      {
        const block = this.reductionData.subarray(currentWrite, nextWrite);
        block.fill(reduction);
      }

      if (nextWrite === this.bufferLength) {
        nextWrite = 0;
      }
    }

    Atomics.store(this.states, State.Write, nextWrite);
    return true;
  }

  pull(outputs: Float32Array[], blockLength: number): AudioTransportExtra | undefined {
    const [currentRead, currentWrite] = this.getCurrentReadWrite();

    if (this.getAvailableRead(currentRead, currentWrite) < blockLength) {
      return;
    }

    let deck: DeckIndex | undefined = undefined;
    let position = 0;
    const levelL: Level = [0, 0];
    const levelR: Level = [0, 0];
    let reduction = 0;

    let nextRead = currentRead + blockLength;
    if (this.bufferLength < nextRead) {
      nextRead -= this.bufferLength;


      for (const [channel, data] of this.channelData.entries()) {
        const blockA = data.subarray(currentRead);
        const blockB = data.subarray(0, nextRead);

        const output = outputs[channel];

        output.set(blockA);
        output.set(blockB, blockA.length);
      }

      {
        const d = this.deckData[nextRead-1];
        deck = d !== -1 ? d : undefined;
      }

      {
        position = this.positionData[nextRead-1];
      }

      {
        levelL[0] = this.magnitudeData[0][nextRead-1];
        levelR[0] = this.magnitudeData[1][nextRead-1];
      }

      {
        levelL[1] = this.peakData[0][nextRead-1];
        levelR[1] = this.peakData[1][nextRead-1];
      }

      {
        reduction = this.reductionData[nextRead-1];
      }
    } else {
      for (const [channel, data] of this.channelData.entries()) {
        const output = outputs[channel];
        output.set(data.subarray(currentRead, nextRead));
      }

      {
        const d = this.deckData[nextRead-1];
        deck = d !== -1 ? d : undefined;
      }

      {
        position = this.positionData[nextRead-1];
      }

      {
        levelL[0] = this.magnitudeData[0][nextRead-1];
        levelR[0] = this.magnitudeData[1][nextRead-1];
      }

      {
        levelL[1] = this.peakData[0][nextRead-1];
        levelR[1] = this.peakData[1][nextRead-1];
      }

      {
        reduction = this.reductionData[nextRead-1];
      }

      if (nextRead === this.bufferLength) {
        nextRead = 0;
      }
    }

    Atomics.store(this.states, State.Read, nextRead);
    return [deck, position, levelL, levelR, reduction];
  }

  private getCurrentReadWrite() {
    return [State.Read, State.Write].map(index => Atomics.load(this.states, index));
  }

  getAvailableRead(readIndex: number, writeIndex: number) {
    return (writeIndex >= readIndex)
      ? writeIndex - readIndex
      : writeIndex + this.bufferLength - readIndex;
  }

  getAvailableWrite(readIndex: number, writeIndex: number) {
    return (writeIndex >= readIndex)
      ? this.bufferLength - writeIndex + readIndex - 1
      : readIndex - writeIndex - 1;
  }

  getAvailableSamples() {
    const [currentRead, currentWrite] = this.getCurrentReadWrite();
    return this.getAvailableRead(currentRead, currentWrite);
  }

  isFrameAvailable(size: number) {
    return this.getAvailableSamples() >= size;
  }

  reset() {
    Atomics.store(this.states, State.Read, 0);
    Atomics.store(this.states, State.Write, 0);
  }
}

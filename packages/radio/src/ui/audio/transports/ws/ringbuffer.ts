import type { AudioLevel } from "@seamless-medley/core";
import type { TypedArray } from "type-fest";
import type { AudioTransportExtra, AudioTransportExtraPayload } from "../../../../audio/types";

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

  private magnitudeData: Float32Array[];
  private peakData: Float32Array[];
  private reductionData: Float32Array;

  // For storing read/write position
  private states = createTypedSharedArrayBuffer(Uint32Array, Object.values(State).length);

  constructor(readonly size: number, readonly channels: number = 2) {
    this.bufferLength = size + 1;
    this.channels = channels;

    const chanelList = Array(channels).fill(0);
    this.channelData = chanelList.map<Float32Array>(() => new Float32Array(
      new SharedArrayBuffer(this.bufferLength * Float32Array.BYTES_PER_ELEMENT)
    ));
    this.channelData = chanelList.map(() => createTypedSharedArrayBuffer(Float32Array, this.bufferLength));

    this.magnitudeData = chanelList.map<Float32Array>(() => new Float32Array(
      new SharedArrayBuffer(this.bufferLength * Float32Array.BYTES_PER_ELEMENT)
    ));

    this.peakData = chanelList.map<Float32Array>(() => new Float32Array(
      new SharedArrayBuffer(this.bufferLength * Float32Array.BYTES_PER_ELEMENT)
    ));

    this.reductionData = new Float32Array(new SharedArrayBuffer(this.bufferLength * Float32Array.BYTES_PER_ELEMENT));
  }

  push(inputs: Float32Array[], blockLength: number, extra: AudioTransportExtraPayload) {
    const [currentRead, currentWrite] = this.getCurrentReadWrite();

    if (this.getAvailableWrite(currentRead, currentWrite) < blockLength) {
      return false;
    }

    const [
      left_mag, left_peak,
      right_mag, right_peak,
      reduction
    ] = extra;

    const levels: AudioLevel[] = [
      { magnitude: left_mag, peak: left_peak },
      { magnitude: right_mag, peak: right_peak },
    ];

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

      for (const [channel, data] of this.magnitudeData.entries()) {
        const blockA = data.subarray(currentWrite);
        const blockB = data.subarray(0, nextWrite);

        blockA.fill(levels[channel].magnitude);
        blockB.fill(levels[channel].magnitude);
      }

      for (const [channel, data] of this.peakData.entries()) {
        const blockA = data.subarray(currentWrite);
        const blockB = data.subarray(0, nextWrite);

        blockA.fill(levels[channel].peak);
        blockB.fill(levels[channel].peak);
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

      for (const [channel, data] of this.magnitudeData.entries()) {
        const block = data.subarray(currentWrite, nextWrite);
        block.fill(levels[channel].magnitude);
      }

      for (const [channel, data] of this.peakData.entries()) {
        const block = data.subarray(currentWrite, nextWrite);
        block.fill(levels[channel].peak);
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

    const levelL: AudioLevel = { magnitude: 0, peak: 0 };
    const levelR: AudioLevel = { magnitude: 0, peak: 0 };
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
        levelL.magnitude = this.magnitudeData[0][nextRead-1];
        levelR.magnitude = this.magnitudeData[1][nextRead-1];
      }

      {
        levelL.peak = this.peakData[0][nextRead-1];
        levelR.peak = this.peakData[1][nextRead-1];
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
        levelL.magnitude = this.magnitudeData[0][nextRead-1];
        levelR.magnitude = this.magnitudeData[1][nextRead-1];
      }

      {
        levelL.peak = this.peakData[0][nextRead-1];
        levelR.peak = this.peakData[1][nextRead-1];
      }

      {
        reduction = this.reductionData[nextRead-1];
      }

      if (nextRead === this.bufferLength) {
        nextRead = 0;
      }
    }

    Atomics.store(this.states, State.Read, nextRead);
    return {
      audioLevels: {
        left: levelL,
        right: levelR,
        reduction
      }
    }
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

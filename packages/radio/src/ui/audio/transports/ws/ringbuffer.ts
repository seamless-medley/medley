import type { AudioLevel } from "@seamless-medley/core";
import type { TypedArray } from "type-fest";
import type { AudioTransportExtraPayload } from "../../../../audio/types";

enum State {
  Read,
  Write
}

function createTypedSharedArrayBuffer<T extends TypedArray>(Ctor: new (buffer: SharedArrayBuffer) => T, elementCount: number) {
  return new Ctor(new SharedArrayBuffer(elementCount * (Ctor as any).BYTES_PER_ELEMENT));
}

export class RingBuffer<ExtraIn, ExtraOut = ExtraIn> {
  readonly bufferLength: number;
  private channelData: Float32Array[];

  // For storing read/write position
  private states = createTypedSharedArrayBuffer(Uint32Array, Object.values(State).length);

  constructor(readonly size: number, readonly channels: number = 2) {
    this.bufferLength = size + 1;
    this.channels = channels;

    this.channelData = Array(channels).fill(0).map(() => createTypedSharedArrayBuffer(Float32Array, this.bufferLength));
  }

  protected doPush(inputs: Float32Array[], blockLength: number, extra: ExtraIn, currentWrite: number, nextWrite: number, overlap: boolean) {
    if (overlap) {
      for (const [channel, data] of this.channelData.entries()) {
        const blockA = data.subarray(currentWrite);
        const blockB = data.subarray(0, nextWrite);

        const input = inputs[channel];

        blockA.set(input.subarray(0, blockA.length));
        blockB.set(input.subarray(blockA.length));
      }
    } else {
      for (const [channel, data] of this.channelData.entries()) {
        const block = data.subarray(currentWrite, nextWrite);

        block.set(inputs[channel].subarray(0, blockLength));
      }
    }
  }

  protected doPull(outputs: Float32Array[], blockLength: number, currentRead: number, nextRead: number, overlap: boolean): ExtraOut | undefined {
    if (overlap) {
      for (const [channel, data] of this.channelData.entries()) {
        const blockA = data.subarray(currentRead);
        const blockB = data.subarray(0, nextRead);

        const output = outputs[channel];

        output.set(blockA);
        output.set(blockB, blockA.length);
      }
    } else {
      for (const [channel, data] of this.channelData.entries()) {
        const output = outputs[channel];
        output.set(data.subarray(currentRead, nextRead));
      }
    }

    return undefined;
  }

  push(inputs: Float32Array[], blockLength: number, extra: ExtraIn) {
    const [currentRead, currentWrite] = this.getCurrentReadWrite();

    if (this.getAvailableWrite(currentRead, currentWrite) < blockLength) {
      return false;
    }

    let nextWrite = currentWrite + blockLength;

    if (nextWrite > this.bufferLength) {
      nextWrite -= this.bufferLength;
      this.doPush(inputs, blockLength, extra, currentWrite, nextWrite, true);
    } else {
      this.doPush(inputs, blockLength, extra, currentWrite, nextWrite, false);

      if (nextWrite === this.bufferLength) {
        nextWrite = 0;
      }
    }

    Atomics.store(this.states, State.Write, nextWrite);
    return true;
  }

  pull(outputs: Float32Array[], blockLength: number): ExtraOut | undefined {
    const [currentRead, currentWrite] = this.getCurrentReadWrite();

    if (this.getAvailableRead(currentRead, currentWrite) < blockLength) {
      return;
    }

    let result: ExtraOut | undefined;

    let nextRead = currentRead + blockLength;
    if (this.bufferLength < nextRead) {
      nextRead -= this.bufferLength;

      result = this.doPull(outputs, blockLength, currentRead, nextRead, true);
    } else {
      result = this.doPull(outputs, blockLength, currentRead, nextRead, false);

      if (nextRead === this.bufferLength) {
        nextRead = 0;
      }
    }

    Atomics.store(this.states, State.Read, nextRead);

    return result;
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

export type Timestamp = {
  origin: number;
  value: number;
}

export type AudioTransportExtraPayloadWithTimestamp = {
  extra: AudioTransportExtraPayload;
  timestamp: number;
}

export class RingBufferWithExtra extends RingBuffer<AudioTransportExtraPayloadWithTimestamp, AudioTransportExtraPayloadWithTimestamp> {
  private magnitudeData: Float32Array[];
  private peakData: Float32Array[];
  private reductionData: Float32Array;
  private timestampData: Float64Array;

  constructor(size: number, channels: number = 2) {
    super(size, channels);

    const channelList = Array(channels).fill(0);

    this.magnitudeData = channelList.map<Float32Array>(() => new Float32Array(
      new SharedArrayBuffer(this.bufferLength * Float32Array.BYTES_PER_ELEMENT)
    ));

    this.peakData = channelList.map<Float32Array>(() => new Float32Array(
      new SharedArrayBuffer(this.bufferLength * Float32Array.BYTES_PER_ELEMENT)
    ));

    this.reductionData = new Float32Array(new SharedArrayBuffer(this.bufferLength * Float32Array.BYTES_PER_ELEMENT));
    this.timestampData = new Float64Array(new SharedArrayBuffer(this.bufferLength * Float64Array.BYTES_PER_ELEMENT));
  }

  protected override doPush(inputs: Float32Array[], blockLength: number, payload: AudioTransportExtraPayloadWithTimestamp, currentWrite: number, nextWrite: number, overlap: boolean) {
    super.doPush(inputs, blockLength, payload, currentWrite, nextWrite, overlap);

    const {
      extra: [
        left_mag, left_peak,
        right_mag, right_peak,
        reduction
      ],
      timestamp
     } = payload;

    const levels: AudioLevel[] = [
      { magnitude: left_mag, peak: left_peak },
      { magnitude: right_mag, peak: right_peak },
    ];

    if (overlap) {
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

      {
        const blockA = this.timestampData.subarray(currentWrite);
        const blockB = this.timestampData.subarray(0, nextWrite);

        blockA.fill(timestamp);
        blockB.fill(timestamp);
      }
    } else {
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

      {
        const block = this.timestampData.subarray(currentWrite, nextWrite);
        block.fill(timestamp);
      }
    }
  }

  protected doPull(outputs: Float32Array[], blockLength: number, currentRead: number, nextRead: number, overlap: boolean): AudioTransportExtraPayloadWithTimestamp | undefined {
    super.doPull(outputs, blockLength, currentRead, nextRead, overlap);

    return {
      extra: [
        this.magnitudeData[0][nextRead-1],
        this.peakData[0][nextRead-1],

        this.magnitudeData[1][nextRead-1],
        this.peakData[1][nextRead-1],

        this.reductionData[nextRead-1]
      ],
      timestamp: this.timestampData[nextRead-1]
    }
  }
}

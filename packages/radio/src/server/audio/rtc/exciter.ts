import { encode } from 'notepack.io';
import { type types } from 'mediasoup';
import { Exciter, IExciter } from "../../../audio/exciter";
import { RTPData, createRTPHeader, incRTPData } from "../../../audio/network/rtp";
import { randomNBit } from "@seamless-medley/utils";
import { createLogger, type Logger } from "../../../logging";
import type { AudioTransportExtraPayload } from "../../../audio/types";
import { Station } from "../../../core";

const payloadType = 119;

const allSSRC = new Set<number>();

function makeSSRC() {
  while (true) {
    const ssrc = randomNBit(32);

    if (allSSRC.has(ssrc)) continue;

    allSSRC.add(ssrc);
    return ssrc;
  }
}

export type RTCExciterOptions = {
  station: Station;
  transport: types.DirectTransport;
  bitrate: number;
  backlog?: number;
}

export class RTCExciter extends Exciter implements IExciter {
  #ssrc = makeSSRC();
  #transport: types.DirectTransport;
  #producer?: types.Producer;
  #audioLevelDataProducer?: types.DataProducer;
  #eventDataProducer?: types.DataProducer;

  #rtpData: RTPData;
  #preparedPacket?: Buffer;
  #preparedAudioLevelInfo?: Buffer;
  #preparedAudioLatencyInfo?: Buffer;

  #logger: Logger;

  constructor({ station, transport, bitrate, backlog = 12 }: RTCExciterOptions) {
    super(
      station,
      {
        format: 'Int16LE',
        sampleRate: 48_000,
        bufferSize: 960 * 24,
        buffering: 960 * Math.max(1, backlog / 4)
      },
      { bitrate, backlog }
    );

    this.#logger = createLogger({ name: 'rtc-exciter', id: station.id })

    this.#transport = transport;

    this.#rtpData = {
      ssrc: this.#ssrc,
      sequence: randomNBit(16),
      timestamp: randomNBit(32),
    }

    this.#setupProducer();
  }

  async #setupProducer() {
    this.#producer = await this.#transport.produce({
      kind: 'audio',
      rtpParameters: {
        codecs: [
          {
            payloadType,
            mimeType: 'audio/opus',
            clockRate: 48_000,
            channels: 2,
            parameters: {
              usedtx: 1,
              useinbandfec: 1,
              'sprop-stereo': 1,
              maxplaybackrate: 48_000,
            }
          }
        ],
        encodings: [
          { ssrc: this.#ssrc }
        ]
      }
    });

    this.#audioLevelDataProducer = await this.#transport.produceData({
      label: 'audio-level',
      protocol: 'notepack'
    });

    this.#eventDataProducer = await this.#transport.produceData({
      label: 'events',
      protocol: 'notepack'
    });
  }

  get producerId() {
    return this.#producer?.id;
  }

  get audioLevelDataProducerId() {
    return this.#audioLevelDataProducer?.id;
  }

  get eventDataProducerId() {
    return this.#eventDataProducer?.id;
  }

  override prepare(): void {
    const { opus } = this.read();

    if (!opus) {
      this.#preparedPacket = undefined;
      return;
    }

    const header = createRTPHeader({
      ...this.#rtpData,
      payloadType
    });

    this.#preparedPacket = Buffer.concat([
      header,
      opus
    ]);

    const { audioLevels: { left, right, reduction }  } = this.station;

    const extra: AudioTransportExtraPayload = [
      left.magnitude,
      left.peak,
      right.magnitude,
      right.peak,
      reduction
    ];

    this.#preparedAudioLevelInfo = encode(extra) as Buffer;

    this.updateAudioLatency((latencyMs) => {
      this.#preparedAudioLatencyInfo = encode({
        type: 'audio-latency',
        latencyMs
      }) as Buffer;
    });
  }

  override dispatch(): void {
    if (!this.request) {
      return;
    }

    if (this.#preparedPacket) {
      try {
        this.#producer?.send(this.#preparedPacket);

        if (this.#preparedAudioLevelInfo) {
          this.#audioLevelDataProducer?.send(this.#preparedAudioLevelInfo);
        }

        incRTPData(this.#rtpData);
      }
      catch (e) {
        this.#logger.error('Error while dispatching packet');
        this.stop();
      }
    }

    if (this.#preparedAudioLatencyInfo) {
      this.#eventDataProducer?.send(this.#preparedAudioLatencyInfo);
      this.#preparedAudioLatencyInfo = undefined;
    }

    this.#preparedPacket = undefined;
    this.#preparedAudioLevelInfo = undefined;
  }

  override stop() {
    super.stop();

    this.#transport.close();
  }
}

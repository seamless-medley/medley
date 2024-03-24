import { Station } from "@seamless-medley/core";
import { encode } from 'notepack.io';
import { type types } from 'mediasoup';
import { Exciter, IExciter } from "../../../audio/exciter";
import { RTPData, createRTPHeader, incRTPData } from "../../../audio/network/rtp";
import { randomNBit } from "@seamless-medley/utils";
import type { AudioTransportExtraPayload } from "../../../audio/types";
import { Logger, createLogger } from "@seamless-medley/logging";

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
}

export class RTCExciter extends Exciter implements IExciter {
  #ssrc = makeSSRC();
  #transport: types.DirectTransport;
  #producer?: types.Producer;
  #audioLevelDataProducer?: types.DataProducer;

  #rtpData: RTPData;
  #preparedPacket?: Buffer;
  #preparedInfo?: Buffer;

  #logger: Logger;

  constructor({ station, transport, bitrate }: RTCExciterOptions) {
    super(
      station,
      {
        format: 'Int16LE',
        sampleRate: 48_000,
        bufferSize: 960 * 24,
        buffering: 960 * 12, // Opus packet size x number of Opus packets
      },
      { bitrate }
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
  }

  get producerId() {
    return this.#producer?.id;
  }

  get audioLevelDataProducerId() {
    return this.#audioLevelDataProducer?.id;
  }

  override prepare(): void {
    const opus = this.read();

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

    const { audioLevels  } = this.station;

    const extra: AudioTransportExtraPayload = [
      audioLevels.left.magnitude,
      audioLevels.left.peak,
      audioLevels.right.magnitude,
      audioLevels.right.peak,
      audioLevels.reduction
    ]

    this.#preparedInfo = encode(extra) as Buffer;
  }

  override dispatch(): void {
    if (!this.request) {
      return;
    }

    if (this.#preparedPacket) {
      try {
        this.#producer?.send(this.#preparedPacket);

        if (this.#preparedInfo) {
          this.#audioLevelDataProducer?.send(this.#preparedInfo);
        }

        incRTPData(this.#rtpData);
      }
      catch (e) {
        this.#logger.error('Error while dispatching packet');
        this.stop();
      }
    }

    this.#preparedPacket = undefined;
    this.#preparedInfo = undefined;
  }

  override stop() {
    super.stop();

    this.#transport.close();
  }
}

import { Station } from "@seamless-medley/core";
import { encode } from 'notepack.io';
import { type types } from 'mediasoup';
import { Exciter, IExciter } from "../../../audio/exciter";
import { RTPData, createRTPHeader, incRTPData } from "../../../audio/network/rtp";
import { randomNBit } from "@seamless-medley/utils";
import type { AudioTransportExtraPayload } from "../../../audio/types";

export class RTCExciter extends Exciter implements IExciter {
  #transport: types.DirectTransport;
  #producer?: types.Producer;
  #audioLevelDataProducer?: types.DataProducer;

  #rtpData: RTPData;
  #preparedPacket?: Buffer;
  #preparedInfo?: Buffer;

  constructor(station: Station, transport: types.DirectTransport) {
    super(
      station,
      { format: 'Int16LE', sampleRate: 48_000 },
      { bitrate: 256_000 }
    );

    this.#transport = transport;

    this.#rtpData = {
      ssrc: 12345678, // TODO: Register new SSRC
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
          // TODO: Define payload type
          {
            payloadType: 109,
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 2,
            parameters: {
              usedtx: 1,
              useinbandfec: 1,
              stereo: 1,
              'sprop-stereo': 1,
              maxplaybackrate: 48000,
              maxaveragebitrate: 510000,
            }
          }
        ],
        encodings: [
          // TODO: Randomize SSRC
          { ssrc: 12345678 }
        ]
      }
    });

    this.#audioLevelDataProducer = await this.#transport.produceData({
      label: 'audio-level',
      protocol: 'notepack'
    })
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
      payloadType: 109
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
    if (this.#preparedPacket) {
      this.#producer?.send(this.#preparedPacket);
      incRTPData(this.#rtpData);

      if (this.#preparedInfo) {
        this.#audioLevelDataProducer?.send(this.#preparedInfo);
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

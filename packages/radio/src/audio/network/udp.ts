import dgram from 'node:dgram';
import { ICarrier } from '../exciter';

export class UDPCarrier implements ICarrier {
  #socket = dgram.createSocket('udp4');

  #address: string;
  #port: number;

  #preparedPacket?: Buffer;

  constructor(address: string, port: number) {
    this.#address = address;
    this.#port = port;
  }

  get isReady(): boolean {
    return true;
  }

  prepareAudioPacket(buffer: Buffer): Buffer | undefined {
    this.#preparedPacket = buffer;
    return buffer;
  }

  dispatchAudio(): boolean {
    if (!this.#preparedPacket) {
      return false;
    }

    this.#socket.send(this.#preparedPacket, this.#port, this.#address);

    return true;
  }
}

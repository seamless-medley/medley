import { createSocket, type Socket } from 'node:dgram';
import { isIPv4 } from 'node:net';
import { TypedEmitter } from "tiny-typed-emitter";

export interface UDPConnectionEvents {
  close(): void;
  error(error: Error): void;
  message(message: Buffer): void;
}

export type SocketConfig = {
  ip: string;
  port: number;
}

const MAX_COUNTER_VALUE = 2 ** 32 - 1;

export class UDPConnection extends TypedEmitter<UDPConnectionEvents> {
  readonly #socket: Socket;

  #keepAliveCounter = 0;

  readonly #keepAliveBuffer = Buffer.alloc(8);

  #keepAliveTimer: NodeJS.Timeout;

  constructor(readonly config: SocketConfig) {
    super();

    this.#socket = createSocket('udp4')
      .on('message', this.#onMessage)
      .on('close', this.#onClose)
      .on('error', this.#onError)

    this.#keepAliveBuffer.writeUInt32BE(this.#keepAliveCounter, 0);
    this.#keepAliveTimer = setInterval(() => this.#keepAlive(), 5e3);
    setImmediate(() => this.#keepAlive());
  }

  destroy() {
    try {
      this.#socket.close();
    }
    catch {

    }

    clearInterval(this.#keepAliveTimer);
  }

  #onMessage = (buffer: Buffer) => {
    this.emit('message', buffer);
  }

  #onClose = () => {
    this.emit('close');
  }

  #onError = (e: Error) => {
    this.emit('error', e);
  }

  #keepAlive() {
    this.#keepAliveBuffer.writeUInt32LE(this.#keepAliveCounter, 4);
    this.send(this.#keepAliveBuffer);

    this.#keepAliveCounter++;

    if (this.#keepAliveCounter > MAX_COUNTER_VALUE) {
      this.#keepAliveCounter = 0;
    }
  }

  send(buffer: Buffer) {
    this.#socket.send(buffer, this.config.port, this.config.ip);
  }

  async performIPDiscovery(ssrc: number) {
    return new Promise<SocketConfig>((resolve, reject) => {
      const handler = (message: Buffer) => {
        try {
          const type = message.readUInt16BE(0);
          if (type !== 2) { // 2 - response
            return;
          }

          resolve(extractIPDiscovery(message));

          this.#socket.off('message', handler);
        }
        catch {

        }
      }

      this.#socket
        .on('message', handler)
        .once('close', () => reject(new Error('Cannot perform IP discovery - socket closed')));

      const discoveryBuffer = Buffer.alloc(74);

      discoveryBuffer.writeUInt16BE(1, 0);
      discoveryBuffer.writeUInt16BE(70, 2);
      discoveryBuffer.writeUInt32BE(ssrc, 4);
      this.send(discoveryBuffer);
    })
  }
}

function extractIPDiscovery(message: Buffer): SocketConfig {
  const null_pos = message.indexOf(0, 8);
  const ip = message.subarray(8, null_pos).toString('utf8');

  if (!isIPv4(ip)) {
    throw new Error('Malformed IP address');
  }

  const port = message.readUInt16BE(message.length - 2);

  return { ip, port };
}


import { Station } from "@seamless-medley/core";
import EventEmitter from "events";
import http, { IncomingMessage } from "http";
import { decode } from "notepack.io";
import { Duplex } from "stream";
import { WebSocket, WebSocketServer } from "ws";
import { AudioSocketCommand, AudioSocketReply } from "../../socket/audio";
import { AudioDispatcher } from "../../audio/exciter/dispatcher";
import { WebStreamExciter } from "./stream";

export class AudioServer extends EventEmitter {
  #server: WebSocketServer;

  #sockets: AudioSocket[] = [];

  #dispatcher = new AudioDispatcher();

  #published = new Map<Station, WebStreamExciter>();

  constructor(httpServer: http.Server) {
    super();

    this.#server = new WebSocketServer({
      noServer: true,
      clientTracking: false
    });

    httpServer.on('upgrade', this.handleUpgrade);
  }

  private handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!req.url) {
      return;
    }

    if (!req.url.startsWith('/socket.audio')) {
      return;
    }

    this.#server.handleUpgrade(req, socket, head, this.onWebSocket);
  }

  private onWebSocket = (socket: WebSocket) => {
    this.#sockets.push(new AudioSocket(this, socket));

    socket.on('close', () => {
      const index = this.#sockets.findIndex(a => a.socket === socket);

      if (index > -1) {
        this.#sockets.splice(index, 1);
      }
    });
  }

  #stationListeners = new Map<Station['id'], Set<AudioSocket>>();

  tuneAudioSocket(stationId: Station['id'], socket: AudioSocket) {
    const station = [...this.#published.keys()].find(s => s.id === stationId);
    if (!station) {
      return;
    }

    if (this.#stationListeners.get(stationId)?.has(socket)) {
      return;
    }

    // Remove socket from old station
    for (const sockets of this.#stationListeners.values()) {
      if (sockets.has(socket)) {
        sockets.delete(socket);
        break;
      }
    }

    if (!this.#stationListeners.has(stationId)) {
      this.#stationListeners.set(stationId, new Set());
    }

    this.#stationListeners.get(stationId)!.add(socket);

    // TODO: Station audience
  }

  async publish(station: Station) {
    const player = new WebStreamExciter(station);

    player.on('packet', (packet) => {
      const listeners = this.#stationListeners.get(station.id);

      if (!listeners || listeners.size < 1)  {
        return;
      }

      for (const listener of listeners) {
        listener.sendPacket(packet);
      }
    })

    player.start(this.#dispatcher)

    this.#published.set(station, player);
  }

  unpublish(station: Station) {
    if (this.#published.has(station)) {
      const player = this.#published.get(station)!
      player.stop();

      this.#published.delete(station);
    }

    this.#stationListeners.delete(station.id);
  }
}

class AudioSocket {
  #socketId?: string;

  constructor(readonly server: AudioServer, readonly socket: WebSocket) {
    socket.on('message', this.#handleMessage);
  }

  #handleMessage = (m: Buffer) => {
    console.log('handleMessage', m);
    const command = m.readUint8(0) as AudioSocketCommand;
    const data = decode(m.subarray(1));

    switch (command) {
      case AudioSocketCommand.Identify:
        this.#socketId = data;
        break;

      case AudioSocketCommand.Tune:
        const stationId = data;
        this.server.tuneAudioSocket(stationId, this);
        break;
    }
  }

  get socketId() {
    return this.#socketId;
  }

  sendPayload(reply: AudioSocketReply, data: Buffer) {
    const payload = Buffer.alloc(data.byteLength + 1);
    payload.writeUInt8(reply);
    payload.set(data, 1);
    this.socket.send(payload);
  }

  sendPacket(packet: Buffer) {
    this.sendPayload(AudioSocketReply.Opus, packet);
  }
}

import { AudienceType, Station, makeAudienceGroupId } from "@seamless-medley/core";
import EventEmitter from "events";
import http, { IncomingMessage } from "http";
import { decode } from "notepack.io";
import { Duplex } from "stream";
import { WebSocket, WebSocketServer } from "ws";
import { AudioSocketCommand, AudioSocketReply } from "../../../socket/audio";
import { AudioDispatcher } from "../../../audio/exciter/dispatcher";
import { WebSocketExciter } from "./exciter";

export class AudioWebSocketServer extends EventEmitter {
  #server: WebSocketServer;

  #sockets: AudioWebSocket[] = [];

  #dispatcher = new AudioDispatcher();

  #published = new Map<Station, WebSocketExciter>();

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
    const audioSocket = new AudioWebSocket(this, socket);
    this.#sockets.push(audioSocket);

    socket.on('close', () => {
      const index = this.#sockets.findIndex(a => a.socket === socket);

      if (index > -1) {
        this.#sockets.splice(index, 1);
      }

      const { stationId, socketId } = audioSocket;

      if (stationId && socketId) {
        const station = this.#stationFromId(stationId);

        station?.removeAudience(
          makeAudienceGroupId(AudienceType.Web, `ws`),
          socketId
        );
      }
    });
  }

  #stationListeners = new Map<Station['id'], Set<AudioWebSocket>>();

  #stationFromId(stationId: Station['id']) {
    return [...this.#published.keys()].find(s => s.id === stationId);
  }

  tuneAudioSocket(stationId: Station['id'], socket: AudioWebSocket): boolean {
    const station = this.#stationFromId(stationId);
    if (!station) {
      return false;
    }

    if (this.#stationListeners.get(stationId)?.has(socket)) {
      return true;
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

    if (socket.socketId) {
      station.addAudience(
        makeAudienceGroupId(AudienceType.Web, `ws`),
        socket.socketId
      );
    }

    return true;
  }

  async publish(station: Station) {
    const exciter = new WebSocketExciter(station);

    exciter.on('packet', (packet) => {
      const listeners = this.#stationListeners.get(station.id);

      if (!listeners || listeners.size < 1)  {
        return;
      }

      for (const listener of listeners) {
        listener.sendPacket(packet);
      }
    })

    exciter.start(this.#dispatcher)

    this.#published.set(station, exciter);
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

class AudioWebSocket {
  #socketId?: string;

  #stationId?: Station['id'];

  constructor(readonly server: AudioWebSocketServer, readonly socket: WebSocket) {
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
        if (this.server.tuneAudioSocket(stationId, this)) {
          this.#stationId = stationId;
        }
        break;
    }
  }

  get socketId() {
    return this.#socketId;
  }

  get stationId() {
    return this.#stationId;
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

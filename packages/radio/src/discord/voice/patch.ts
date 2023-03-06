import { VoiceConnection } from "@discordjs/voice";
import EventEmitter from "events";

const $Patch = Symbol.for('$medley$keepAlivePatch');

export function voiceConnectionKeepAlivePatch(voiceConnection: VoiceConnection) {
  voiceConnection.on('stateChange', (oldState, newState) => {
    const oldNetworking = Reflect.get(oldState, 'networking');
    const newNetworking = Reflect.get(newState, 'networking');

    const networkStateChangeHandler = (oldNetworkState: any, newNetworkState: any) => {
      const oldUdp = Reflect.get(oldNetworkState, 'udp') as VoiceUDPSocket | undefined;
      const newUdp = Reflect.get(newNetworkState, 'udp') as VoiceUDPSocket | undefined;

      const udpChanged = oldUdp !== newUdp;

      if (oldUdp && udpChanged) {
        clearInterval(Reflect.get(oldUdp, $Patch));
      }

      newUdp?.keepAlives?.splice(0, 1);
      clearInterval(newUdp?.keepAliveInterval);

      if (newUdp && !Reflect.get(newUdp, $Patch)) {
        newUdp.onMessage = (buffer: Buffer) => {
          if (buffer.length === 8) {
            const counter = buffer.readUInt32LE(4);
            const index = newUdp.keepAlives.findIndex(({ value }) => value === counter);
            if (index === -1)
              return;

            newUdp.ping = Date.now() - newUdp.keepAlives[index].timestamp;
            newUdp.keepAlives.splice(0, index);
          }

          newUdp.emit('message', buffer);
        }

        let counter = 0;
        const buffer = Buffer.alloc(8);
        buffer.writeInt32BE(0x1337cafe, 0);

        function sendKeepAlive() {
          if (newUdp) {
            buffer.writeUInt32LE(counter, 4);
            newUdp.send(buffer);

            newUdp.keepAlives.push({
              value: counter,
              timestamp: Date.now(),
            });

            counter++;

            if (counter > 2 ** 32 - 1) {
              counter = 0;
            }
          }
        }

        const timer = setInterval(sendKeepAlive, 5000);
        setImmediate(() => sendKeepAlive);

        Reflect.set(newUdp, $Patch, timer);
      }
    }

    oldNetworking?.off('stateChange', networkStateChangeHandler);
    newNetworking?.on('stateChange', networkStateChangeHandler);
  });

  return voiceConnection;
}

type KeepAlive = {
	timestamp: number;
	value: number;
}

interface VoiceUDPSocket extends EventEmitter  {
  readonly keepAliveInterval: NodeJS.Timeout;
  readonly keepAlives: KeepAlive[];
  ping?: number;

  onMessage(buffer: Buffer): void;
  send(buffer: Buffer): void;
}

import { OpusHead } from "../../audio/codecs/opus/frame";
import { OpusOggPageMaker } from "../../audio/codecs/opus/helper";

export class AudioClient {
  constructor() {
    const audio = new AudioContext({ latencyHint: 'interactive' });

    const pageMaker = new OpusOggPageMaker(new OpusHead({ channels: 2, sampleRate: 48000 }), 'Medley');

    const websocketUrl = location.protocol.replace('http', 'ws') + '//' + location.host + '/socket.audio';
    const ws = new WebSocket(websocketUrl, 'medley-audio');
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      // ws.send('Hello');
    }

    let _playStartedAt: number;
    let _totalTimeScheduled = 0;
    let queue: any[] = [];

    ws.onmessage = async (p) => {
      // console.log(pageMaker.pack(new Uint8Array(p.data)).byteLength);
      // const buffer = pageMaker.pack(new Uint8Array(p.data));

      // TODO: Need to implement audio worklet

      queue.push(new Uint8Array(p.data));

      if (queue.length >= 25) {
        const buffer = pageMaker.pack(...queue);
        queue = [];

        audio.decodeAudioData(buffer.buffer)
          .then((buffer) => {
            if (!_playStartedAt) {
              _playStartedAt = audio.currentTime + 0.33;
            }

            const src = new AudioBufferSourceNode(audio, { buffer });
            src.connect(audio.destination);

            const at = _playStartedAt + _totalTimeScheduled;
            src.start(at);

            _totalTimeScheduled += buffer.duration;
          })
          .catch((e) => {
            console.error(e);
          });
      }
    }
  }
}

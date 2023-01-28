import { OpusDecodedAudio, OpusDecoder } from 'opus-decoder';

export type InputMessage<T> = {
  opus: Uint8Array;
  extra: T;
}

export type OutputMessage<T> = {
  decoded: OpusDecodedAudio;
  extra: T;
}

export interface DecoderEventMap<T> extends AbstractWorkerEventMap {
  "message": MessageEvent<OutputMessage<T>>;
  "messageerror": MessageEvent;
}

export interface Decoder<T> extends Worker {
  onmessage: ((this: Decoder<T>, ev: MessageEvent<OutputMessage<T>>) => any) | null;
  onmessageerror: ((this: Decoder<T>, ev: MessageEvent) => any) | null;

  postMessage(input: InputMessage<T>): void;

  addEventListener<K extends keyof DecoderEventMap<T>>(type: K, listener: (this: Decoder<T>, ev: DecoderEventMap<T>[K]) => any, options?: boolean | AddEventListenerOptions): void;
  removeEventListener<K extends keyof DecoderEventMap<T>>(type: K, listener: (this: Decoder<T>, ev: DecoderEventMap<T>[K]) => any, options?: boolean | EventListenerOptions): void;
}

async function run() {
  const decoder = new OpusDecoder();

  await decoder.ready;

  self.addEventListener('message', (e: MessageEvent<InputMessage<any>>) => {
    const { opus, extra } = e.data;
    const decoded = decoder.decodeFrame(opus);

    self.postMessage({
      decoded,
      extra
    })
  });
}

run();

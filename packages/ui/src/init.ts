import { createRoot, type Root } from "react-dom/client";
import * as LogTape from "@logtape/logtape";
import { MedleyClient } from "./medley-client";

let root: Root;
let _client: MedleyClient | undefined;

export async function initLogging() {
  const sinks = ['console'];

  await LogTape.configure({
    sinks: {
      console: LogTape.getConsoleSink({
        nonBlocking: true
      })
    },
    loggers: [
      { category: ['logtape', 'meta'], lowestLevel: 'error', sinks },
      { category: 'main', sinks },
      { category: 'client', sinks },
      { category: 'transport', sinks },
      { category: 'audio', sinks },
      { category: 'ui', sinks },
    ]
  });
}

export function initClient() {
  // @ts-ignore
  const isDev = import.meta.env.DEV;

  if (isDev) {
    _client = window.$client;
  }

  if (!_client) {
    _client = new MedleyClient();
    _client.once('disconnect', () => {
      _client?.dispose();
      _client = undefined;
      window.$client = undefined;
    });

    if (isDev) {
      window.$client = _client;
    }
  }

  return _client;
}

export function initRoot() {
  // @ts-ignore
  if (import.meta.env.DEV) {
    root = window.$root;
  }

  root ??= createRoot(document.getElementById('root') as HTMLElement);

  // @ts-ignore
  if (!window.$root && import.meta.env.DEV) {

    window.$root = root;
  }

  return root;
}

export const client = initClient();


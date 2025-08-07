import { createRoot, type Root } from "react-dom/client";
import { MedleyClient } from "./medley-client";

let root: Root;
let _client: MedleyClient | undefined;

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

  console.groupEnd();

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


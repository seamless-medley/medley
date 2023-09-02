import { createRoot, type Root } from "react-dom/client";
import type { RemoteTypes } from "../socket/remote";
import { Client } from "./client";

let root: Root;
let client: Client<RemoteTypes>;

export function initClient() {
  console.group('initClient');
  // @ts-ignore
  const isDev = import.meta.env.DEV;

  if (isDev) {
    console.log('Restore', window.$client);
    client = window.$client;
  }

  if (!client) {
    console.log('Create client');

    client = new Client<RemoteTypes>();
    client.once('disconnect', () => client.dispose());

    if (isDev) {
      console.log('Save', client);
      window.$client = client;
    }
  }

  console.groupEnd();

  return client;
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


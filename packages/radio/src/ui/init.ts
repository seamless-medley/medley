import { createRoot, type Root } from "react-dom/client";
import type { RemoteTypes } from "../socket/remote";
import { Client } from "./client";

let root: Root;
let client: Client<RemoteTypes>;

export function initClient() {
  // @ts-ignore
  if (import.meta.env.DEV) {
    client = window.$client;
  }

  client ??= new Client<RemoteTypes>();

  // @ts-ignore
  if (!window.$client && import.meta.env.DEV) {
    window.$client = client;
  }

  client.once('disconnect', () => client.dispose());

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


/// <reference types="vite/client" />

import type { Root } from "react-dom/client";
import type { RemoteTypes } from "../remotes";
import type { Client } from "./client";

declare global {
  interface Window {
    $root: Root,
    $client: Client<RemoteTypes>
  }
}

/// <reference types="vite/client" />

import type { Root } from "react-dom/client";
import type { MedleyClient } from "./medley-client";

declare global {
  interface Window {
    $root: Root,
    $client: MedleyClient | undefined;
  }
}

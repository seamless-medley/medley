import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: './src/ui',
  plugins: [
    react()
  ],
  server: {
    proxy: {
      '/socket.io': {
        target: 'ws://localhost:3001',
        ws: true
      }
    }
  }
});

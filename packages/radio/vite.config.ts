import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import jotaiDebugLabel from 'jotai/babel/plugin-debug-label'
import jotaiReactRefresh from 'jotai/babel/plugin-react-refresh'

export default defineConfig({
  root: './src/ui',
  plugins: [
    react({
      babel: {
        plugins: [
          jotaiDebugLabel,
          jotaiReactRefresh
        ]
      }
    })
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

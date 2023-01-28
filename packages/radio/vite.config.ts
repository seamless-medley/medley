import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import jotaiDebugLabel from 'jotai/babel/plugin-debug-label';
import jotaiReactRefresh from 'jotai/babel/plugin-react-refresh';

export default defineConfig({
  root: './src/ui',
  plugins: [
    {
      name: "configure-response-headers",
      configureServer: (server) => {
        // TODO: implement this in the real server
        server.middlewares.use((_, res, next) => {
          res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
          res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
          next();
        });
      },
    },
    react({
      babel: {
        plugins: [
          jotaiDebugLabel,
          jotaiReactRefresh,
          ["@babel/plugin-proposal-private-methods", { loose: true }],
          ["@babel/plugin-proposal-decorators", { legacy: true }],
          ["@babel/plugin-proposal-class-properties", { loose: true }]
        ]
      }
    })
  ],
  server: {
    proxy: {
      '/socket.io': {
        target: 'ws://localhost:3001',
        ws: true
      },
      '/socket.audio': {
        target: 'ws://localhost:3001',
        ws: true
      }
    }
  }
});

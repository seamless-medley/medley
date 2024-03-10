import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import jotaiDebugLabel from 'jotai/babel/plugin-debug-label';
import jotaiReactRefresh from 'jotai/babel/plugin-react-refresh';
import mkcert from 'vite-plugin-mkcert';

export default defineConfig({
  root: './src/ui/app',
  plugins: [
    {
      name: "configure-response-headers",
      configureServer: (server) => {
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
          ["@babel/plugin-transform-private-methods", { loose: true }],
          ["@babel/plugin-transform-class-properties", { loose: true }],
          ["@babel/plugin-proposal-decorators", { legacy: true }]
        ]
      }
    }),
    mkcert()
  ],
  server: {
    https: {

    },
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

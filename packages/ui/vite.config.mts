import { defineConfig } from "vite";
import mkcert from 'vite-plugin-mkcert';
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import wyw from '@wyw-in-js/vite';

export default defineConfig({
  root: './src/app',
  plugins: [
    mkcert(),
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
    TanStackRouterVite({ enableRouteGeneration: false }),
    react({
      babel: {
        presets: ['@babel/preset-typescript', ['@babel/preset-react', { runtime: 'automatic' }]],
        plugins: [
          ["@babel/plugin-transform-private-methods", { loose: true }],
          ["@babel/plugin-transform-class-properties", { loose: true }],
          ["@babel/plugin-proposal-decorators", { legacy: true }]
        ]
      }
    }),
    wyw({
      include: ['**/*.{ts,tsx}'],
      babelOptions: {
        presets: ['@babel/preset-typescript', ['@babel/preset-react', { runtime: 'automatic' }]],
      },
    })
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
  },
  build: {
    outDir: '../../../dist/ui',
    emptyOutDir: false,
    chunkSizeWarningLimit: 640,
    rollupOptions: {
      output: {
        manualChunks: {
          lodash: ['lodash'],
          ui: [
            'react', 'react-dom', '@tanstack/react-router',
            '@mantine/core', '@mantine/hooks',
            'polished', 'framer-motion'
          ]
        },
        assetFileNames: 'assets/[ext]/[name]-[hash][extname]'
      },
      onwarn: (warning, handler) => {
        if (['SOURCEMAP_ERROR', 'INVALID_ANNOTATION'].includes(warning.code ?? '')) {
          return;
        }

        handler(warning);
      }
    }
  }
});

import { defineConfig } from "vite";
import mkcert from 'vite-plugin-mkcert';
import react from "@vitejs/plugin-react";
import { tanstackRouter  } from '@tanstack/router-plugin/vite';
import babel from '@rolldown/plugin-babel';
import { version } from './package.json';

const matchPkg = (...names: string[]) => (id: string) => names.some(n => id.includes(`/node_modules/${n}/`) || id.includes(`\\node_modules\\${n}\\`));

export default defineConfig({
  root: './src',
  publicDir: '../public',
  define: {
    __UI_VERSION__: `${JSON.stringify(version)}`
  },
  resolve: {
    tsconfigPaths: true
  },
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
    tanstackRouter({
      target: 'react',
      virtualRouteConfig: './pages/routes.ts',
      routesDirectory: './pages',
      generatedRouteTree: './pages/routeTree.gen.ts'
    }),
    react(),
    babel({
      presets: [
        ['@babel/preset-react', { runtime: 'automatic' }]
      ],
      plugins: [
        ["@babel/plugin-transform-typescript", { allowDeclareFields: true }],
        ["@babel/plugin-proposal-decorators", { version: "legacy" }],
        ["@babel/plugin-transform-class-properties", {}],
        ["@babel/plugin-transform-private-methods", {}]
      ]
    })
  ],
  css: {
    modules: {
      localsConvention: 'camelCase'
    }
  },
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
      },
      '/streams': 'http://localhost:3001'
    }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: false,
    chunkSizeWarningLimit: 640,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'lodash', test: matchPkg('lodash'), priority: 10 },
            { name: 'react', test: matchPkg('react', 'react-dom', 'polished', 'motion'), priority: 10 },
            { name: 'react_misc', test: matchPkg('overlayscrollbars', 'overlayscrollbars-react', '@tabler/icons-react'), priority: 10 },
            { name: 'tanstack', test: matchPkg('@tanstack/react-router', '@tanstack/react-form', '@tanstack/react-router-devtools', '@tanstack/virtual-file-routes'), priority: 10 },
            { name: 'mantine', test: matchPkg('@mantine/core', '@mantine/hooks', '@mantine/carousel', '@mantine/notifications', 'mantine-contextmenu'), priority: 10 },
            { name: 'rtc', test: matchPkg('mediasoup-client', 'notepack.io', 'opus-decoder'), priority: 10 },
            { name: 'socket', test: matchPkg('socket.io-client', 'socket.io-msgpack-parser'), priority: 10 },
            { name: 'utils', test: matchPkg('@seamless-medley/utils'), priority: 10 },
          ]
        },
        assetFileNames: 'assets/[ext]/[name]-[hash][extname]',
        chunkFileNames: 'js/[name]-[hash].js'
      },
    }
  }
});

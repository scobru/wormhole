import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  server: {
    fs: {
      allow: [projectRoot],
    },
  },
  optimizeDeps: {
    exclude: [],
  },
  resolve: {
    alias: {
      '@wormhole/core': fileURLToPath(new URL('./src/core-proxy.js', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});


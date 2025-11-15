import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(new URL(".", import.meta.url)));
const projectRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  server: {
    fs: {
      allow: [projectRoot],
    },
  },
  optimizeDeps: {
    // Prevent Vite from trying to prebundle these assets from shogun-onion
    exclude: [
      'shogun-onion',
      'shogun-onion/onion.css',
      'shogun-onion/onionring-widget.js',
    ],
  },
  resolve: {
    alias: {
      "@wormhole/core": fileURLToPath(new URL("./src/core-proxy.js", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});


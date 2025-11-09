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


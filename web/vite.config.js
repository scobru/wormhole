import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

function stubNodeModules() {
  const nodeBuiltins = [
    'fs',
    'path',
    'child_process',
    'url',
    'os',
    'node:fs',
    'node:path',
    'node:url',
    'node:fs/promises',
    'node:child_process',
  ];
  return {
    name: 'stub-node-modules',
    enforce: 'pre',
    resolveId(id) {
      const cleanId = id.replace(/\\/g, '/');
      if (cleanId.includes('lib/service.js') || cleanId.includes('lib/xdg.js')) {
        return '\0zen-service-stub';
      }
      if (nodeBuiltins.includes(cleanId) || nodeBuiltins.includes(id)) {
        return '\0node-stub';
      }
    },
    load(id) {
      if (id === '\0zen-service-stub' || id === '\0node-stub') {
        return 'export default {}; export const fileURLToPath = () => ""; export const dirname = () => "";';
      }
    },
  };
}

export default defineConfig({
  plugins: [stubNodeModules()],
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

import { crx } from '@crxjs/vite-plugin';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import manifest from './manifest.json' with { type: 'json' };

export default defineConfig({
  plugins: [preact(), crx({ manifest: manifest as never })],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions: { input: { offscreen: 'src/offscreen/offscreen.html' } },
  },
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
});

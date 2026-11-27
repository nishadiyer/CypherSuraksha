import { crx } from '@crxjs/vite-plugin';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import manifest from './manifest.json' with { type: 'json' };

// `AISHIELD_DEMO=1` builds the demo variant (dist-demo), which only differs by its name. http://localhost is now in the main manifest too,
// so the local demo page (demo/, http://localhost:4186) works with either build.
const demo = process.env.AISHIELD_DEMO === '1';
const m = JSON.parse(JSON.stringify(manifest)) as { name: string; content_scripts: Array<{ js: string[]; matches: string[] }>; host_permissions: string[] };
if (demo) m.name += ' (DEMO build)';

export default defineConfig({
  plugins: [preact(), crx({ manifest: m as never })],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions: { input: { offscreen: 'src/offscreen/offscreen.html' } },
  },
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
});

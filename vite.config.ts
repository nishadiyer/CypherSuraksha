import { crx } from '@crxjs/vite-plugin';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import manifest from './manifest.json' with { type: 'json' };

// `AISHIELD_DEMO=1` builds a separate DEMO extension (dist-demo) that also runs on http://localhost so the local demo page can
// be used. The shipping extension never gets this permission.
const demo = process.env.AISHIELD_DEMO === '1';
const m = JSON.parse(JSON.stringify(manifest)) as { name: string; content_scripts: Array<{ js: string[]; matches: string[] }>; host_permissions: string[] };
if (demo) {
  m.name += ' (DEMO build)';
  m.content_scripts.find((c) => c.js.some((j) => j.includes('video.ts')))!.matches.push('http://localhost/*');
  m.host_permissions.push('http://localhost/*');
}

export default defineConfig({
  plugins: [preact(), crx({ manifest: m as never })],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions: { input: { offscreen: 'src/offscreen/offscreen.html' } },
  },
  server: { port: 5173, strictPort: true, hmr: { port: 5173 } },
});

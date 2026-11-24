// Zips dist/ into a Chrome Web Store upload and checks it against the store's size limit.
import { existsSync, statSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const LIMIT = 2 * 1024 ** 3; // Chrome Web Store package limit: 2 GB
const root = new URL('../', import.meta.url).pathname;
const fail = (m) => { console.error('PACKAGE FAIL:', m); process.exit(1); };

if (!existsSync(root + 'dist/manifest.json')) fail('dist/manifest.json missing; run npm run build first');
if (!existsSync(root + 'PRIVACY.md') || statSync(root + 'PRIVACY.md').size === 0) fail('PRIVACY.md missing');

const { version } = JSON.parse(readFileSync(root + 'dist/manifest.json', 'utf8'));
mkdirSync(root + 'release', { recursive: true });
const out = `${root}release/cypher-suraksha-${version}.zip`;
rmSync(out, { force: true });
// -X: no extra file attributes; exclude Vite's internal build manifest.
execFileSync('zip', ['-r', '-q', '-X', out, '.', '-x', '.vite/*', '*.DS_Store'], { cwd: root + 'dist' });

const size = statSync(out).size;
if (size >= LIMIT) fail(`zip is ${size} bytes, over the ${LIMIT} limit`);
console.log(`PACKAGE OK: ${out} (${(size / 1024 ** 2).toFixed(1)} MB < 2048 MB); privacy policy: PRIVACY.md`);

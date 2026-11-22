// Final audit: type check, console leaks, dispose wiring, zero-network and storage invariants, bundle manifest.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
let failed = 0;
const check = (name, ok, detail = '') => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '\n      ' + detail.split('\n').join('\n      ') : ''}\n`);
  if (!ok) failed++;
};

const walk = (dir, out = []) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};
const src = walk(join(root, 'src')).filter((f) => /\.(ts|tsx)$/.test(f));
const read = (f) => readFileSync(f, 'utf8');
const rel = (f) => relative(root, f);
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const grep = (re, files = src) =>
  files.flatMap((f) => stripComments(read(f)).split('\n').map((l, i) => [f, i + 1, l]).filter(([, , l]) => re.test(l)).map(([f, i, l]) => `${rel(f)}:${i}: ${l.trim()}`));

// 1. TypeScript
try {
  execFileSync('npx', ['tsc', '--noEmit'], { cwd: root, stdio: 'pipe' });
  check('tsc --noEmit is clean', true);
} catch (e) {
  check('tsc --noEmit is clean', false, String(e.stdout ?? e));
}

// 2. console leaks (source and shipped bundles; the vendored ORT chunk is excluded)
const c = grep(/\bconsole\s*\./);
check('no console.* calls in src (no payload can be logged)', c.length === 0, c.join('\n'));
const dist = join(root, 'dist');
check('dist/ exists (run `npm run build` first)', existsSync(dist));
if (existsSync(dist)) {
  const ours = walk(join(dist, 'assets')).filter((f) => f.endsWith('.js') && !/ort\.bundle|ort\./.test(f));
  const leaks = ours.filter((f) => /console\.(log|info|debug|warn)\(/.test(read(f)));
  check('no console.log/info/debug/warn in built extension bundles', leaks.length === 0, leaks.map(rel).join('\n'));
}

// 3. dispose wiring
const tensorFiles = src.filter((f) => /new ort\.Tensor\(/.test(read(f)));
for (const f of tensorFiles) {
  const s = read(f);
  const made = (s.match(/new ort\.Tensor\(/g) ?? []).length;
  const disposed = (s.match(/\.dispose\(\)|\.forEach\(\(t\) => t\.dispose\(\)\)/g) ?? []).length;
  const inFinally = /finally\s*\{[\s\S]*dispose\(\)/.test(s);
  check(`${rel(f)}: every ORT tensor disposed in a finally block (${made} created)`, disposed >= 1 && inFinally);
  check(`${rel(f)}: input buffers zero-filled`, /zero\(/.test(s));
  check(`${rel(f)}: model outputs disposed`, /outputs\)\.forEach\(\(t\) => t\.dispose\(\)\)/.test(s));
}
for (const f of ['privacyShield', 'pixelShield', 'peopleShield']) {
  check(`${f} implements dispose()`, /dispose[:(]/.test(read(join(root, `src/offscreen/shields/${f}.ts`))));
}
check('ORT sessions released (session.release) in disposeModels', /session\.release\(\)/.test(read(join(root, 'src/offscreen/ort.ts'))));
const main = read(join(root, 'src/offscreen/main.ts'));
check('offscreen disposeAll wired to pagehide and OFFSCREEN_DISPOSE', /pagehide/.test(main) && /OFFSCREEN_DISPOSE/.test(main));
const reg = read(join(root, 'src/offscreen/registry.ts'));
check('worker shields dispose then terminate their worker', /type: 'dispose'/.test(reg) && /terminate\(\)/.test(reg));
check('worker host forwards dispose to the shield', /m\.type === 'dispose'/.test(read(join(root, 'src/offscreen/workers/workerHost.ts'))));
check('video frames / image canvases are released (ImageBitmap.close, canvas size 0)', /bitmap\?\.close\(\)/.test(read(join(root, 'src/offscreen/shields/pixelShield.ts'))) && /canvas\.width = canvas\.height = 0/.test(read(join(root, 'src/content/interceptors/videoInterceptor.ts'))));

// 4. zero network (our code)
const net = grep(/\b(XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b/);
check('no XHR / WebSocket / EventSource / sendBeacon / importScripts in src', net.length === 0, net.join('\n'));
const fetches = grep(/\bfetch\s*\(/);
check('the only fetch() reads packaged model files', fetches.length === 1 && /ort\.ts/.test(fetches[0]) && /baseUrl/.test(fetches[0]), fetches.join('\n'));
const urls = grep(/https?:\/\/[A-Za-z0-9]/);
check('no hard-coded remote URLs in src', urls.length === 0, urls.join('\n'));

// 5. storage invariants
const web = grep(/\b(localStorage|sessionStorage|indexedDB|caches\.open)\b/);
check('no localStorage / sessionStorage / IndexedDB / Cache API in src', web.length === 0, web.join('\n'));
const localWriters = grep(/storage\.local\.(set|remove)/).map((l) => l.split(':')[0]);
const okWriters = new Set(['src/shared/settings.ts', 'src/background/ledger.ts', 'src/popup/store.ts']);
check('chrome.storage.local written only by settings, ledger and vault code', localWriters.every((f) => okWriters.has(f)), [...new Set(localWriters)].join('\n'));
const sess = [...new Set(grep(/storage\.session/).map((l) => l.split(':')[0]))];
check('chrome.storage.session used only by background/sessionStore.ts', sess.length === 1 && sess[0] === 'src/background/sessionStore.ts', sess.join('\n'));
const vault = read(join(root, 'src/shared/vault.ts'));
check('vault hashes with SHA-256 via Web Crypto and a random salt', /crypto\.subtle\.digest\('SHA-256'/.test(vault) && /getRandomValues/.test(vault));
check('UI isolation: every injected UI uses a closed shadow root', /mode: 'closed'/.test(read(join(root, 'src/content/ui/shadowHost.ts'))) && grep(/attachShadow/).length === 1);

// 6. built manifest
if (existsSync(dist)) {
  try {
    execFileSync('node', ['scripts/verify-build.mjs'], { cwd: root, stdio: 'pipe' });
    check('built manifest: CSP connect-src none, minimal permissions', true);
  } catch (e) {
    check('built manifest: CSP connect-src none, minimal permissions', false, String(e.stderr ?? e));
  }
  const m = JSON.parse(read(join(dist, 'manifest.json')));
  check('permissions are exactly offscreen, storage, activeTab, scripting', JSON.stringify([...m.permissions].sort()) === JSON.stringify(['activeTab', 'offscreen', 'scripting', 'storage']));
}

console.log(failed ? `\n${failed} audit check(s) FAILED` : '\nFinal audit passed');
process.exit(failed ? 1 : 0);

// Copies the three demo pictures from the evaluation fixtures into demo/media/ (git-ignored: third-party images).
// Needs the fixtures first: `npm run fixtures`.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url).pathname;
const ex = JSON.parse(readFileSync(`${root}demo/examples.json`, 'utf8'));
const src = `${root}tests/fixtures/deepfake/`;
mkdirSync(`${root}demo/media`, { recursive: true });
let missing = 0;
for (const kind of ['real', 'ai', 'swap']) {
  const from = src + ex[kind];
  if (!existsSync(from)) { console.error(`missing ${from}. Run: npm run fixtures`); missing++; continue; }
  copyFileSync(from, `${root}demo/media/${kind}.jpg`);
  console.log(`demo/media/${kind}.jpg <- ${ex[kind]}`);
}
process.exit(missing ? 1 : 0);

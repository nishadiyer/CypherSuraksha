// Renders the toolbar icons (16/32/48/128 px, transparent) from src/assets/logo.svg with headless Chrome.
// Run after changing the logo:  npm run icons     (needs Google Chrome; set CHROME_PATH if it is not in the macOS default location)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const root = new URL('..', import.meta.url).pathname;
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const svg = readFileSync(root + 'src/assets/logo.svg', 'utf8');
mkdirSync(root + 'src/assets/icons', { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    writeFileSync(`${root}src/assets/icons/icon${size}.png`, png);
    console.log(`icon${size}.png`);
  }
} finally {
  await browser.close();
}

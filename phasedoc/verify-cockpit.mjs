// Walks every cockpit tab headless: zero console errors, and Architecture colours must match task state.
import puppeteer from 'puppeteer-core';
const URL = process.env.COCKPIT ?? 'http://127.0.0.1:4200/';
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 20000 });
const p = await b.newPage(); const errs = [];
p.on('console', (m) => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', (e) => errs.push(e.message));
await p.goto(URL, { waitUntil: 'networkidle0' });
let bad = 0; const ck = (n, ok, d = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : ' — ' + d}`); if (!ok) bad++; };
const tabs = await p.$$eval('#tabs button', (bs) => bs.map((x) => x.textContent));
ck('5 tabs present', tabs.join() === 'Plan,Architecture,Progress,Analytics,Resources', tabs.join());
for (const t of tabs) {
  await p.evaluate((t) => [...document.querySelectorAll('#tabs button')].find((b) => b.textContent === t).click(), t);
  const n = await p.evaluate(() => document.querySelector('section.on').innerText.length);
  ck(`${t} tab renders content`, n > 50, String(n));
}
await p.evaluate(() => [...document.querySelectorAll('#tabs button')][0].click());
const leaves = await p.$$eval('.leaf', (x) => x.length);
ck('Plan shows 45 leaves', leaves === 45, String(leaves));
const phaseCards = await p.$$eval('.card h3', (x) => x.filter((h) => /^P\d /.test(h.textContent)).length);
ck('6 phase cards with counts', phaseCards === 6, String(phaseCards));
const api = await (await fetch(URL + 'api/arch')).json();
await p.evaluate(() => [...document.querySelectorAll('#tabs button')][1].click());
const fills = await p.$$eval('svg [id^="comp-"]', (els) => Object.fromEntries(els.map((e) => [e.id.slice(5), e.getAttribute('data-state')])));
const want = Object.fromEntries(Object.entries(api.states).map(([k, v]) => [k, v.state]));
ck('every architecture box state matches the task rollup', JSON.stringify(fills, Object.keys(fills).sort()) === JSON.stringify(want, Object.keys(want).sort()), JSON.stringify({ fills, want }));
const colours = await p.$$eval('svg [id^="comp-"]', (els) => els.map((e) => e.getAttribute('fill')));
ck('boxes use grey/amber/green fills (not all one colour)', new Set(colours).size >= 3, [...new Set(colours)].join());
console.log('  states:', JSON.stringify(fills));
ck('zero JavaScript console errors', errs.length === 0, errs.join(' | '));
await b.close(); process.exit(bad ? 1 : 0);

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { check, DIST, launch } from './harness.mjs';

const SRC = new URL('../../public/models/', import.meta.url).pathname;
const FILES = ['privacy-ner.int8.onnx', 'privacy-ner.vocab.txt', 'privacy-ner.config.json'];
const fixture = JSON.parse(readFileSync(new URL('../fixtures/ner-recall.json', import.meta.url), 'utf8'));
const THRESHOLD = 0.85;

async function score(withModel) {
  const dir = `${DIST}/models`;
  rmSync(dir, { recursive: true, force: true });
  if (withModel) {
    mkdirSync(dir, { recursive: true });
    for (const f of FILES) copyFileSync(SRC + f, `${dir}/${f}`);
  }
  const ctx = await launch();
  try {
    const infer = (request) => ctx.sw.evaluate(async (request) => {
      if (!(await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length) {
        await chrome.offscreen.createDocument({ url: 'src/offscreen/offscreen.html', reasons: ['WORKERS'], justification: 'test' });
        await new Promise((r) => setTimeout(r, 500));
      }
      return chrome.runtime.sendMessage({ kind: 'OFFSCREEN_INFER', target: 'offscreen', request });
    }, request);
    const run = async (text, i) => infer({ requestId: `n${i}`, shield: 'PRIVACY', tabId: 1, domain: 'x', payload: { text, existingMap: {}, vault: { salt: '', hashes: [] } } });

    let total = 0, hit = 0, modes = new Set(), lat = [];
    const byType = {}, missed = [];
    for (const [i, s] of fixture.sentences.entries()) {
      const r = await run(s.text, i);
      if (r.data?.mode) modes.add(r.data.mode);
      lat.push(r.latencyMs);
      const out = r.data?.redactedText ?? s.text;
      for (const [ent, type] of s.entities) {
        total++; byType[type] ??= [0, 0]; byType[type][1]++;
        if (!out.includes(ent)) { hit++; byType[type][0]++; } else missed.push(`${type} "${ent}"`);
      }
    }
    let falsePos = 0; const flagged = [];
    for (const [i, t] of fixture.negatives.entries()) {
      const r = await run(t, 100 + i);
      if (r.action === 'MODIFY') { falsePos++; flagged.push(`"${t}" -> "${r.data?.redactedText}"`); }
    }
    lat.sort((a, b) => a - b);
    return { recall: hit / total, hit, total, byType, missed, modes: [...modes], falsePos, flagged, medianMs: lat[lat.length >> 1] };
  } finally {
    await ctx.cleanup();
    rmSync(`${DIST}/models`, { recursive: true, force: true });
  }
}

export default async function gateNer() {
  console.log('Real NER model — 20-sentence labelled fixture, entity recall (PERSON/ORG/LOC), real onnxruntime-web, offline');
  if (!FILES.every((f) => existsSync(SRC + f))) {
    check('real NER model files present in public/models (run: node scripts/fetch-models.mjs)', false);
    return;
  }
  const fmt = (r) => `${(r.recall * 100).toFixed(0)}% (${r.hit}/${r.total}) ` + Object.entries(r.byType).map(([t, [h, n]]) => `${t} ${h}/${n}`).join(', ');
  const base = await score(false);
  console.log(`  info  fallback only (no model): recall ${fmt(base)}; modes ${base.modes}`);
  const real = await score(true);
  console.log(`  info  real model: recall ${fmt(real)}; modes ${real.modes}; median ${real.medianMs.toFixed(0)} ms/prompt`);
  if (real.missed.length) console.log(`  info  missed with model: ${real.missed.join('; ')}`);
  if (real.flagged.length) console.log(`  info  flagged: ${real.flagged.join('; ')}`);
  console.log(`  info  false-positive redactions on ${fixture.negatives.length} entity-free prompts: ${real.falsePos}`);
  check('model actually ran (mode onnx-*)', real.modes.every((m) => /^onnx-(wasm|webgpu)$/.test(m)), real.modes.join());
  check(`entity recall with real model >= ${THRESHOLD}`, real.recall >= THRESHOLD, fmt(real));
  check('real model beats the fallback', real.recall > base.recall, `${fmt(real)} vs ${fmt(base)}`);
  // False positives are reported, not asserted: 4 prompts is too few to set a threshold without tuning to them.
}

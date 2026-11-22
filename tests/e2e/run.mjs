import { rmSync } from 'node:fs';
import { DIST, failureCount, launch } from './harness.mjs';
import gate12 from './gate12.mjs';
import gate3 from './gate3.mjs';
import gate4 from './gate4.mjs';
import gate5 from './gate5.mjs';
import gate6 from './gate6.mjs';
import gateNer from './gateNer.mjs';
import gateOnnx from './gateOnnx.mjs';

// Hard stop so a hung browser can never stall a run again.
setTimeout(() => { console.error('e2e watchdog: exceeded time limit'); process.exit(2); }, Number(process.env.E2E_TIMEOUT_MS ?? 240000)).unref();

const only = process.argv[2];
// Gates must be hermetic: public/models may hold real weights, so start from an empty dist/models.
rmSync(`${DIST}/models`, { recursive: true, force: true });
const gates = { 12: gate12, 3: gate3, 5: gate5, 6: gate6 };
if (only === 'onnx') await gateOnnx();
else if (only === 'ner') await gateNer();
else if (only === '4') await gate4();
else {
  const ctx = await launch();
  try {
    for (const [id, fn] of Object.entries(gates)) if (!only || only === id) await fn(ctx);
  } finally {
    await ctx.cleanup();
  }
  if (!only) {
    await gateOnnx();
    await gateNer();
    await gate4();
  }
}
console.log(failureCount() ? `\n${failureCount()} check(s) FAILED` : '\nAll e2e checks passed');
process.exit(failureCount() ? 1 : 0);

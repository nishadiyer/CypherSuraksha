// Generates simple shield icons (no external assets) into src/assets/icons/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname;
mkdirSync(root + 'src/assets/icons', { recursive: true });

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const S = 4; // supersampling for smooth edges
  const inShield = (x, y) => { // x,y in 0..1
    if (y < 0.08 || y > 0.95) return false;
    const half = y < 0.55 ? 0.38 : 0.38 * Math.max(0, 1 - (y - 0.55) / 0.40) ** 0.8;
    return Math.abs(x - 0.5) <= half;
  };
  const inCheck = (x, y) => {
    const d = (ax, ay, bx, by) => { const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2))); return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))); };
    return Math.min(d(0.33, 0.50, 0.45, 0.63), d(0.45, 0.63, 0.68, 0.36)) < 0.045;
  };
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let a = 0, chk = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const x = (px + (sx + 0.5) / S) / size, y = (py + (sy + 0.5) / S) / size;
        if (inShield(x, y)) { a++; if (inCheck(x, y)) chk++; }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4, n = S * S, f = chk / Math.max(1, a);
      raw[o] = Math.round(5 + 250 * f); raw[o + 1] = Math.round(120 + 135 * f); raw[o + 2] = Math.round(80 + 175 * f); raw[o + 3] = Math.round((255 * a) / n);
    }
  }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [16, 32, 48, 128]) writeFileSync(`${root}src/assets/icons/icon${s}.png`, png(s));
console.log('icons written');

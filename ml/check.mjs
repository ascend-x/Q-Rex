import fs from 'node:fs';
import { getNet } from '../src/engine/ai.js';
const ref = JSON.parse(fs.readFileSync(new URL('./check.json', import.meta.url)));
const net = getNet();
let worst = 0;
ref.patches.forEach((p, i) => {
  const o = net.infer(Float32Array.from(p));
  const r = ref.out[i];
  worst = Math.max(worst, Math.abs(o.p - r[0]), Math.abs(o.dx - r[1]), Math.abs(o.dy - r[2]));
});
console.log('max |JS - PyTorch| over', ref.patches.length, 'patches:', worst.toExponential(2));
process.exit(worst < 1e-3 ? 0 : 1);

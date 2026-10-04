// Is "jitter ±20 px/frame + platform ±20 px/frame" reachable at <= 10 px? Open-loop lower-bound experiment.
// A causal Kalman filter (polynomial models of order 1-4, process noise swept) estimates s = target - platform from the
// jitter-corrupted measurement z = s - jitter, using the REAL simulator sequences. We report
//   (a) the filtering error at the current frame, and
//   (b) the ONE-FRAME-AHEAD PREDICTION error - what a camera that is commanded after frame k and exposes frame k+1 must live with.
// usage: node scripts/floor-analysis.mjs
import { Simulation } from '../src/engine/simulation.js';

const series = [];
for (const seed of [1, 2, 3]) {
  const sim = new Simulation({ platform: true, platformSpeed: 20, jitter: true, jitterMax: 20, targetSpeed: 120, seed, motion: 'circular' });
  sim.run(30);
  series.push(sim.records.slice(30).map((r) => ({ sx: r.worldX - r.platX, sy: r.worldY - r.platY, zx: r.worldX - r.platX - r.jitX, zy: r.worldY - r.platY - r.jitY })));
}
const dt = 1 / 30, R = 64; // jitter sigma ~ 8 px
const fact = (k) => (k <= 1 ? 1 : k * fact(k - 1));
const Fm = (o) => Array.from({ length: o + 1 }, (_, i) => Array.from({ length: o + 1 }, (_, j) => (j >= i ? dt ** (j - i) / fact(j - i) : 0)));
const Qm = (o, q) => Array.from({ length: o + 1 }, (_, i) => Array.from({ length: o + 1 }, (_, j) => { const a = o - i, b = o - j; return (q * dt ** (a + b + 1)) / ((a + b + 1) * fact(a) * fact(b)); }));
const mul = (A, B) => A.map((r, i) => B[0].map((_, j) => r.reduce((s, _, k) => s + A[i][k] * B[k][j], 0)));
const tr = (A) => A[0].map((_, j) => A.map((r) => r[j]));
const add = (A, B) => A.map((r, i) => r.map((v, j) => v + B[i][j]));

function run(order, q, key, predict) {
  let err = 0, n = 0;
  const A = Fm(order), At = tr(A), Q = Qm(order, q);
  for (const s of series) {
    let x = new Array(order + 1).fill(0); x[0] = s[0]['z' + key];
    let P = Array.from({ length: order + 1 }, (_, i) => Array.from({ length: order + 1 }, (_, j) => (i === j ? (i === 0 ? 100 : 1e4 * 10 ** i) : 0)));
    for (let k = 0; k < s.length; k++) {
      x = A.map((r) => r.reduce((a, v, j) => a + v * x[j], 0)); P = add(mul(mul(A, P), At), Q);
      const S = P[0][0] + R, K = P.map((r) => r[0] / S), nu = s[k]['z' + key] - x[0];
      x = x.map((v, i) => v + K[i] * nu); P = P.map((r, i) => r.map((v, j) => v - K[i] * P[0][j]));
      if (k > 60 && k + 1 < s.length) {
        const xp = predict ? A.map((r) => r.reduce((a, v, j) => a + v * x[j], 0)) : x;
        const e = xp[0] - s[k + (predict ? 1 : 0)]['s' + key]; err += e * e; n++;
      }
    }
  }
  return Math.sqrt(err / n);
}
for (const predict of [false, true]) {
  console.log(predict ? '\nONE-FRAME-AHEAD PREDICTION (what the camera must hit)' : 'FILTERING at the current frame');
  for (const order of [1, 2, 3, 4]) {
    let best = [1e9, 0];
    for (let le = -2; le <= 14; le += 0.5) { const q = 10 ** le; const e = Math.sqrt((run(order, q, 'x', predict) ** 2 + run(order, q, 'y', predict) ** 2) / 2); if (e < best[0]) best = [e, q]; }
    console.log(`  order ${order}: best per-axis RMS ${best[0].toFixed(2)} px at q = ${best[1].toExponential(1)}  ->  mean 2-D error ≈ ${(best[0] * 1.2533).toFixed(1)} px`);
  }
}
let e2 = 0, n = 0; for (const s of series) for (const r of s) { e2 += (r.zx - r.sx) ** 2 + (r.zy - r.sy) ** 2; n += 2; }
console.log(`\nraw measurement (no filtering): per-axis RMS ${Math.sqrt(e2 / n).toFixed(2)} px -> mean 2-D ≈ ${(Math.sqrt(e2 / n) * 1.2533).toFixed(1)} px`);

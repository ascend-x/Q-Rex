// Synthetic training data for the learned beacon verifier / refiner.
// usage: node scripts/gen-dataset.mjs <outPrefix> <seedBase> <nFrames> [normal|hard|codec|wide|whard]
// Every sample is a PATCH x PATCH window taken exactly as the runtime does (after the detector's impulse filtering).
//   label[0] = 1 if a beacon centre lies within the window core, else 0
//   label[1..2] = (dx, dy) = beacon centre - patch centre, px (positives only)
// Positives: real classical-detector candidates on beacon frames + random-offset windows.
// Negatives: the detector's own false alarms on beacon-free frames (low threshold), rain-streak / noise windows, random windows.
import fs from 'node:fs';
import { RNG } from '../src/engine/rng.js';
import { SensorModel } from '../src/engine/render.js';
import { clampConfig, ATMOSPHERES } from '../src/engine/config.js';
import { Detector } from '../src/engine/detector.js';
import { PATCH, extractPatch } from '../src/engine/patch.js';
import { codecDegrade } from '../src/engine/codec.js';

const [prefix, seedBase = '1000', nFrames = '2000', mode = 'normal'] = process.argv.slice(2);
const rng = new RNG(Number(seedBase), 77);
const det = new Detector();
const X = [], Y = [];
const buf = new Float32Array(PATCH * PATCH);
const push = (src, w, h, cx, cy, bg, sigma, label, dx = 0, dy = 0) => {
  extractPatch(src, w, h, cx, cy, bg, sigma, buf);
  X.push(Float32Array.from(buf));
  Y.push([label, dx, dy]);
};

function randomConfig() {
  const hard = mode === 'hard' || mode === 'whard';
  const atms = Object.keys(ATMOSPHERES);
  const c = {
    targetSize: Math.round(rng.uniform(5, 20)),
    targetShape: ['square', 'square', 'circle', 'diamond'][Math.floor(rng.next() * 4)],
    targetIntensity: rng.uniform(hard ? 55 : 60, 255), // includes very faint beacons (low contrast after fog / low light)
    background: rng.uniform(8, 45),
    seed: Math.floor(rng.uniform(1, 1e9)),
    gaussian: hard || rng.next() < 0.6, gaussianSigma: hard ? rng.uniform(14, 20) : rng.uniform(0, 20),
    poisson: rng.next() < 0.4,
    saltPepper: rng.next() < 0.3, saltPepperDensity: rng.uniform(0.01, 0.1),
    atmosphere: hard ? ['fog', 'lowlight', 'haze'][Math.floor(rng.next() * 3)] : atms[Math.floor(rng.next() * atms.length)],
    atmosphereLevel: hard ? rng.uniform(0.7, 1) : rng.uniform(0.3, 1),
    turbulence: rng.next() < 0.4 ? rng.uniform(0, 1) : 0,
  };
  return clampConfig(c);
}

const W = 640, H = 480;
const uniq = (a) => [...new Set(a)].sort((x, y) => x - y);
for (let f = 0; f < Number(nFrames); f++) {
  const cfg = randomConfig();
  const sm = new SensorModel(cfg, new RNG(cfg.seed, 2));
  // lens zoom: ~45 % of frames are zoomed out up to full-screen coverage (beacon 1.2-20 px); 'wide' forces it
  const zoomOut = mode === 'wide' || mode === 'whard' || (mode !== 'codec' && rng.next() < 0.45);
  sm.fovNow = zoomOut ? rng.uniform(4.4, 16.7) : 4;
  const sc = (sm.fovNow * 160) / 640;
  const sizes = uniq([5, 7, 10, 14, 20].map((v) => Math.max(2, Math.round(v / sc))));
  const filt = sizes[0] <= 3 ? 'switching' : 'median'; // exactly what the tracker does
  // video compression artefacts on ~40 % of frames ('codec' forces them)
  const quality = mode === 'codec' || rng.next() < 0.4 ? rng.uniform(18, 85) : 0;
  const tx = rng.uniform(40, W - 40), ty = rng.uniform(40, H - 40);
  const tgt = [{ x: (tx - W / 2) * sc + 1000, y: (ty - H / 2) * sc + 1000, size: cfg.targetSize, intensity: cfg.targetIntensity, scint: 1 }];

  // --- beacon frame
  const truth = sm.renderNarrow({ cx: 1000, cy: 1000 }, tgt, cfg.turbulence)[0];
  if (quality) codecDegrade(sm.frame, W, H, quality);
  const r = det.detect(sm.frame, W, H, { sizes, threshold: 4.5, maxCands: 6, impulseFilter: filt });
  const L = det.last;
  for (const c of r.cands) {
    const d = Math.hypot(c.x - truth.x, c.y - truth.y);
    if (d < 4) push(L.src, W, H, c.x, c.y, L.bg, L.sigma, 1, truth.x - c.x, truth.y - c.y);
    else if (d > 14) push(L.src, W, H, c.x, c.y, L.bg, L.sigma, 0); // classical false alarm on a beacon frame
  }
  // random-offset positives (teach the regression its full range)
  for (let k = 0; k < 3; k++) {
    const ox = rng.uniform(-6, 6), oy = rng.uniform(-6, 6);
    push(L.src, W, H, truth.x + ox, truth.y + oy, L.bg, L.sigma, 1, -ox, -oy);
  }
  // random negatives away from the beacon
  for (let k = 0; k < 2; k++) {
    let x, y; do { x = rng.uniform(20, W - 20); y = rng.uniform(20, H - 20); } while (Math.hypot(x - truth.x, y - truth.y) < 28);
    push(L.src, W, H, x, y, L.bg, L.sigma, 0);
  }

  // --- beacon-free frame: the detector's false alarms are the hardest negatives
  const sm2 = new SensorModel(cfg, new RNG(cfg.seed + 7, 2));
  sm2.fovNow = sm.fovNow;
  sm2.renderNarrow({ cx: 1000, cy: 1000 }, [], cfg.turbulence);
  if (quality) codecDegrade(sm2.frame, W, H, quality);
  const r2 = det.detect(sm2.frame, W, H, { sizes, threshold: 4, maxCands: 8, impulseFilter: filt });
  const L2 = det.last;
  for (const c of r2.cands) push(L2.src, W, H, c.x, c.y, L2.bg, L2.sigma, 0);
  for (let k = 0; k < 2; k++) push(L2.src, W, H, rng.uniform(20, W - 20), rng.uniform(20, H - 20), L2.bg, L2.sigma, 0);
  if (f % 500 === 0) console.error(`${prefix}: frame ${f}, samples ${X.length}`);
}

const n = X.length;
const xb = new Float32Array(n * PATCH * PATCH);
X.forEach((p, i) => xb.set(p, i * PATCH * PATCH));
const yb = new Float32Array(n * 3);
Y.forEach((y, i) => yb.set(y, i * 3));
fs.writeFileSync(`${prefix}_x.f32`, Buffer.from(xb.buffer));
fs.writeFileSync(`${prefix}_y.f32`, Buffer.from(yb.buffer));
const pos = Y.filter((y) => y[0] === 1).length;
console.log(`${prefix}: ${n} samples (${pos} positive, ${n - pos} negative)`);

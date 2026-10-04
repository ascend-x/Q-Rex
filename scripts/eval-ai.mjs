// Honest evaluation of the learned verifier against the classical detector on fresh simulator frames.
// usage: node scripts/eval-ai.mjs [framesPerCondition=150]
import { RNG } from '../src/engine/rng.js';
import { SensorModel } from '../src/engine/render.js';
import { clampConfig } from '../src/engine/config.js';
import { Detector } from '../src/engine/detector.js';
import fs from 'node:fs';
import { PatchNet } from '../src/engine/cnn.js';
import { getNet } from '../src/engine/ai.js';
import { codecDegrade } from '../src/engine/codec.js';

const N = Number(process.argv[2] ?? 150);
const PMIN = Number(process.argv[3] ?? 0.5);
const FILTER = process.argv[4];
const net = process.env.WEIGHTS ? new PatchNet(JSON.parse(fs.readFileSync(process.env.WEIGHTS, 'utf8'))) : getNet();
const det = new Detector();
const W = 640, H = 480;

const CONDS = [
  ['clean', {}],
  ['gauss σ20', { gaussian: true, gaussianSigma: 20 }],
  ['s&p 10% + σ20', { saltPepper: true, gaussian: true, gaussianSigma: 20 }],
  ['fog + σ20', { atmosphere: 'fog', gaussian: true, gaussianSigma: 20 }],
  ['low light + poisson + σ12', { atmosphere: 'lowlight', poisson: true, gaussian: true, gaussianSigma: 12 }],
  ['rain + σ15 (streaks)', { atmosphere: 'rain', gaussian: true, gaussianSigma: 15 }],
  ['faint beacon (I=90) + σ15', { targetIntensity: 90, gaussian: true, gaussianSigma: 15 }],
  ['faint beacon (I=70) fog σ12', { targetIntensity: 70, atmosphere: 'fog', gaussian: true, gaussianSigma: 12 }],
  ['WIDE 12° σ20 (zoomed out)', { gaussian: true, gaussianSigma: 20 }, { zoom: 12 }],
  ['WIDE 16.7° low light + Poisson', { atmosphere: 'lowlight', poisson: true, gaussian: true, gaussianSigma: 10 }, { zoom: 16.7 }],
  ['WIDE 16.7° s&p 10% + σ12', { saltPepper: true, gaussian: true, gaussianSigma: 12 }, { zoom: 16.7 }],
  ['CODEC q25 + σ12', { gaussian: true, gaussianSigma: 12 }, { codec: 25 }],
  ['CODEC q25 s&p 10% + σ15', { saltPepper: true, gaussian: true, gaussianSigma: 15 }, { codec: 25 }],
  ['CODEC q20 rain σ12', { atmosphere: 'rain', gaussian: true, gaussianSigma: 12 }, { codec: 20 }],
  ['CODEC q30 faint I=90 σ12', { targetIntensity: 90, gaussian: true, gaussianSigma: 12 }, { codec: 30 }],
];

const rows = [];
for (const [name, extra, mods = {}] of CONDS) {
  if (FILTER && !name.includes(FILTER)) continue;
  const fov = mods.zoom ?? 4, sc = (fov * 160) / 640;
  const sizes = [...new Set([5, 7, 10, 14, 20].map((v) => Math.max(2, Math.round(v / sc))))].sort((a, b) => a - b);
  const filt = sizes[0] <= 3 ? 'switching' : 'median';
  const rng = new RNG(4242, 9);
  const stat = { classical: { hit: 0, wrong: 0, miss: 0, fa: 0, se: 0, ne: 0 }, low: { hit: 0, wrong: 0, miss: 0, fa: 0 }, ai: { hit: 0, wrong: 0, miss: 0, fa: 0, se: 0, ne: 0 }, six: { hit: 0, wrong: 0, miss: 0, fa: 0, se: 0, ne: 0 }, aiRef: { se: 0, ne: 0 } };
  let msAI = 0, nAI = 0;
  for (let f = 0; f < N; f++) {
    const cfg = clampConfig({ targetSize: Math.round(rng.uniform(5, 20)), seed: 100000 + f, ...extra });
    const sm = new SensorModel(cfg, new RNG(cfg.seed, 2));
    sm.fovNow = fov;
    const tx = rng.uniform(60, W - 60), ty = rng.uniform(60, H - 60);
    const tgt = [{ x: (tx - W / 2) * sc + 1000, y: (ty - H / 2) * sc + 1000, size: cfg.targetSize, intensity: cfg.targetIntensity, scint: 1 }];
    const truth = sm.renderNarrow({ cx: 1000, cy: 1000 }, tgt, 0)[0];
    if (mods.codec) codecDegrade(sm.frame, W, H, mods.codec);
    const score = (cands, st, withAI) => {
      let list = cands;
      if (withAI) {
        const t0 = performance.now();
        list = [];
        for (const c of cands.slice(0, 8)) { const o = net.evaluate(det.last, c.x, c.y); c.p = o.p; c.dx = o.dx; c.dy = o.dy; if (o.p >= PMIN) list.push(c); }
        // veto only: keep the classical SNR order (same as the tracker)
        msAI += performance.now() - t0; nAI++;
      }
      const best = list[0];
      if (!best) { st.miss++; return null; }
      const e = Math.hypot(best.x - truth.x, best.y - truth.y);
      if (e < 3) { st.hit++; if (st.se !== undefined) { st.se += e * e; st.ne++; } return best; }
      st.wrong++; return null;
    };
    // classical @ threshold 6 (deployed) ; classical @ 4.5 (sensitive) ; sensitive + AI gate
    let r = det.detect(sm.frame, W, H, { sizes, threshold: 6, maxCands: 6, impulseFilter: filt });
    score(r.cands, stat.classical, false);
    score(r.cands.map((c) => ({ ...c })), stat.six, true);
    r = det.detect(sm.frame, W, H, { sizes, threshold: 4.5, maxCands: 8, impulseFilter: filt });
    const c45 = r.cands.map((c) => ({ ...c }));
    score(c45, stat.low, false);
    const best = score(c45.map((c) => ({ ...c })), stat.ai, true);
    if (best) { const rx = best.x + best.dx, ry = best.y + best.dy; const e = Math.hypot(rx - truth.x, ry - truth.y); if (Math.hypot(best.x - truth.x, best.y - truth.y) < 3) { stat.aiRef.se += e * e; stat.aiRef.ne++; } }
    // beacon-free frame: false alarms
    const sm2 = new SensorModel(cfg, new RNG(cfg.seed + 1, 2));
    sm2.fovNow = fov;
    sm2.renderNarrow({ cx: 1000, cy: 1000 }, [], 0);
    if (mods.codec) codecDegrade(sm2.frame, W, H, mods.codec);
    r = det.detect(sm2.frame, W, H, { sizes, threshold: 6, maxCands: 6, impulseFilter: filt }); if (r.cands.length) stat.classical.fa++;
    if (r.cands.slice(0, 8).filter((c) => net.evaluate(det.last, c.x, c.y).p >= PMIN).length) stat.six.fa++;
    r = det.detect(sm2.frame, W, H, { sizes, threshold: 4.5, maxCands: 8, impulseFilter: filt }); if (r.cands.length) stat.low.fa++;
    const lst = r.cands.slice(0, 8).filter((c) => net.evaluate(det.last, c.x, c.y).p >= PMIN); if (lst.length) stat.ai.fa++;
  }
  const pct = (v) => (100 * v / N).toFixed(0).padStart(3) + '%';
  const rm = (s) => (s.ne ? Math.sqrt(s.se / s.ne).toFixed(2) : '–');
  rows.push({ name, ...stat, ms: nAI ? msAI / nAI : 0 });
  console.log(`${name.padEnd(30)} | T=6: hit ${pct(stat.classical.hit)} FA ${pct(stat.classical.fa)} | T=6+CNN: hit ${pct(stat.six.hit)} FA ${pct(stat.six.fa)} | T=4.5: hit ${pct(stat.low.hit)} FA ${pct(stat.low.fa)} | T=4.5+CNN: hit ${pct(stat.ai.hit)} FA ${pct(stat.ai.fa)} | centroid px: classical ${rm(stat.classical)} · CNN-gated ${rm(stat.ai)} · +offset ${rm(stat.aiRef)} | CNN ${ (nAI ? msAI / nAI : 0).toFixed(2)} ms/frame`);
}

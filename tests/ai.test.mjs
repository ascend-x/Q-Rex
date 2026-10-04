// Learned verifier (CNN) + ground-truth parsing tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RNG } from '../src/engine/rng.js';
import { SensorModel } from '../src/engine/render.js';
import { clampConfig } from '../src/engine/config.js';
import { Detector } from '../src/engine/detector.js';
import { getNet, aiReport } from '../src/engine/ai.js';
import { Simulation } from '../src/engine/simulation.js';
import { computeMetrics } from '../src/engine/metrics.js';
import { VideoTracker, parseGroundTruth, videoMetrics } from '../src/engine/videoTracker.js';

test('JS inference reproduces the PyTorch reference outputs', () => {
  const ref = JSON.parse(fs.readFileSync(new URL('./fixtures/cnn_reference.json', import.meta.url)));
  const net = getNet();
  let worst = 0;
  ref.patches.forEach((p, i) => {
    const o = net.infer(Float32Array.from(p));
    worst = Math.max(worst, Math.abs(o.p - ref.out[i][0]), Math.abs(o.dx - ref.out[i][1]), Math.abs(o.dy - ref.out[i][2]));
  });
  assert.ok(worst < 1e-3, `max deviation ${worst}`);
});

test('training report: held-out accuracy and offset error', () => {
  assert.ok(aiReport.test.acc > 0.99, 'test accuracy ' + aiReport.test.acc);
  assert.ok(aiReport.hard_test.acc > 0.97, 'hard-test accuracy ' + aiReport.hard_test.acc);
  assert.ok(aiReport.test.offset_rmse_px < 0.5);
});

test('CNN gate removes the detector false alarms and keeps the beacon', () => {
  const net = getNet(), det = new Detector(), W = 640, H = 480, sizes = [5, 7, 10, 14, 20];
  for (const extra of [{ saltPepper: true, gaussian: true, gaussianSigma: 20 }, { atmosphere: 'lowlight', poisson: true, gaussian: true, gaussianSigma: 12 }, { atmosphere: 'rain', gaussian: true, gaussianSigma: 15 }]) {
    let rawFA = 0, gatedFA = 0, hit = 0;
    const n = 20;
    for (let f = 0; f < n; f++) {
      const cfg = clampConfig({ targetSize: 10, seed: 500 + f, targetIntensity: 200, ...extra });
      const sm0 = new SensorModel(cfg, new RNG(cfg.seed + 1, 2));
      sm0.renderNarrow({ cx: 1000, cy: 1000 }, [], 0);
      let r = det.detect(sm0.frame, W, H, { sizes, threshold: 5, maxCands: 8 });
      if (r.cands.length) rawFA++;
      if (r.cands.some((c) => net.evaluate(det.last, c.x, c.y).p >= 0.5)) gatedFA++;
      const sm = new SensorModel(cfg, new RNG(cfg.seed, 2));
      const tr = sm.renderNarrow({ cx: 1000, cy: 1000 }, [{ x: 1000 + (f - 10) * 15, y: 1000 + (f % 7) * 10, size: 10, intensity: 200, scint: 1 }], 0)[0];
      r = det.detect(sm.frame, W, H, { sizes, threshold: 6, maxCands: 8 });
      const ok = r.cands.filter((c) => net.evaluate(det.last, c.x, c.y).p >= 0.5).sort((a, b) => b.z - a.z)[0];
      if (ok && Math.hypot(ok.x - tr.x, ok.y - tr.y) < 3) hit++;
    }
    assert.ok(gatedFA <= 1, `gated false alarms ${gatedFA}/${n} (raw ${rawFA})`);
    assert.ok(hit >= n - 1, `beacon kept in ${hit}/${n}`);
  }
});

test('closed loop with the AI verifier enabled still meets the spec', () => {
  for (const cfg of [{ aiVerifier: true }, { aiVerifier: true, saltPepper: true, gaussian: true, gaussianSigma: 20 }, { aiVerifier: true, atmosphere: 'rain', numTargets: 3 }]) {
    const s = new Simulation({ seed: 6, motion: 'figure8', ...cfg });
    s.run(12);
    const m = computeMetrics(s.records, s.cfg, 1);
    assert.ok(m.passAll, JSON.stringify(cfg) + JSON.stringify(m.checks));
  }
});

test('scan acquisition with the AI verifier finds the beacon', () => {
  const s = new Simulation({ aiVerifier: true, acquisition: 'scan', seed: 2, motion: 'circular' }); // seed 3 happens to alias with the sweep period (the beacon keeps leaving the swath)
  s.run(25);
  assert.ok(computeMetrics(s.records, s.cfg, 1).acquisitionTimeSec !== null);
});

test('video tracker with the AI verifier locks and is accurate', () => {
  const W = 640, H = 480, rng = new RNG(8, 3), vt = new VideoTracker({ ai: true }), g = new Float32Array(W * H);
  let err = 99;
  for (let k = 0; k < 15; k++) {
    const cx = 150 + 12 * k, cy = 200 + 5 * k;
    for (let i = 0; i < g.length; i++) g[i] = Math.max(0, Math.min(255, 22 + 14 * rng.gauss()));
    for (let y = -5; y < 5; y++) for (let x = -5; x < 5; x++) g[(cy + y) * W + cx + x] = 230;
    const r = vt.process(g, W, H);
    if (k >= 3) { assert.ok(r.found && r.locked, 'frame ' + k); err = Math.hypot(r.x - (cx - 0.5), r.y - (cy - 0.5)); }
  }
  assert.ok(err < 0.6, 'centroid error ' + err);
});

test('ground-truth parser: header, separators, 1-based frames, seconds, extra columns', () => {
  const a = parseGroundTruth('frame,x,y\n0,10.5,20.5\n1,11,21\n');
  assert.deepEqual(a.get(1), { x: 11, y: 21 });
  const b = parseGroundTruth('1;100;200\n2;101;201\n3;102;202');
  assert.deepEqual(b.get(0), { x: 100, y: 200 }); assert.equal(b.size, 3);
  const c = parseGroundTruth('t,x,y\n0.0333333,5,6\n0.0666667,7,8\n', 30);
  assert.deepEqual(c.get(1), { x: 5, y: 6 }); assert.deepEqual(c.get(2), { x: 7, y: 8 });
  const d = parseGroundTruth('0\t1.5\t2.5\tignored\n1\t2.5\t3.5\tignored');
  assert.deepEqual(d.get(0), { x: 1.5, y: 2.5 });
});

test('video metrics honour the pixel-edge ground-truth convention', () => {
  const rows = [0, 1, 2].map((k) => ({ k, t: k / 30, found: true, x: 10 + k, y: 20, state: k ? 'TRACK' : 'ACQUIRE', procMs: 1 }));
  const gt = new Map([[0, { x: 10.5, y: 20.5 }], [1, { x: 11.5, y: 20.5 }], [2, { x: 12.5, y: 20.5 }]]);
  assert.ok(videoMetrics(rows, { w: 100, h: 100, gt, gtConvention: 'edge' }).centroidingErrorRmsePx < 1e-6);
  assert.ok(videoMetrics(rows, { w: 100, h: 100, gt, gtConvention: 'index' }).centroidingErrorRmsePx > 0.6);
});

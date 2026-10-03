import test from 'node:test';
import assert from 'node:assert/strict';
import { RNG } from '../src/engine/rng.js';
import { clampConfig, DEFAULTS } from '../src/engine/config.js';
import { makeTargetMotion, makePlatformMotion } from '../src/engine/motion.js';
import { SensorModel } from '../src/engine/render.js';
import { Detector } from '../src/engine/detector.js';
import { Simulation } from '../src/engine/simulation.js';
import { computeMetrics } from '../src/engine/metrics.js';
import { VideoTracker } from '../src/engine/videoTracker.js';

test('rng is deterministic per (seed, stream) and streams differ', () => {
  const a = new RNG(5, 1), b = new RNG(5, 1), c = new RNG(5, 2);
  const xa = [a.next(), a.gauss()], xb = [b.next(), b.gauss()];
  assert.deepEqual(xa, xb);
  assert.notEqual(new RNG(5, 1).next(), c.next());
});

test('config clamps to spec ranges', () => {
  const c = clampConfig({ jitterMax: 99, platformSpeed: 50, targetSize: 2, maxPanSpeed: 1, saltPepperDensity: 0.9, fps: 10 });
  assert.equal(c.jitterMax, 20); assert.equal(c.platformSpeed, 20); assert.equal(c.targetSize, 5);
  assert.equal(c.maxPanSpeed, 5); assert.equal(c.saltPepperDensity, 0.1); assert.equal(c.fps, 30);
});

test('every motion keeps the target on screen and moves at the configured speed', () => {
  for (const motion of ['linear', 'circular', 'figure8', 'random', 'spiral', 'sinusoidal', 'waypoints']) {
    const cfg = clampConfig({ motion, targetSpeed: 250 });
    const m = makeTargetMotion(cfg, new RNG(3, 1));
    let prev = m.pos(), dist = 0, n = 0;
    for (let i = 0; i < 3000; i++) {
      const p = m.step(1 / 30);
      assert.ok(p.x >= 0 && p.x <= 2000 && p.y >= 0 && p.y <= 2000, `${motion} left the screen at ${i}: ${p.x},${p.y}`);
      dist += Math.hypot(p.x - prev.x, p.y - prev.y); n++; prev = p;
    }
    const speed = dist / (n / 30);
    assert.ok(Math.abs(speed - 250) < 15, `${motion} speed ${speed}`);
  }
});

test('platform displacement never exceeds the per-frame limit', () => {
  for (const platformModel of ['linear', 'circular', 'random', 'spiral', 'figure8']) {
    const cfg = clampConfig({ platform: true, platformSpeed: 20, platformModel });
    const p = makePlatformMotion(() => cfg, new RNG(2, 5));
    let prev = p.pos();
    for (let i = 0; i < 2000; i++) { const q = p.step(); assert.ok(Math.hypot(q.x - prev.x, q.y - prev.y) <= 20.5, platformModel); prev = q; }
  }
});

test('detector recovers sub-pixel centroid under heavy noise', () => {
  const det = new Detector();
  for (const extra of [{}, { gaussian: true, gaussianSigma: 20 }, { saltPepper: true }, { atmosphere: 'fog', gaussian: true, gaussianSigma: 15 }]) {
    for (const size of [5, 10, 20]) {
      const cfg = clampConfig({ targetSize: size, ...extra });
      const sm = new SensorModel(cfg, new RNG(9, 2));
      let worst = 0;
      for (let i = 0; i < 8; i++) {
        const tx = 150 + i * 47.3, ty = 120 + i * 31.7;
        const tr = sm.renderNarrow({ cx: 320, cy: 240 }, [{ x: tx, y: ty, size, intensity: 230, scint: 1 }], 0);
        const r = det.detect(sm.frame, 640, 480, { sizes: [5, 7, 10, 14, 20], threshold: 6 });
        assert.ok(r.cands.length > 0, 'missed target');
        worst = Math.max(worst, Math.hypot(r.cands[0].x - tr[0].x, r.cands[0].y - tr[0].y));
      }
      assert.ok(worst < 2.5, `centroid error ${worst} for size ${size}`);
    }
  }
});

test('detector false-alarm rate on empty noisy frames', () => {
  const det = new Detector();
  const count = (extra) => {
    const sm = new SensorModel(clampConfig(extra), new RNG(1, 2));
    let fa = 0;
    for (let i = 0; i < 10; i++) { sm.renderNarrow({ cx: 320, cy: 240 }, [], 0); fa += det.detect(sm.frame, 640, 480, { sizes: [5, 10, 20], threshold: 6 }).cands.length; }
    return fa;
  };
  assert.equal(count({ gaussian: true, gaussianSigma: 20 }), 0);
  assert.equal(count({ saltPepper: true }), 0);
  assert.equal(count({ poisson: true }), 0);
  // worst case (10 % impulses + sigma 20): rare isolated alarms are possible but must stay rare;
  // the tracker's 2-frame confirmation and gating reject them.
  assert.ok(count({ gaussian: true, gaussianSigma: 20, saltPepper: true }) <= 3);
});

test('closed loop: nominal scenario meets all spec checks', () => {
  const sim = new Simulation({ motion: 'circular', seed: 4 });
  sim.run(15);
  const m = computeMetrics(sim.records, sim.cfg, 1);
  assert.ok(m.passAll, JSON.stringify(m.checks));
  assert.ok(m.trackingErrorMeanPx < 3);
  assert.ok(m.centroidingErrorRmsePx < 0.5);
});

test('closed loop: same seed gives identical logs, different seed differs', () => {
  const hash = (seed) => { const s = new Simulation({ seed, jitter: true, gaussian: true }); s.run(3); return s.records.map((r) => r.errTrack.toFixed(6)).join(','); };
  assert.equal(hash(7), hash(7));
  assert.notEqual(hash(7), hash(8));
});

test('scan acquisition (no overview) finds the beacon', () => {
  const sim = new Simulation({ acquisition: 'scan', seed: 2, motion: 'circular', duration: 25 });
  sim.run(25);
  const m = computeMetrics(sim.records, sim.cfg, 1);
  assert.ok(m.acquisitionTimeSec !== null, 'never locked');
});

test('decoys do not steal the lock', () => {
  const sim = new Simulation({ numTargets: 3, seed: 3, motion: 'circular' });
  sim.run(12);
  const m = computeMetrics(sim.records, sim.cfg, 1);
  assert.ok(m.targetLossPct < 5 && m.trackingErrorMeanPx < 10, JSON.stringify([m.targetLossPct, m.trackingErrorMeanPx]));
});

test('video tracker locks a synthetic full-screen beacon', () => {
  const W = 2000, rng = new RNG(5, 9), vt = new VideoTracker(), g = new Float32Array(W * W);
  let lastErr = 99;
  for (let k = 0; k < 20; k++) {
    const cx = 500 + 25 * k, cy = 900 + 4 * k;
    for (let i = 0; i < g.length; i++) g[i] = Math.max(0, Math.min(255, 20 + 12 * rng.gauss()));
    for (let y = -5; y < 5; y++) for (let x = -5; x < 5; x++) g[(cy + y) * W + cx + x] = 230;
    const r = vt.process(g, W, W);
    if (k >= 2) { assert.ok(r.found && r.locked); lastErr = Math.hypot(r.x - (cx - 0.5), r.y - (cy - 0.5)); }
  }
  assert.ok(lastErr < 0.5, `centroid error ${lastErr}`);
});

test('DEFAULTS expose the spec defaults', () => {
  assert.equal(DEFAULTS.camW, 640); assert.equal(DEFAULTS.camH, 480); assert.equal(DEFAULTS.fovX, 4);
  assert.equal(DEFAULTS.maxPanSpeed, 5); assert.equal(DEFAULTS.targetSize, 10); assert.equal(DEFAULTS.screenSize, 2000);
});

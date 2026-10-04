// Zoom-lens acquisition: the single camera starts at the full-screen FOV, detects, and zooms in - no separate wide sensor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/engine/simulation.js';
import { computeMetrics } from '../src/engine/metrics.js';
import { PPD } from '../src/engine/config.js';

const run = (cfg, secs = 12, seed = 1) => { const s = new Simulation({ seed, acquisition: 'zoom', ...cfg }); s.run(secs); return { s, m: computeMetrics(s.records, s.cfg, 1) }; };

test('zoom acquisition: detection ≤ 0.5 s and centred at the narrow FOV ≤ 2 s (plain, Gaussian σ20, fog, low light, 5 px beacon)', () => {
  for (const extra of [{}, { gaussian: true, gaussianSigma: 20 }, { atmosphere: 'fog' }, { atmosphere: 'lowlight', poisson: true }, { targetSize: 5 }]) {
    for (const seed of [1, 2, 3, 4]) {
      const { m } = run(extra, 10, seed);
      assert.ok(m.acquisitionTimeSec <= 0.5, `${JSON.stringify(extra)} seed ${seed}: detection ${m.acquisitionTimeSec}`);
      assert.ok(m.timeToNarrowFovCentredSec <= 2, `${JSON.stringify(extra)} seed ${seed}: narrow-centred ${m.timeToNarrowFovCentredSec}`);
      assert.ok(m.trackingErrorMeanPx <= 10 && m.targetLossPct < 5, JSON.stringify(m.checks));
    }
  }
});

test('zoom acquisition with the AI verifier on stays fast: tiny zoomed-out detections are left to the classical detector', () => {
  for (const extra of [{ gaussian: true, gaussianSigma: 20 }, { atmosphere: 'fog' }]) {
    for (const seed of [1, 2, 3]) {
      const { m } = run({ aiVerifier: true, ...extra }, 8, seed);
      assert.ok(m.acquisitionTimeSec <= 0.5 && m.timeToNarrowFovCentredSec <= 2 && m.targetLossPct < 5, `${JSON.stringify(extra)} seed ${seed}: ${m.acquisitionTimeSec} ${m.timeToNarrowFovCentredSec} ${m.targetLossPct}`);
    }
  }
});

test('zoom acquisition under 10 % salt & pepper (switching median keeps the 1-3 px zoomed-out beacon)', () => {
  for (const extra of [{ saltPepper: true }, { saltPepper: true, gaussian: true, gaussianSigma: 20 }]) {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { m } = run(extra, 10, seed);
      assert.ok(m.acquisitionTimeSec <= 0.5 && m.timeToNarrowFovCentredSec <= 2 && m.targetLossPct < 5, `${JSON.stringify(extra)} seed ${seed}: ${m.acquisitionTimeSec} ${m.timeToNarrowFovCentredSec} ${m.targetLossPct}`);
    }
  }
});

test('lens FOV: full-screen coverage at start, ends at the configured FOV, zoom speed respected', () => {
  const { s } = run({ zoomRate: 12 }, 6);
  const wide = s.records[0].fov;
  assert.ok(wide * PPD * (480 / 640) >= 2000 - 1, 'full screen covered by the 4:3 frame: ' + wide);
  assert.ok(Math.abs(s.records.at(-1).fov - 4) < 0.01);
  for (let i = 1; i < s.records.length; i++) assert.ok(Math.abs(s.records[i].fov - s.records[i - 1].fov) <= 12 * s.dt + 1e-9);
});

test('zoom mode needs no wide-area sensor (overview rendering is never requested)', () => {
  const s = new Simulation({ seed: 5, acquisition: 'zoom', motion: 'figure8', dropout: true, dropoutEvery: 4, dropoutLen: 0.6 });
  s.sensor.renderOverview = () => { throw new Error('overview was requested'); };
  s.run(14);
  const m = computeMetrics(s.records, s.cfg, 1);
  assert.ok(m.reacquisitionEvents >= 1 && m.reacquisitionTimeMaxSec <= 1, JSON.stringify([m.reacquisitionEvents, m.reacquisitionTimeMaxSec]));
});

test('zoom mode: errors are reported in default-FOV pixels (angular), not in zoomed-out camera pixels', () => {
  const { s } = run({}, 3);
  const r = s.records[0]; // beacon off-centre at the widest FOV: the error must be a large angular distance
  assert.ok(r.fov > 10 && r.errTrack > 100, `${r.fov} ${r.errTrack}`);
});

// One test per row of the ISRO PS-26169 "Parameters and Specifications" table (+ deliverable features).
// Each test drives the real closed-loop engine; numbers in the assertions are the spec limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/engine/simulation.js';
import { computeMetrics, recordsToCSV, metricsToHTML } from '../src/engine/metrics.js';
import { DEFAULTS, MOTIONS, ATMOSPHERES, PLATFORM_MODELS, clampConfig, PPD } from '../src/engine/config.js';

const run = (cfg, secs = 10) => { const s = new Simulation({ seed: 11, ...cfg }); s.run(secs); return { s, m: computeMetrics(s.records, s.cfg, 1) }; };

test('#1 screen size >= 2000x2000, user-definable', () => {
  assert.equal(DEFAULTS.screenSize, 2000);
  const { m, s } = run({ screenSize: 3000 }, 8);
  assert.equal(s.cfg.screenSize, 3000);
  assert.ok(m.checks.K03_target_loss_lt_5pct && Number.isFinite(m.acquisitionTimeSec));
  assert.equal(clampConfig({ screenSize: 100 }).screenSize, 2000);
});

test('#2 camera: monochrome focal-plane array (single channel frame)', () => {
  const s = new Simulation({}); s.step();
  assert.ok(s.sensor.frame instanceof Float32Array && s.sensor.frame.length === 640 * 480);
});

test('#2 optional colour camera: RGB frame produced, tracker (luminance) still meets spec', () => {
  const { s, m } = run({ cameraType: 'colour', gaussian: true, gaussianSigma: 15 }, 10);
  assert.ok(s.sensor.rgb && s.sensor.rgb.length === 640 * 480 * 4);
  const px = (i) => [s.sensor.rgb[i * 4], s.sensor.rgb[i * 4 + 1], s.sensor.rgb[i * 4 + 2]];
  const b = px(Math.round(s.last.truth.y) * 640 + Math.round(s.last.truth.x));
  assert.ok(b[0] > b[2], 'beacon should be reddish: ' + b);
  assert.ok(m.passAll, JSON.stringify(m.checks));
});

test('#3 resolution 640x480 default, user-definable', () => {
  assert.deepEqual([DEFAULTS.camW, DEFAULTS.camH], [640, 480]);
  const { s, m } = run({ camW: 800, camH: 600 }, 8);
  assert.equal(s.sensor.frame.length, 800 * 600);
  assert.ok(m.checks.K03_target_loss_lt_5pct);
});

test('#4 FOV default 4x3 deg, user-defined (160 px/deg), tracking works at other FOVs', () => {
  assert.equal(DEFAULTS.fovX, 4);
  assert.equal(PPD, 160);
  for (const fovX of [2, 8]) { const { m } = run({ fovX }, 10); assert.ok(m.checks.K03_target_loss_lt_5pct, `fov ${fovX}`); }
});

test('#5 camera update rate >= 30 Hz', () => {
  assert.ok(DEFAULTS.fps >= 30);
  const s = new Simulation({ fps: 10 }); assert.equal(s.cfg.fps, 30);
  const { s: s2 } = run({}, 2); assert.ok(Math.abs(s2.records[1].t - s2.records[0].t - 1 / 30) < 1e-9);
});

test('#6 initial camera position = centre of the screen', () => {
  const s = new Simulation({}); const r = s.step();
  assert.deepEqual([r.camX, r.camY], [1000, 1000]);
});

test('#7-8 beacon target; one mandatory, multiple optional', () => {
  assert.equal(new Simulation({ numTargets: 1 }).targets.length, 1);
  assert.equal(new Simulation({ numTargets: 4 }).targets.length, 4);
});

test('#9 shapes: square default, others selectable, all trackable', () => {
  assert.equal(DEFAULTS.targetShape, 'square');
  for (const targetShape of ['square', 'circle', 'diamond']) { const { m } = run({ targetShape }, 8); assert.ok(m.passAll, targetShape + JSON.stringify(m.checks)); }
});

test('#10 size 5-20 px (default 10): tracked across the range', () => {
  assert.equal(DEFAULTS.targetSize, 10);
  for (const targetSize of [5, 10, 20]) { const { m } = run({ targetSize }, 8); assert.ok(m.passAll, `size ${targetSize}`); }
});

test('#11 initial target location user-defined or random (default)', () => {
  assert.equal(DEFAULTS.startMode, 'random');
  const a = new Simulation({ seed: 1, motion: 'linear' }); const b = new Simulation({ seed: 2, motion: 'linear' });
  a.step(); b.step(); assert.notDeepEqual([a.records[0].worldX], [b.records[0].worldX]);
  const u = new Simulation({ startMode: 'user', startX: 700, startY: 1300, motion: 'linear' }); const r = u.step();
  assert.ok(Math.abs(r.worldX - 700) < 1 && Math.abs(r.worldY - 1300) < 1);
});

test('#12 motions: >= 4 required (straight, circular, figure-8, random) + spiral, sinusoidal, user-defined', () => {
  const ids = MOTIONS.map((m) => m.id);
  for (const id of ['linear', 'circular', 'figure8', 'random', 'spiral', 'sinusoidal', 'waypoints']) assert.ok(ids.includes(id), id);
  for (const motion of ids) { const { m } = run({ motion, targetSpeed: 220 }, 12); assert.ok(m.passAll, `${motion}: ${JSON.stringify(m.checks)}`); }
});

test('#13-14 max pan/tilt speed 5-10 deg/s, default 5, never exceeded', () => {
  assert.equal(DEFAULTS.maxPanSpeed, 5); assert.equal(DEFAULTS.maxTiltSpeed, 5);
  for (const sp of [5, 10]) {
    const { s } = run({ maxPanSpeed: sp, maxTiltSpeed: sp, motion: 'linear', targetSpeed: 600 }, 8);
    const limPerFrame = sp * PPD * s.dt * 1.0001; let worst = 0;
    for (let i = 1; i < s.records.length; i++) { const a = s.records[i], b = s.records[i - 1]; worst = Math.max(worst, Math.abs(a.camX - b.camX), Math.abs(a.camY - b.camY)); }
    assert.ok(worst <= limPerFrame, `per-frame move ${worst} > ${limPerFrame}`);
  }
});

test('#15 control update interval >= 20 Hz (control runs every frame)', () => {
  const { s } = run({}, 3); assert.ok(s.cfg.fps >= 20);
  assert.ok(s.records.every((r) => r.state), 'tracker produced an output every frame');
});

test('#16-20 performance specs on the nominal scenario (all 4 required motions)', () => {
  for (const motion of ['linear', 'circular', 'figure8', 'random']) {
    const { m } = run({ motion }, 15);
    assert.ok(m.acquisitionTimeSec <= 2, `acq ${m.acquisitionTimeSec}`);
    assert.ok(m.trackingErrorMeanPx <= 10, 'err');
    assert.ok(m.targetLossPct < 5, 'loss');
    assert.ok(m.reacquisitionTimeMaxSec <= 1, 'reacq');
    assert.ok(m.averageFPS >= 20, 'fps');
  }
});

test('#19 re-acquisition after the camera is knocked off the beacon (450 px, within slew reach)', () => {
  const s = new Simulation({ seed: 5, motion: 'circular', duration: 20 });
  s.run(4);
  s.gimbal.pos.x += 450; s.gimbal.vel.x = s.gimbal.vel.y = 0;
  const kBreak = s.k; s.run(5);
  const after = s.records.slice(kBreak);
  const lostAt = after.findIndex((r) => r.state !== 'TRACK');
  const back = after.findIndex((r, i) => i > lostAt && lostAt >= 0 && r.state === 'TRACK');
  assert.ok(lostAt >= 0 && back > 0, 'never lost/re-acquired');
  assert.ok((back - lostAt) * s.dt <= 1.0, `re-acquisition took ${((back - lostAt) * s.dt).toFixed(2)} s`);
});

test('#19 re-acquisition after beacon dropouts (0.5 s blink-out), measured by the metrics', () => {
  const { m } = run({ dropout: true, dropoutEvery: 4, dropoutLen: 0.5, motion: 'circular' }, 20);
  assert.ok(m.reacquisitionEvents >= 1, 'no dropout event registered');
  assert.ok(m.reacquisitionTimeMaxSec <= 1.0, `re-acq ${m.reacquisitionTimeMaxSec}`);
  assert.ok(m.targetLossPct < 5 && m.trackingErrorMeanPx <= 10, JSON.stringify([m.targetLossPct, m.trackingErrorMeanPx]));
});

test('#21.1 image noise: salt&pepper (<=10 %), Gaussian, Poisson - selectable one or more', () => {
  for (const cfg of [{ saltPepper: true, saltPepperDensity: 0.1 }, { gaussian: true, gaussianSigma: 20 }, { poisson: true },
    { saltPepper: true, gaussian: true, poisson: true, gaussianSigma: 20 }]) {
    const { m } = run(cfg, 10); assert.ok(m.passAll, JSON.stringify(cfg) + JSON.stringify(m.checks));
  }
  assert.equal(clampConfig({ saltPepperDensity: 0.5 }).saltPepperDensity, 0.1);
});

test('#21.2 noise sigma up to 20 (really applied)', () => {
  const s = new Simulation({ gaussian: true, gaussianSigma: 20, seed: 3 }); s.sensor.renderNarrow({ cx: 1000, cy: 1000 }, [], 0);
  const f = s.sensor.frame; let mean = 0; for (const v of f) mean += v; mean /= f.length;
  let sd = 0; for (const v of f) sd += (v - mean) ** 2; sd = Math.sqrt(sd / f.length);
  assert.ok(sd > 10 && sd < 22, `measured sd ${sd}`);
});

test('#21.3 camera jitter up to +-20 px/frame (bounded, really applied)', () => {
  const { s, m } = run({ jitter: true, jitterMax: 20 }, 10);
  const mx = Math.max(...s.records.map((r) => Math.max(Math.abs(r.jitX), Math.abs(r.jitY))));
  assert.ok(mx <= 20 && mx > 8, `max jitter ${mx}`);
  assert.ok(m.passAll, JSON.stringify(m.checks));
});

test('#21.4 atmosphere: clear, haze, fog, rain, low light; reduces contrast & brightness', () => {
  for (const id of ['clear', 'haze', 'fog', 'rain', 'lowlight']) assert.ok(ATMOSPHERES[id], id);
  const stat = (atm) => { const s = new Simulation({ atmosphere: atm, seed: 2 }); s.sensor.renderNarrow({ cx: 1000, cy: 1000 }, [{ x: 1000, y: 1000, size: 10, intensity: 230, scint: 1 }], 0); const f = s.sensor.frame; return f[240 * 640 + 320] - f[10 * 640 + 10]; };
  const clear = stat('clear');
  for (const id of ['haze', 'fog', 'lowlight']) assert.ok(stat(id) < clear, `${id} contrast ${stat(id)} !< ${clear}`);
  for (const atmosphere of ['haze', 'fog', 'rain', 'lowlight']) { const { m } = run({ atmosphere }, 10); assert.ok(m.passAll, atmosphere); }
});

test('#21.5 platform motion <= 20 px/frame: linear (default) + circular, random, spiral, figure-8', () => {
  assert.equal(DEFAULTS.platformModel, 'linear');
  for (const platformModel of PLATFORM_MODELS.map((p) => p.id)) {
    const { s, m } = run({ platform: true, platformSpeed: 20, platformModel, targetSpeed: 120 }, 12);
    let worst = 0; for (let i = 2; i < s.records.length; i++) worst = Math.max(worst, Math.hypot(s.records[i].platX - s.records[i - 1].platX, s.records[i].platY - s.records[i - 1].platY));
    assert.ok(worst <= 20.5, `${platformModel} step ${worst}`);
    assert.ok(m.checks.K03_target_loss_lt_5pct && m.checks.K01_acquisition_le_2s, platformModel + JSON.stringify(m.checks));
  }
});

test('turbulence / vibration disturbances are applied and survivable', () => {
  const { m } = run({ turbulence: 1 }, 10); assert.ok(m.checks.K03_target_loss_lt_5pct && m.trackingErrorMeanPx <= 10);
});

test('decoys: the designated beacon is the one tracked', () => {
  const { s, m } = run({ numTargets: 4 }, 10);
  assert.ok(m.trackingErrorMeanPx <= 10 && m.targetLossPct < 5, JSON.stringify([m.trackingErrorMeanPx, m.targetLossPct]));
  assert.ok(s.records.at(-1).errTrack < 10);
});

test('performance log contains every field the statement lists', () => {
  const { s, m } = run({}, 6);
  for (const k of ['simulationDurationSec', 'averageFPS', 'acquisitionTimeSec', 'trackingErrorMeanPx', 'trackingErrorMaxPx', 'lockRetentionRatePct', 'processingTimeMeanMs', 'centroidingErrorRmsePx', 'trackingErrorRmsePx', 'reacquisitionTimeMaxSec', 'targetLossPct']) assert.ok(k in m, k);
  assert.ok(recordsToCSV(s.records).split('\n').length === s.records.length + 1);
  assert.ok(metricsToHTML(m).includes('K01_acquisition_le_2s'));
});

test('ground truth never reaches the tracker (tracker input = pixels + encoder only)', () => {
  const s = new Simulation({}); const seen = [];
  const orig = s.tracker.process.bind(s.tracker); s.tracker.process = (obs) => { seen.push(Object.keys(obs).sort().join(',')); return orig(obs); };
  s.run(1);
  assert.equal(new Set(seen).size, 1);
  assert.equal(seen[0], 'cam,dt,fps,getOverview,k,narrow,t');
});

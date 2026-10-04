// Closed-loop fixed-step simulation: scene -> sensor (with disturbances) -> tracker -> gimbal.
// Simulation time is frame-locked (dt = 1/fps); wall-clock is used only for processing-time metrics.
import { RNG } from './rng.js';
import { camScale, clampConfig, PPD } from './config.js';
import { makeTargetMotion, makePlatformMotion } from './motion.js';
import { SensorModel, atmosphereParams } from './render.js';
import { Gimbal } from './gimbal.js';
import { CoarseTracker, STATES } from './tracker.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class Simulation {
  constructor(config = {}) {
    this.cfg = clampConfig(config);
    this.reset();
  }

  reset(config) {
    if (config) this.cfg = clampConfig({ ...this.cfg, ...config });
    const c = this.cfg;
    this.dt = 1 / c.fps;
    this.k = 0;
    // current lens FOV (deg): fixed unless acquisition = 'zoom' (full-screen FOV at start, zooms in on the beacon)
    this.fov = c.acquisition === 'zoom' ? Math.max(c.fovX, c.screenSize / (PPD * (c.camH / c.camW))) : c.fovX; // wide enough that the 4:3 frame covers the whole square screen
    const R = (s) => new RNG(c.seed, s);
    this.rngMotion = R(1);
    this.rngNoise = R(2);
    this.rngJitter = R(3);
    this.rngAtm = R(4);
    this.rngPlat = R(5);
    this.rngScene = R(6);
    this.sensor = new SensorModel(c, this.rngNoise);
    this.gimbal = new Gimbal(c);
    this.tracker = new CoarseTracker(c);
    this.motions = [];
    this.targets = [];
    for (let i = 0; i < c.numTargets; i++) {
      this.motions.push(makeTargetMotion(c, this.rngMotion, i));
      this.targets.push({
        size: i === 0 ? c.targetSize : Math.min(20, Math.max(5, c.targetSize * this.rngScene.uniform(0.7, 1.4))),
        intensity: i === 0 ? c.targetIntensity : c.targetIntensity * this.rngScene.uniform(0.5, 0.8),
        scint: 1,
        x: 0, y: 0,
      });
    }
    this.platform = makePlatformMotion(() => this.cfg, this.rngPlat);
    this.wander = { x: 0, y: 0 };
    this.logScint = 0;
    this.records = [];
    this._settled = undefined; // GUI cache: first frame centred within 10 px
    this._settledScan = 0;
    this.last = null;
    this.procTotal = 0;
    this.wallStart = null;
    this.wallTotal = 0;
  }

  /** Change disturbance / tuning parameters without restarting the run. */
  updateLive(partial) {
    this.cfg = clampConfig({ ...this.cfg, ...partial });
    this.sensor.cfg = this.cfg;
    this.sensor.atm = atmosphereParams(this.cfg);
    this.tracker.cfg = this.cfg;
    this.tracker.thr = this.cfg.detectThreshold;
  }

  _jitter() {
    const c = this.cfg;
    if (!c.jitter || c.jitterMax <= 0) return { x: 0, y: 0 };
    const J = c.jitterMax, s = J / 2.5;
    const f = () => Math.max(-J, Math.min(J, s * this.rngJitter.gauss()));
    return { x: f(), y: f() };
  }

  _turbulence() {
    const c = this.cfg, dt = this.dt, T = c.turbulence;
    if (T <= 0) { this.wander = { x: 0, y: 0 }; this.logScint = 0; return 1; }
    const a = Math.exp(-dt / 0.5);
    const sw = 4 * T;
    this.wander.x = a * this.wander.x + Math.sqrt(1 - a * a) * sw * this.rngAtm.gauss();
    this.wander.y = a * this.wander.y + Math.sqrt(1 - a * a) * sw * this.rngAtm.gauss();
    const b = Math.exp(-dt / 0.1), ss = 0.25 * T;
    this.logScint = b * this.logScint + Math.sqrt(1 - b * b) * ss * this.rngAtm.gauss();
    return Math.exp(this.logScint - (ss * ss) / 2);
  }

  /** Advance one frame; returns the per-frame record (also appended to this.records). */
  step() {
    const c = this.cfg, dt = this.dt, k = this.k;
    if (this.wallStart === null) this.wallStart = now();
    const scale = camScale({ fovX: this.fov, camW: c.camW }); // screen px per camera px for THIS frame
    const unit = camScale(c); // error unit: camera pixels at the configured FOV
    this.sensor.fovNow = this.fov;

    // --- world state at t = k*dt
    for (let i = 0; i < this.motions.length; i++) {
      const p = k === 0 ? this.motions[i].pos() : this.motions[i].step(dt);
      this.targets[i].x = p.x;
      this.targets[i].y = p.y;
    }
    const plat = k === 0 ? { x: 0, y: 0 } : this.platform.step();
    const jit = this._jitter();
    const scint = this._turbulence();
    const cam = { x: this.gimbal.pos.x, y: this.gimbal.pos.y };
    const wand = { x: this.wander.x * unit, y: this.wander.y * unit }; // camera shake / beam wander are angular: independent of the lens zoom
    // beacon dropout: designated target invisible for dropoutLen every dropoutEvery seconds (not at start-up)
    const tt = k * dt;
    const dropped = c.dropout && tt > 3 && (tt - 3) % c.dropoutEvery < c.dropoutLen;
    const tgts = this.targets.map((t, i) => ({ ...t, scint0: i === 0 && dropped ? 0 : 1, x: t.x + (i === 0 ? wand.x : 0), y: t.y + (i === 0 ? wand.y : 0), scint: t.scint * scint * (i === 0 && dropped ? 0 : 1) }));

    // --- sensor
    const view = { cx: cam.x + plat.x + jit.x * unit, cy: cam.y + plat.y + jit.y * unit };
    const truth = this.sensor.renderNarrow(view, tgts, c.turbulence);
    const w = this.sensor.w, h = this.sensor.h;
    // the wide-area sensor rides on the same platform: it sees the scene shifted by the same line-of-sight offset
    const ovTgts = tgts.map((t) => ({ ...t, x: t.x - plat.x - jit.x * unit, y: t.y - plat.y - jit.y * unit }));
    let ovCache = null;
    const getOverview = () => {
      if (!ovCache) { this.sensor.renderOverview(ovTgts, c.turbulence); ovCache = { data: this.sensor.overview, w: this.sensor.ow, h: this.sensor.ow, factor: this.sensor.ovFactor }; }
      return ovCache;
    };

    // --- tracker (timed)
    const t0 = now();
    const out = this.tracker.process({ k, t: k * dt, dt, fps: c.fps, cam, scale, narrow: { data: this.sensor.frame, w, h }, getOverview });
    const t1 = now();
    this.gimbal.step(out.cmd, dt);
    if (out.zoom != null) { // zoom lens: rate-limited FOV change
      const lim = (c.zoomRate ?? 12) * dt;
      this.fov += Math.max(-lim, Math.min(lim, out.zoom - this.fov));
    }
    const procMs = t1 - t0;
    this.procTotal += procMs;

    // --- ground truth in camera px
    const tr = truth[0];
    const trueJit = { x: tr.x, y: tr.y }; // includes jitter
    const trueNoJit = { x: tr.x + (jit.x * unit) / scale, y: tr.y + (jit.y * unit) / scale }; // boresight error excludes random jitter
    const bx = w / 2, by = h / 2;
    const rec = {
      k, t: k * dt, state: out.state,
      worldX: tgts[0].x, worldY: tgts[0].y, camX: cam.x, camY: cam.y,
      trueX: trueNoJit.x, trueY: trueNoJit.y,
      fov: this.fov,
      errTrack: (Math.hypot(trueNoJit.x - bx, trueNoJit.y - by) * scale) / unit,
      errTrackJit: (Math.hypot(trueJit.x - bx, trueJit.y - by) * scale) / unit,
      inFov: trueJit.x >= 0 && trueJit.x < w && trueJit.y >= 0 && trueJit.y < h,
      detX: out.det ? out.det.x : NaN, detY: out.det ? out.det.y : NaN,
      errCent: out.det ? (Math.hypot(out.det.x - trueJit.x, out.det.y - trueJit.y) * scale) / unit : NaN,
      estX: out.est ? out.est.x : NaN, estY: out.est ? out.est.y : NaN,
      errEst: out.est ? (Math.hypot(out.est.x - trueNoJit.x, out.est.y - trueNoJit.y) * scale) / unit : NaN,
      procMs, overview: out.overview, saturated: this.gimbal.saturated,
      jitX: jit.x, jitY: jit.y, platX: plat.x, platY: plat.y,
    };
    this.records.push(rec);
    this.last = { rec, out, truth: trueJit, view, tgts, cam, scale, fov: rec.fov };
    this.k++;
    this.wallTotal = now() - this.wallStart;
    return rec;
  }

  run(seconds = this.cfg.duration, onProgress) {
    const n = Math.round(seconds * this.cfg.fps);
    for (let i = 0; i < n; i++) {
      this.step();
      if (onProgress && i % 30 === 0) onProgress(i / n);
    }
    return this.records;
  }
}

export { STATES, PPD };

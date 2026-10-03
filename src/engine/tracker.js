// Coarse-alignment tracker: SEARCH -> SLEW -> TRACK -> COAST -> REACQUIRE state machine,
// IMM estimation in world (screen-pixel) coordinates, and a feed-forward + feedback velocity
// controller. It sees only pixel frames and its own encoder position - never ground truth.
import { Detector } from './detector.js';
import { IMM } from './kalman.js';
import { camScale, PPD } from './config.js';

export const STATES = { SEARCH: 'SEARCH', SLEW: 'SLEW', TRACK: 'TRACK', COAST: 'COAST', REACQUIRE: 'REACQUIRE' };

const uniqueSizes = (arr) => [...new Set(arr)].sort((a, b) => a - b);

export class CoarseTracker {
  constructor(cfg) {
    this.cfg = cfg;
    this.det = new Detector();
    this.kf = new IMM({ qCV: cfg.qCV ?? 2e4, qCA: cfg.qCA ?? 5e7 });
    this.vmax = [cfg.maxPanSpeed * PPD, cfg.maxTiltSpeed * PPD];
    this.amax = cfg.maxAccel * PPD;
    this.scale = camScale(cfg);
    this.sizes = uniqueSizes([5, 7, 10, 14, 20].map((s) => Math.max(2, Math.round(s / this.scale))));
    this.ovSizes = [1, 2, 3, 5];
    this.thr = cfg.detectThreshold;
    this.reset();
  }

  reset() {
    this.state = STATES.SEARCH;
    this.kf.initialised = false;
    this.confirm = 0;
    this.prevCand = null;
    this.lastKnown = null; // last confirmed world position (prior for re-acquisition)
    this.coastAge = 0;
    this.slewAge = 0;
    this.noOverview = 0;
    this.arrived = 0;
    this.lastSize = null;
    this.scanIdx = 0;
    this.trackConfirm = 0;
    this.frames = 0;
  }

  _roiSizes() {
    if (this.lastSize == null) return this.sizes;
    const i = this.sizes.indexOf(this.lastSize);
    if (i < 0) return this.sizes;
    return this.sizes.slice(Math.max(0, i - 1), i + 2);
  }

  /** World measurement (screen px) from a narrow-frame centroid. */
  _toWorld(obs, c) {
    return { x: obs.cam.x + (c.x - obs.narrow.w / 2) * this.scale, y: obs.cam.y + (c.y - obs.narrow.h / 2) * this.scale };
  }

  _toImage(obs, wx, wy) {
    return { x: (wx - obs.cam.x) / this.scale + obs.narrow.w / 2, y: (wy - obs.cam.y) / this.scale + obs.narrow.h / 2 };
  }

  _measSigma(c) {
    // centroid std (camera px) ~ s / SNR; scaled to screen px
    const q = Math.max(c.amp / Math.max(c.noise ?? 1, 1), 1);
    return (0.25 + (0.5 * c.size) / q) * this.scale * (c.edge ? 3 : 1);
  }

  _overview(obs, prior) {
    const ov = obs.getOverview();
    const r = this.det.detect(ov.data, ov.w, ov.h, { sizes: this.ovSizes, threshold: this.thr, maxCands: 6 });
    const f = ov.factor;
    const cands = r.cands.map((c) => ({ x: c.x * f, y: c.y * f, z: c.z, amp: c.amp, size: c.size * f, noise: r.sigma, edge: false }));
    if (prior) {
      for (const c of cands) c.score = c.z * Math.exp(-Math.hypot(c.x - prior.x, c.y - prior.y) / 350);
    } else for (const c of cands) c.score = c.z;
    cands.sort((a, b) => b.score - a.score);
    return cands;
  }

  _narrow(obs, center, R, sizes) {
    const { data, w, h } = obs.narrow;
    const roi = center ? { x0: center.x - R, y0: center.y - R, x1: center.x + R, y1: center.y + R } : { x0: 0, y0: 0, x1: w, y1: h };
    const r = this.det.detectROI(data, w, h, roi, { sizes, threshold: this.thr, maxCands: 5 });
    for (const c of r.cands) c.noise = r.sigma;
    return r.cands;
  }

  /** Main per-frame entry. Returns command + diagnostics. */
  process(obs) {
    const { cfg, kf } = this;
    const dt = obs.dt;
    const out = { state: this.state, cmd: { vx: 0, vy: 0 }, det: null, est: null, roi: null, overview: false, estWorld: null, mu: null };
    this.frames++;

    const wrapped = () => {
      switch (this.state) {
        case STATES.SEARCH:
        case STATES.REACQUIRE: return this._search(obs, out);
        case STATES.SLEW: return this._slew(obs, out, dt);
        case STATES.TRACK: return this._track(obs, out, dt);
        case STATES.COAST: return this._coast(obs, out, dt);
        default: return null;
      }
    };
    wrapped();
    out.state = this.state;
    if (kf.initialised && this.state !== STATES.SEARCH && this.state !== STATES.REACQUIRE) {
      const s = kf.state;
      out.estWorld = { x: s.px, y: s.py, vx: s.vx, vy: s.vy, sp: s.sp };
      out.est = this._toImage(obs, s.px, s.py);
      out.mu = kf.mu;
      out.cmd = this._control(obs, dt);
    } else if (this.state === STATES.SEARCH && cfg.acquisition === 'scan') {
      out.cmd = this._scanCommand(obs);
    }
    return out;
  }

  _search(obs, out) {
    const cfg = this.cfg;
    let cands;
    if (cfg.acquisition === 'scan') {
      cands = this._narrow(obs, null, 0, this.sizes).map((c) => ({ ...this._toWorld(obs, c), z: c.z, amp: c.amp, size: c.size, noise: c.noise, edge: c.edge, img: c }));
      out.det = cands[0]?.img ?? null;
    } else {
      cands = this._overview(obs, this.lastKnown);
      out.overview = true;
    }
    const best = cands[0];
    if (!best) { this.confirm = 0; this.prevCand = null; return; }
    if (this.prevCand && Math.hypot(best.x - this.prevCand.x, best.y - this.prevCand.y) < 80) this.confirm++;
    else this.confirm = 1;
    this.prevCand = best;
    if (this.confirm >= 2) {
      this.kf.init(best.x, best.y, cfg.acquisition === 'scan' ? 3 : 6);
      this.lastKnown = { x: best.x, y: best.y };
      this.confirm = 0;
      this.coastAge = 0;
      this.slewAge = 0;
      this.noOverview = 0;
      this.arrived = 0;
      this.trackConfirm = 0;
      this.lastSize = null;
      this.state = cfg.acquisition === 'scan' ? STATES.TRACK : STATES.SLEW;
      if (cfg.acquisition === 'scan') this.lastSize = best.img?.size ?? null;
    }
  }

  _slew(obs, out, dt) {
    const { kf } = this;
    kf.predict(dt);
    this.slewAge++;
    const s = kf.state;
    const pred = this._toImage(obs, s.px, s.py);
    const inFrame = pred.x > -40 && pred.x < obs.narrow.w + 40 && pred.y > -40 && pred.y < obs.narrow.h + 40;
    let gotNarrow = false;
    if (inFrame) {
      const R = Math.min(200, 70 + (4 * s.sp) / this.scale);
      out.roi = { x: pred.x, y: pred.y, r: R };
      const cands = this._narrow(obs, pred, R, this.sizes);
      const c = this._pickNearest(cands, pred, R * 1.0);
      if (c) {
        out.det = c;
        const z = this._toWorld(obs, c);
        kf.update(z.x, z.y, this._measSigma(c));
        this.lastSize = c.size;
        gotNarrow = true;
        this.trackConfirm++;
        // the beacon identity was already confirmed on the wide view: one detection agreeing with the prediction is enough
        const agree = Math.hypot(c.x - pred.x, c.y - pred.y) < 30 + (3 * s.sp) / this.scale;
        if (this.trackConfirm >= 2 || agree) { this.state = STATES.TRACK; this.arrived = 0; return; }
      } else this.trackConfirm = 0;
    } else this.trackConfirm = 0;
    if (!gotNarrow) {
      // keep steering with the wide view
      const cands = this._overview(obs, { x: s.px, y: s.py });
      out.overview = true;
      const gate = 160 + 3 * s.sp;
      let best = null, bd = Infinity;
      for (const c of cands) { const d = Math.hypot(c.x - s.px, c.y - s.py); if (d < gate && d < bd) { bd = d; best = c; } }
      if (best) { kf.update(best.x, best.y, 5, { gate: 30 }); this.noOverview = 0; this.lastKnown = { x: best.x, y: best.y }; }
      else this.noOverview++;
      const sNow = kf.state;
      const near = Math.hypot(sNow.px - obs.cam.x, sNow.py - obs.cam.y) < 40 * this.scale + 20;
      this.arrived = near ? this.arrived + 1 : 0;
    }
    if (this.slewAge > 5 * obs.fps || this.noOverview > 15 || this.arrived > 10) this._lose();
  }

  _pickNearest(cands, pred, gate) {
    let best = null, bd = Infinity;
    for (const c of cands) {
      const d = Math.hypot(c.x - pred.x, c.y - pred.y);
      if (d < gate && d < bd) { bd = d; best = c; }
    }
    return best;
  }

  _track(obs, out, dt) {
    const { kf } = this;
    kf.predict(dt);
    const s = kf.state;
    const pred = this._toImage(obs, s.px, s.py);
    const R = Math.min(160, Math.max(64, 48 + (3 * s.sp) / this.scale + (Math.hypot(s.vx, s.vy) * dt * 2) / this.scale));
    out.roi = { x: pred.x, y: pred.y, r: R };
    const cands = this._narrow(obs, pred, R, this._roiSizes());
    const c = this._pickNearest(cands, pred, R);
    if (c) {
      out.det = c;
      const z = this._toWorld(obs, c);
      const r = kf.update(z.x, z.y, this._measSigma(c));
      this.lastSize = c.size;
      if (r.accepted) { this.lastKnown = { x: kf.state.px, y: kf.state.py }; this.coastAge = 0; return; }
    }
    this.coastAge = 1;
    this.state = STATES.COAST;
  }

  _coast(obs, out, dt) {
    const { kf, cfg } = this;
    kf.predict(dt);
    this.coastAge++;
    const s = kf.state;
    const pred = this._toImage(obs, s.px, s.py);
    const R = Math.min(Math.max(obs.narrow.w, obs.narrow.h), 90 + (6 * s.sp) / this.scale);
    out.roi = { x: pred.x, y: pred.y, r: R };
    const cands = this._narrow(obs, pred, R, this.sizes);
    const c = this._pickNearest(cands, pred, R);
    if (c) {
      out.det = c;
      const z = this._toWorld(obs, c);
      kf.update(z.x, z.y, this._measSigma(c), { gate: 40 });
      this.lastSize = c.size;
      this.state = STATES.TRACK;
      this.coastAge = 0;
      return;
    }
    // wide view assists the recovery
    const ov = this._overview(obs, { x: s.px, y: s.py });
    out.overview = true;
    const gate = 200 + 4 * s.sp;
    let best = null, bd = Infinity;
    for (const o of ov) { const d = Math.hypot(o.x - s.px, o.y - s.py); if (d < gate && d < bd) { bd = d; best = o; } }
    if (best) kf.update(best.x, best.y, 5, { gate: 60 });
    if (this.coastAge > cfg.coastFrames) this._lose();
  }

  _lose() {
    this.state = STATES.REACQUIRE;
    this.kf.initialised = false;
    this.confirm = 0;
    this.prevCand = null;
  }

  /** Velocity command (screen px / s): feed-forward + shaped feedback, with accel-aware braking. */
  _control(obs, dt) {
    const { cfg, kf } = this;
    const g = cfg.controlGain;
    const tau = dt * (1 + (cfg.extraLatency ?? 0));
    const aim = kf.predictAhead(tau);
    const dx = aim.x - obs.cam.x, dy = aim.y - obs.cam.y;
    const decay = this.state === STATES.COAST ? Math.max(0, 1 - this.coastAge / (cfg.coastFrames * 1.5)) : 1;
    const v = [aim.vx * decay, aim.vy * decay];
    const d = [dx, dy];
    const u = [0, 0];
    const adec = 0.85 * this.amax;
    for (let a = 0; a < 2; a++) {
      let ua = g * d[a] / dt + (1 - g) * v[a];
      const rel = ua - v[a];
      const lim = Math.sqrt(2 * adec * Math.abs(d[a])); // min-time stopping profile
      if (Math.abs(rel) > lim) ua = v[a] + Math.sign(rel) * lim;
      u[a] = ua;
    }
    return { vx: u[0], vy: u[1] };
  }

  _scanCommand(obs) {
    const size = this.cfg.screenSize;
    const rowStep = 0.8 * obs.narrow.h * this.scale;
    const rows = [];
    for (let y = 0.5 * obs.narrow.h * this.scale; y < size; y += rowStep) rows.push(Math.min(y, size - 0.5 * obs.narrow.h * this.scale));
    if (!this.scanWps) {
      const x0 = 0.5 * obs.narrow.w * this.scale, x1 = size - x0;
      this.scanWps = [];
      rows.forEach((y, i) => { if (i % 2 === 0) this.scanWps.push({ x: x1, y }, { x: x1, y: rows[i + 1] ?? y }); else this.scanWps.push({ x: x0, y }, { x: x0, y: rows[i + 1] ?? y }); });
      // start with the row closest to the current camera position
      let bi = 0, bd = Infinity;
      this.scanWps.forEach((p, i) => { const d = Math.hypot(p.x - obs.cam.x, p.y - obs.cam.y); if (d < bd) { bd = d; bi = i; } });
      this.scanIdx = bi;
    }
    let wp = this.scanWps[this.scanIdx % this.scanWps.length];
    if (Math.hypot(wp.x - obs.cam.x, wp.y - obs.cam.y) < 60) { this.scanIdx++; wp = this.scanWps[this.scanIdx % this.scanWps.length]; }
    const dx = wp.x - obs.cam.x, dy = wp.y - obs.cam.y, dist = Math.hypot(dx, dy) || 1;
    return { vx: (dx / dist) * Math.min(this.vmax[0], 1e9), vy: (dy / dist) * Math.min(this.vmax[1], 1e9) };
  }
}

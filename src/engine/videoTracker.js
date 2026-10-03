// Benchmark-2 path: the same detector, fed with decoded video frames instead of the simulated camera.
// The PTZ model is bypassed - this module only locates the beacon and logs its centroid per frame.
import { Detector } from './detector.js';

const FULL_SCREEN_PX = 1000; // frames at least this large are treated as the whole-screen view

function blockAverage(src, w, h, f, out) {
  const ow = Math.floor(w / f), oh = Math.floor(h / f);
  const inv = 1 / (f * f);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let s = 0;
      for (let j = 0; j < f; j++) { const row = (y * f + j) * w + x * f; for (let i = 0; i < f; i++) s += src[row + i]; }
      out[y * ow + x] = s * inv;
    }
  }
  return { w: ow, h: oh };
}

export class VideoTracker {
  constructor({ threshold = 6, fps = 30 } = {}) {
    this.det = new Detector();
    this.thr = threshold;
    this.fps = fps;
    this.small = new Float32Array(0);
    this.reset();
  }

  reset() {
    this.last = null; // {x,y}
    this.vel = { x: 0, y: 0 };
    this.misses = 0;
    this.confirm = 0;
    this.locked = false;
    this.lastSize = null;
    this.prevCand = null;
  }

  /** gray: Float32Array (w*h, 0..255). Returns {found, x, y, z, state, size}. */
  process(gray, w, h) {
    const fullScreen = Math.max(w, h) >= FULL_SCREEN_PX;
    const sizesFull = fullScreen ? [5, 7, 10, 14, 20] : [3, 5, 7, 10, 14, 20];
    const roiR = (base) => Math.min(Math.max(w, h), base + 40 * this.misses);
    let cand = null;

    if (this.locked || this.last) {
      const px = this.last.x + this.vel.x, py = this.last.y + this.vel.y;
      const R = roiR(fullScreen ? 60 : 80);
      const sizes = this.lastSize && this.locked ? sizesFull.filter((s) => s >= this.lastSize * 0.6 && s <= this.lastSize * 1.6) : sizesFull;
      const r = this.det.detectROI(gray, w, h, { x0: px - R, y0: py - R, x1: px + R, y1: py + R }, { sizes: sizes.length ? sizes : sizesFull, threshold: this.thr, maxCands: 4 });
      cand = this._nearest(r.cands, px, py, R);
    }
    if (!cand && (!this.last || this.misses >= 2)) cand = this._globalSearch(gray, w, h, fullScreen, sizesFull);

    if (cand) {
      if (this.locked || !this.prevCand || Math.hypot(cand.x - this.prevCand.x, cand.y - this.prevCand.y) < 60) this.confirm++;
      else this.confirm = 1;
      this.prevCand = { x: cand.x, y: cand.y };
      if (this.last) { this.vel = { x: 0.6 * this.vel.x + 0.4 * (cand.x - this.last.x), y: 0.6 * this.vel.y + 0.4 * (cand.y - this.last.y) }; }
      this.last = { x: cand.x, y: cand.y };
      this.lastSize = cand.size;
      this.misses = 0;
      if (this.confirm >= 2) this.locked = true;
      // reported in OpenCV pixel-index convention (centre of the first pixel = 0.0)
      return { found: true, x: cand.x - 0.5, y: cand.y - 0.5, z: cand.z, size: cand.size, locked: this.locked, state: this.locked ? 'TRACK' : 'ACQUIRE' };
    }
    this.misses++;
    this.confirm = 0;
    if (this.misses > 3) this.vel = { x: 0, y: 0 };
    const was = this.locked;
    if (this.misses > 15) { this.locked = false; this.last = null; this.prevCand = null; }
    return { found: false, locked: this.locked, state: this.last ? 'COAST' : was ? 'REACQUIRE' : 'SEARCH' };
  }

  _nearest(cands, px, py, R) {
    let best = null, bd = Infinity;
    for (const c of cands) { const d = Math.hypot(c.x - px, c.y - py); if (d < R && d < bd) { bd = d; best = c; } }
    return best;
  }

  _globalSearch(gray, w, h, fullScreen, sizes) {
    if (!fullScreen) {
      const r = this.det.detect(gray, w, h, { sizes, threshold: this.thr, maxCands: 4 });
      return r.cands[0] ?? null;
    }
    const f = Math.max(2, Math.ceil(Math.max(w, h) / 500));
    if (this.small.length < Math.ceil(w / f) * Math.ceil(h / f)) this.small = new Float32Array(Math.ceil(w / f) * Math.ceil(h / f));
    const d = blockAverage(gray, w, h, f, this.small);
    const r = this.det.detect(this.small, d.w, d.h, { sizes: [1, 2, 3, 5], threshold: this.thr, maxCands: 4 });
    const prior = this.last;
    let best = null, bs = -Infinity;
    for (const c of r.cands) {
      const s = prior ? c.z * Math.exp(-Math.hypot(c.x * f - prior.x, c.y * f - prior.y) / 350) : c.z;
      if (s > bs) { bs = s; best = c; }
    }
    if (!best) return null;
    // refine at full resolution around the coarse hit
    const cx = best.x * f, cy = best.y * f, R = 6 * f + 10;
    const fine = this.det.detectROI(gray, w, h, { x0: cx - R, y0: cy - R, x1: cx + R, y1: cy + R }, { sizes, threshold: Math.min(this.thr, 5), maxCands: 3 });
    return this._nearest(fine.cands, cx, cy, R) ?? { x: cx, y: cy, z: best.z, size: best.size * f, amp: best.amp };
  }
}

/** Parse ground-truth CSV: rows "frame,x,y" (header optional). Returns Map(frame -> {x,y}). */
export function parseGroundTruth(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const p = line.trim().split(/[,;\s]+/).map(Number);
    if (p.length >= 3 && p.every(Number.isFinite)) map.set(Math.round(p[0]), { x: p[1], y: p[2] });
  }
  return map;
}

/** Metrics for a video run. rows: [{k,t,found,x,y,state,procMs}], gt: Map|null, w,h: frame size. */
export function videoMetrics(rows, { fps = 30, w, h, gt = null } = {}) {
  const n = rows.length;
  const first = rows.findIndex((r) => r.state === 'TRACK');
  const proc = rows.map((r) => r.procMs);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  const after = first >= 0 ? rows.slice(first) : [];
  const detected = after.filter((r) => r.found).length;
  const events = [];
  let lost = null;
  for (let i = first + 1; first >= 0 && i < n; i++) {
    if (lost === null && !rows[i].found && rows[i - 1].found) lost = rows[i].t;
    if (lost !== null && rows[i].found) { events.push(rows[i].t - lost); lost = null; }
  }
  const errs = [];
  const offs = [];
  for (const r of rows) {
    if (!r.found) continue;
    offs.push(Math.hypot(r.x - w / 2, r.y - h / 2));
    const g = gt?.get(r.k) ?? gt?.get(r.k + 1);
    if (g) errs.push(Math.hypot(r.x - g.x, r.y - g.y));
  }
  const rms = (a) => Math.sqrt(a.reduce((x, y) => x + y * y, 0) / (a.length || 1));
  const s = [...errs].sort((a, b) => a - b);
  const r2 = (v) => (Number.isFinite(v) ? Number(v.toFixed(3)) : null);
  return {
    frames: n,
    frameSize: `${w}x${h}`,
    simulationDurationSec: r2(n / fps),
    averageFPS: r2(1000 / mean(proc)),
    processingTimeMeanMs: r2(mean(proc)),
    acquisitionTimeSec: first >= 0 ? r2(rows[first].t) : null,
    lockRetentionRatePct: after.length ? r2((100 * detected) / after.length) : null,
    reacquisitionEvents: events.length,
    reacquisitionTimeMaxSec: events.length ? r2(Math.max(...events)) : 0,
    centroidingErrorRmsePx: errs.length ? r2(rms(errs)) : null,
    centroidingErrorMeanPx: errs.length ? r2(mean(errs)) : null,
    centroidingErrorP95Px: errs.length ? r2(s[Math.floor(0.95 * (s.length - 1))]) : null,
    centroidingErrorMaxPx: errs.length ? r2(s[s.length - 1]) : null,
    groundTruthFrames: errs.length,
    offsetFromCentreMeanPx: r2(mean(offs)),
  };
}

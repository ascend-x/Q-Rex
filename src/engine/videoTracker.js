// Benchmark-2 path: the same detector, fed with decoded video frames instead of the simulated camera.
// The PTZ model is bypassed - this module only locates the beacon and logs its centroid per frame.
import { Detector } from './detector.js';
import { getNet } from './ai.js';

const FULL_SCREEN_PX = 1000; // frames at least this large are treated as the whole-screen view

// Trimmed block mean for the coarse search: the lowest and highest quarter of every block are discarded, so salt & pepper
// and codec-smeared impulses do not leak into the down-sampled image (a plain mean would pass them straight through).
const _blk = new Float32Array(256);
function blockTrimmed(src, w, h, f, out) {
  const ow = Math.floor(w / f), oh = Math.floor(h / f), n = f * f, cut = n >= 4 ? Math.floor(n / 4) : 0;
  const keep = n - 2 * cut, blk = n <= 256 ? _blk : new Float32Array(n);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let m = 0;
      for (let j = 0; j < f; j++) {
        const row = (y * f + j) * w + x * f;
        for (let i = 0; i < f; i++) { const v = src[row + i]; let k = m++; while (k > 0 && blk[k - 1] > v) { blk[k] = blk[k - 1]; k--; } blk[k] = v; }
      }
      let s = 0;
      for (let k = cut; k < n - cut; k++) s += blk[k];
      out[y * ow + x] = s / keep;
    }
  }
  return { w: ow, h: oh };
}

export class VideoTracker {
  constructor({ threshold = 6, fps = 30, ai = false, aiMinProb = 0.5 } = {}) {
    this.det = new Detector();
    this.ai = ai;
    this.aiMinProb = aiMinProb;
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
    this.lastZ = Infinity;
    this.prevCand = null;
  }

  /** gray: Float32Array (w*h, 0..255). Returns {found, x, y, z, state, size}. */
  process(gray, w, h) {
    const fullScreen = Math.max(w, h) >= FULL_SCREEN_PX;
    const sizesFull = fullScreen ? [5, 7, 10, 14, 20] : [3, 5, 7, 10, 14, 20];
    const roiR = (base) => Math.min(Math.max(w, h), base + 40 * this.misses);
    let cand = null;

    if (this.locked || this.last) {
      // prediction: last position + velocity; while coasting the velocity decays (so it cannot run off-screen) and stays in frame
      const px = Math.min(w, Math.max(0, this.last.x + this.vel.x)), py = Math.min(h, Math.max(0, this.last.y + this.vel.y));
      const R = roiR(fullScreen ? 60 : 80);
      const sizes = this.lastSize && this.locked ? sizesFull.filter((s) => s >= this.lastSize * 0.6 && s <= this.lastSize * 1.6) : sizesFull;
      const win = (r_, thr, max) => this.det.detectROI(gray, w, h, { x0: px - r_, y0: py - r_, x1: px + r_, y1: py + r_ }, { sizes: sizes.length ? sizes : sizesFull, threshold: thr, maxCands: max });
      cand = this._best(win(R, this.thr, 4).cands, px, py, R); // prediction gate + SNR decide identity inside the window: no CNN veto
      // weak-detection retry, only for a beacon that was already faint (a bright one that vanished is a blink, not a dim frame)
      if (!cand && this.locked && this.misses < 4 && this.lastZ < 25) { const G = Math.min(R, 40); cand = this._best(win(G, 3.5, 6).cands, px, py, G); }
    }
    if (!cand && (!this.last || this.misses >= 2)) cand = this._globalSearch(gray, w, h, fullScreen, sizesFull);

    if (cand) {
      if (this.locked || !this.prevCand || Math.hypot(cand.x - this.prevCand.x, cand.y - this.prevCand.y) < 60) this.confirm++;
      else this.confirm = 1;
      this.prevCand = { x: cand.x, y: cand.y };
      if (this.last) { this.vel = { x: 0.6 * this.vel.x + 0.4 * (cand.x - this.last.x), y: 0.6 * this.vel.y + 0.4 * (cand.y - this.last.y) }; }
      this.last = { x: cand.x, y: cand.y };
      this.lastSize = cand.size;
      this.lastZ = this.lastZ === Infinity ? cand.z : 0.7 * this.lastZ + 0.3 * cand.z;
      this.misses = 0;
      if (this.confirm >= 2) this.locked = true;
      // reported in OpenCV pixel-index convention (centre of the first pixel = 0.0)
      return { found: true, x: cand.x - 0.5, y: cand.y - 0.5, z: cand.z, size: cand.size, locked: this.locked, state: this.locked ? 'TRACK' : 'ACQUIRE' };
    }
    this.misses++;
    this.confirm = 0;
    this.vel = { x: 0.7 * this.vel.x, y: 0.7 * this.vel.y };
    const was = this.locked;
    if (this.misses > 15) { this.locked = false; this.last = null; this.prevCand = null; }
    return { found: false, locked: this.locked, state: this.last ? 'COAST' : was ? 'REACQUIRE' : 'SEARCH' };
  }

  /** Optional learned verifier: keep only candidates the CNN accepts (full-resolution frames only). */
  _verify(cands) {
    if (!this.ai || !cands.length) return cands;
    const net = (this.net ??= getNet());
    const last = this.det.last;
    return cands.slice(0, 8).map((c) => ({ c, p: net.evaluate(last, c.x, c.y).p }))
      .filter((o) => o.p >= this.aiMinProb || o.c.z >= 25).map((o) => o.c); // veto only; keep the classical SNR order
  }

  /** Best candidate in the tracking window: SNR weighted by closeness to the prediction (a fast beacon may be far from it). */
  _best(cands, px, py, R) {
    let best = null, bs = 0;
    for (const c of cands) {
      const d = Math.hypot(c.x - px, c.y - py);
      if (d >= R) continue;
      const s = c.z * Math.exp(-0.5 * (d / (0.6 * R)) ** 2);
      if (s > bs) { bs = s; best = c; }
    }
    return best;
  }

  _nearest(cands, px, py, R) {
    let best = null, bd = Infinity;
    for (const c of cands) { const d = Math.hypot(c.x - px, c.y - py); if (d < R && d < bd) { bd = d; best = c; } }
    return best;
  }

  _globalSearch(gray, w, h, fullScreen, sizes) {
    if (!fullScreen) {
      const r = this.det.detect(gray, w, h, { sizes, threshold: this.thr, maxCands: this.ai ? 8 : 4 });
      return this._verify(r.cands)[0] ?? null;
    }
    // 1) full-resolution search (impulse-filtered matched filter): the most sensitive, 25-80 ms and only on search frames
    const full = this.det.detect(gray, w, h, { sizes, threshold: this.thr, maxCands: this.ai ? 8 : 4 });
    const pr = this.last;
    const ranked = pr ? [...full.cands].sort((a, b) => b.z * Math.exp(-Math.hypot(b.x - pr.x, b.y - pr.y) / 350) - a.z * Math.exp(-Math.hypot(a.x - pr.x, a.y - pr.y) / 350)) : full.cands;
    const hit = this._verify(ranked)[0];
    if (hit) return hit;
    // 2) fallback: coarse trimmed-mean search for very small / very dim beacons, refined at full resolution
    const f = Math.max(2, Math.ceil(Math.max(w, h) / 500));
    if (this.small.length < Math.ceil(w / f) * Math.ceil(h / f)) this.small = new Float32Array(Math.ceil(w / f) * Math.ceil(h / f));
    const d = blockTrimmed(gray, w, h, f, this.small);
    const r = this.det.detect(this.small, d.w, d.h, { sizes: [1, 2, 3, 5], threshold: this.thr, maxCands: 4 });
    const prior = this.last;
    const scored = r.cands.map((c) => ({ c, s: prior ? c.z * Math.exp(-Math.hypot(c.x * f - prior.x, c.y * f - prior.y) / 350) : c.z })).sort((a, b) => b.s - a.s);
    for (const { c: best } of scored) {
      // refine at full resolution around the coarse hit
      const cx = best.x * f, cy = best.y * f, R = 6 * f + 10;
      const fine = this.det.detectROI(gray, w, h, { x0: cx - R, y0: cy - R, x1: cx + R, y1: cy + R }, { sizes, threshold: Math.min(this.thr, 5), maxCands: 3 });
      if (!this.ai) return this._nearest(fine.cands, cx, cy, R) ?? { x: cx, y: cy, z: best.z, size: best.size * f, amp: best.amp };
      // learned verifier at acquisition: accept the first coarse hit whose full-resolution candidate the network confirms
      const near = fine.cands.filter((q) => Math.hypot(q.x - cx, q.y - cy) < R);
      const ok = this._verify(near);
      if (ok.length) return ok[0];
    }
    return null;
  }
}

/**
 * Parse a ground-truth file. Accepted: "frame,x,y" or "time_s,x,y" rows (comma / semicolon / tab / space separated, header
 * optional, extra columns ignored). Frame numbers may be 0- or 1-based (auto-detected); a non-integer first column is
 * read as seconds and converted with `fps`. Returns Map(frame0 -> {x,y}).
 */
export function parseGroundTruth(text, fps = 30) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const p = line.trim().split(/[,;\t\s]+/).map(Number);
    if (p.length >= 3 && p.slice(0, 3).every(Number.isFinite)) rows.push(p);
  }
  const map = new Map();
  if (!rows.length) return map;
  const seconds = rows.some((r) => !Number.isInteger(r[0]));
  const minF = Math.min(...rows.map((r) => r[0]));
  const oneBased = !seconds && minF === 1 && !rows.some((r) => r[0] === 0);
  for (const r of rows) {
    const f = seconds ? Math.round(r[0] * fps) : Math.round(r[0]) - (oneBased ? 1 : 0);
    map.set(f, { x: r[1], y: r[2] });
  }
  return map;
}

/** Metrics for a video run. rows: [{k,t,found,x,y,state,procMs}], gt: Map|null, w,h: frame size. */
export function videoMetrics(rows, { fps = 30, w, h, gt = null, gtConvention = 'index' } = {}) {
  // 'edge' = ground truth uses pixel-edge coordinates (centre of the first pixel = 0.5); our output is pixel-index (0.0)
  const gtShift = gtConvention === 'edge' ? -0.5 : 0;
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
    if (g) errs.push(Math.hypot(r.x - (g.x + gtShift), r.y - (g.y + gtShift)));
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

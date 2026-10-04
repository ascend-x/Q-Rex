// Classical beacon detector: impulse-noise rejection -> multi-scale box matched filter with a
// self-calibrated (robust MAD) CFAR threshold -> shape validation -> iterative sub-pixel centroid.
// Operates on any single-channel Float32 image, so the same code serves the synthetic camera,
// the wide overview frame and decoded .mp4 frames (Benchmark-2).

// Median of 9 via the classic 19-exchange sorting network (Devillard's opt_med9). Verified against a brute-force sort in tests.
const P9 = new Float32Array(9);
function med9(a, b, c, d, e, f, g, h, i) {
  const p = P9;
  p[0] = a; p[1] = b; p[2] = c; p[3] = d; p[4] = e; p[5] = f; p[6] = g; p[7] = h; p[8] = i;
  let t;
  if (p[1] > p[2]) { t = p[1]; p[1] = p[2]; p[2] = t; } if (p[4] > p[5]) { t = p[4]; p[4] = p[5]; p[5] = t; } if (p[7] > p[8]) { t = p[7]; p[7] = p[8]; p[8] = t; }
  if (p[0] > p[1]) { t = p[0]; p[0] = p[1]; p[1] = t; } if (p[3] > p[4]) { t = p[3]; p[3] = p[4]; p[4] = t; } if (p[6] > p[7]) { t = p[6]; p[6] = p[7]; p[7] = t; }
  if (p[1] > p[2]) { t = p[1]; p[1] = p[2]; p[2] = t; } if (p[4] > p[5]) { t = p[4]; p[4] = p[5]; p[5] = t; } if (p[7] > p[8]) { t = p[7]; p[7] = p[8]; p[8] = t; }
  if (p[0] > p[3]) { t = p[0]; p[0] = p[3]; p[3] = t; } if (p[5] > p[8]) { t = p[5]; p[5] = p[8]; p[8] = t; } if (p[4] > p[7]) { t = p[4]; p[4] = p[7]; p[7] = t; }
  if (p[3] > p[6]) { t = p[3]; p[3] = p[6]; p[6] = t; } if (p[1] > p[4]) { t = p[1]; p[1] = p[4]; p[4] = t; } if (p[2] > p[5]) { t = p[2]; p[2] = p[5]; p[5] = t; }
  if (p[4] > p[7]) { t = p[4]; p[4] = p[7]; p[7] = t; } if (p[4] > p[2]) { t = p[4]; p[4] = p[2]; p[2] = t; } if (p[6] > p[4]) { t = p[6]; p[6] = p[4]; p[4] = t; }
  if (p[4] > p[2]) { t = p[4]; p[4] = p[2]; p[2] = t; }
  return p[4];
}

/** 3x3 median filter (borders use replicated pixels so edge impulses are removed too). */
export function median3x3(src, w, h, dst) {
  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1) * w, y0 = y * w, yp = Math.min(h - 1, y + 1) * w;
    const edgeRow = y === 0 || y === h - 1;
    for (let x = 0; x < w; x++) {
      if (!edgeRow && x > 0 && x < w - 1) {
        const p = y0 + x;
        dst[p] = med9(src[p - w - 1], src[p - w], src[p - w + 1], src[p - 1], src[p], src[p + 1], src[p + w - 1], src[p + w], src[p + w + 1]);
      } else {
        const xm = Math.max(0, x - 1), xp = Math.min(w - 1, x + 1);
        dst[y0 + x] = med9(src[ym + xm], src[ym + x], src[ym + xp], src[y0 + xm], src[y0 + x], src[y0 + xp], src[yp + xm], src[yp + x], src[yp + xp]);
      }
    }
  }
}

/**
 * Switching median for dense salt & pepper noise: only pixels sitting at the extreme values (0 / 255) are replaced, by the median of
 * the non-extreme pixels in their 5x5 neighbourhood. Unlike a plain 3x3 median this keeps 1-3 px blobs (a zoomed-out beacon) intact.
 */
export function switchingMedian(src, w, h, dst) {
  dst.set(src.subarray(0, w * h));
  const vals = new Float32Array(49);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = src[y * w + x];
      if (v > 0.5 && v < 254.5) continue;
      let r = 2, n = 0;
      for (; r <= 3 && n < 5; r++) {
        n = 0;
        const ya = Math.max(0, y - r), yb = Math.min(h - 1, y + r), xa = Math.max(0, x - r), xb = Math.min(w - 1, x + r);
        for (let yy = ya; yy <= yb; yy++) for (let xx = xa; xx <= xb; xx++) { const u = src[yy * w + xx]; if (u > 0.5 && u < 254.5) vals[n++] = u; }
      }
      if (n >= 5) { const a = vals.subarray(0, n).sort(); dst[y * w + x] = a[n >> 1]; }
    }
  }
}

function robustStats(arr) {
  arr.sort();
  const n = arr.length;
  const med = arr[n >> 1];
  const dev = new Float32Array(n);
  for (let i = 0; i < n; i++) dev[i] = Math.abs(arr[i] - med);
  dev.sort();
  return { med, sigma: Math.max(1.4826 * dev[n >> 1], 1e-3) };
}

export class Detector {
  constructor() {
    this.last = null;
    this.buf = new Float32Array(0);
    this.med = new Float32Array(0);
    this.roi = new Float32Array(0);
    this.integral = new Float64Array(0);
    this.maps = [];
  }

  _ensure(name, n, Type = Float32Array) {
    if (!this[name] || this[name].length < n) this[name] = new Type(n);
    return this[name];
  }

  /** Detect within a rectangular ROI {x0,y0,x1,y1} (half-open) of img (w x h). Coordinates returned in img frame. */
  detectROI(img, w, h, roi, opts) {
    const x0 = Math.max(0, Math.floor(roi.x0)), y0 = Math.max(0, Math.floor(roi.y0));
    const x1 = Math.min(w, Math.ceil(roi.x1)), y1 = Math.min(h, Math.ceil(roi.y1));
    const rw = x1 - x0, rh = y1 - y0;
    if (rw < 8 || rh < 8) return { cands: [], bg: 0, sigma: 0, impulse: false };
    if (x0 === 0 && y0 === 0 && rw === w && rh === h) return this.detect(img, w, h, opts);
    const sub = this._ensure('roi', rw * rh);
    for (let y = 0; y < rh; y++) sub.set(img.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + rw), y * rw);
    const r = this.detect(sub, rw, rh, opts);
    this.last.ox = x0; this.last.oy = y0;
    for (const c of r.cands) { c.x += x0; c.y += y0; }
    return r;
  }

  /**
   * opts: sizes[] box sizes (px), threshold (CFAR z), maxCands, impulse ('auto'|true|false).
   * Returns {cands:[{x,y,z,amp,size,ecc,edge}], bg, sigma, impulse} sorted by z (descending).
   */
  detect(img, w, h, opts) {
    const { sizes, maxCands = 6 } = opts;
    let threshold = opts.threshold ?? 6;
    let src = img;
    // 1) impulse (salt) detection on a sparse subsample
    let impulse = opts.impulse === true;
    if (opts.impulse === undefined || opts.impulse === 'auto') {
      let salt = 0, n = 0;
      this.saltFrac = 0;
      const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 6000)));
      for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) { n++; if (img[y * w + x] >= 254.5) salt++; }
      impulse = n > 0 && salt / n > 0.003;
      this.saltFrac = n > 0 ? salt / n : 0;
    }
    if (impulse && opts.impulseFilter === 'switching' && w > 6 && h > 6) {
      const m = this._ensure('med', w * h);
      switchingMedian(img, w, h, m);
      src = m;
      threshold += 2;
    } else if (impulse && w > 2 && h > 2) {
      const m = this._ensure('med', w * h);
      median3x3(img, w, h, m);
      src = m;
      if (this.saltFrac > 0.02) { // dense impulse noise: a second pass removes surviving impulse clusters
        const m2 = this._ensure('med2', w * h);
        median3x3(m, w, h, m2);
        src = m2;
        threshold += 6; // surviving impulse clusters have heavier tails than Gaussian noise
      } else threshold += 2;
    }
    // pixel noise level (for centroid thresholds) from a subsample
    const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 5000)));
    const samp = [];
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) samp.push(src[y * w + x]);
    const px = robustStats(Float32Array.from(samp));
    // expose the preprocessed (impulse-filtered) image + noise statistics: the learned verifier reads patches from it
    this.last = { src, w, h, bg: px.med, sigma: px.sigma, impulse, ox: 0, oy: 0 };

    // 2) integral image
    const W1 = w + 1;
    const I = this._ensure('integral', W1 * (h + 1), Float64Array);
    I.fill(0, 0, W1);
    for (let y = 0; y < h; y++) {
      let row = 0;
      const o = (y + 1) * W1, p = y * W1;
      I[o] = 0;
      for (let x = 0; x < w; x++) { row += src[y * w + x]; I[o + x + 1] = I[p + x + 1] + row; }
    }

    // 3) multi-scale matched (box) filter with robust per-scale noise calibration
    const found = [];
    for (let si = 0; si < sizes.length; si++) {
      const s = sizes[si];
      if (s >= w - 1 || s >= h - 1) continue;
      const mw = w - s + 1, mh = h - s + 1;
      const area = s * s;
      const M = this._ensure(`m${si}`, mw * mh);
      const ss = Math.max(1, Math.floor(Math.sqrt((mw * mh) / 6000)));
      const smp = [];
      for (let y = 0; y < mh; y++) {
        const a = y * W1, b = (y + s) * W1;
        for (let x = 0; x < mw; x++) {
          const v = (I[b + x + s] - I[a + x + s] - I[b + x] + I[a + x]) / area;
          M[y * mw + x] = v;
          if (y % ss === 0 && x % ss === 0) smp.push(v);
        }
      }
      const st = robustStats(Float32Array.from(smp));
      // Never calibrate below the white-noise floor (guards against flat synthetic backgrounds / quantisation).
      const sig = Math.max(st.sigma, 0.15 * px.sigma / s, 0.02);
      const thr = st.med + threshold * sig;
      for (let y = 0; y < mh; y++) {
        for (let x = 0; x < mw; x++) {
          const v = M[y * mw + x];
          if (v > thr) found.push({ x: x + s / 2, y: y + s / 2, z: (v - st.med) / sig, size: s, level: v });
        }
      }
      if (found.length > 60000) break; // flooded (e.g. scene cut) - bail out
    }
    found.sort((a, b) => b.z - a.z);

    // 4) non-maximum suppression across scales, then validate + centroid
    const kept = [];
    for (const f of found) {
      if (kept.length >= maxCands * 2) break;
      let dup = false;
      for (const k of kept) {
        const r = 0.75 * Math.max(f.size, k.size) + 2;
        if (Math.abs(k.x - f.x) < r && Math.abs(k.y - f.y) < r) { dup = true; break; }
      }
      if (!dup) kept.push(f);
    }
    const cands = [];
    for (const k of kept) {
      const c = this._refine(src, w, h, k, px);
      if (c) cands.push(c);
      if (cands.length >= maxCands) break;
    }
    return { cands, bg: px.med, sigma: px.sigma, impulse };
  }

  /** Local background (ring median), shape validation and iterative weighted centroid. */
  _refine(src, w, h, k, px) {
    const s = k.size;
    const R = Math.ceil(s / 2 + 4);
    let cx = k.x, cy = k.y;
    // local background from a ring around the candidate
    const ring = [];
    const r0 = R + 2, r1 = R + 6;
    for (let y = Math.max(0, Math.floor(cy - r1)); y <= Math.min(h - 1, Math.ceil(cy + r1)); y += 2) {
      for (let x = Math.max(0, Math.floor(cx - r1)); x <= Math.min(w - 1, Math.ceil(cx + r1)); x += 2) {
        const d = Math.max(Math.abs(x + 0.5 - cx), Math.abs(y + 0.5 - cy));
        if (d >= r0 && d <= r1) ring.push(src[y * w + x]);
      }
    }
    let bg = px.med;
    if (ring.length >= 8) { ring.sort((a, b) => a - b); bg = ring[ring.length >> 1]; }
    const amp = k.level - bg;
    if (amp <= 0) return null;
    const tau = Math.min(0.6 * amp, Math.max(0.3 * amp, 2 * px.sigma));
    let sw = 0, mxx = 0, myy = 0, mxy = 0, area = 0;
    let edge = false;
    for (let it = 0; it < 4; it++) {
      let sx = 0, sy = 0;
      sw = 0; area = 0;
      const xa = Math.floor(cx - R), xb = Math.ceil(cx + R), ya = Math.floor(cy - R), yb = Math.ceil(cy + R);
      edge = xa < 0 || ya < 0 || xb >= w || yb >= h;
      for (let y = Math.max(0, ya); y <= Math.min(h - 1, yb); y++) {
        for (let x = Math.max(0, xa); x <= Math.min(w - 1, xb); x++) {
          const v = src[y * w + x] - bg - tau;
          if (v > 0) { sw += v; sx += v * (x + 0.5); sy += v * (y + 0.5); area++; }
        }
      }
      if (sw <= 0) return null;
      const nx = sx / sw, ny = sy / sw;
      const moved = Math.hypot(nx - cx, ny - cy);
      cx = nx; cy = ny;
      if (moved < 0.02) break;
    }
    // second moments of the thresholded blob -> eccentricity
    for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(h - 1, Math.ceil(cy + R)); y++) {
      for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(w - 1, Math.ceil(cx + R)); x++) {
        const v = src[y * w + x] - bg - tau;
        if (v > 0) { const dx = x + 0.5 - cx, dy = y + 0.5 - cy; mxx += v * dx * dx; myy += v * dy * dy; mxy += v * dx * dy; }
      }
    }
    mxx /= sw; myy /= sw; mxy /= sw;
    const tr = mxx + myy, det = mxx * myy - mxy * mxy;
    const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = Math.max(tr / 2 - disc, 1e-6);
    const ecc = Math.sqrt(l1 / l2);
    // a real beacon fills a good part of its matched box; residual impulse pixels do not
    if (area < Math.max(1, Math.floor(0.35 * s * s))) return null;
    const highSNR = amp / px.sigma > 3.5 && area >= 6;
    if (highSNR && ecc > 2.6) return null; // streak-like (rain)
    return { x: cx, y: cy, z: k.z, amp, size: s, ecc, edge, area };
  }
}

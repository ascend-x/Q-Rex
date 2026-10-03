// Sensor model: renders the narrow camera frame (640x480) and the wide overview frame from the
// analytic scene, then applies atmosphere and noise. The tracker only ever sees these pixels.
import { camScale, ATMOSPHERES } from './config.js';

function erf(x) {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
const phi = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
const G = (z) => z * Phi(z) + phi(z); // antiderivative of Phi

/** Blend atmosphere preset with clear sky by `level`. */
export function atmosphereParams(cfg) {
  const a = ATMOSPHERES[cfg.atmosphere] ?? ATMOSPHERES.clear;
  const l = cfg.atmosphereLevel;
  return {
    contrast: 1 + (a.contrast - 1) * l,
    brightness: a.brightness * l,
    blur: a.blur * l,
    streaks: a.streaks && l > 0.2,
    shot: 1 + (a.shot - 1) * l,
  };
}

/** 1-D integral over pixel [i,i+1] of a box [a,b] blurred by gaussian sigma. */
function boxProfile(out, i0, i1, a, b, sigma) {
  for (let i = i0; i <= i1; i++) {
    const za = (i - a) / sigma, zb = (i + 1 - a) / sigma;
    const wa = (i - b) / sigma, wb = (i + 1 - b) / sigma;
    out[i - i0] = sigma * (G(zb) - G(za) - (G(wb) - G(wa)));
  }
}

const profX = new Float64Array(128);
const profY = new Float64Array(128);

/** Add a blurred beacon of peak amplitude `amp` centred at (cx,cy) (pixel coordinates, pixel i spans [i,i+1)). */
function addBeacon(buf, w, h, cx, cy, size, shape, amp, sigma) {
  const half = size / 2;
  const R = half + 4 * sigma + 1;
  const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(w - 1, Math.ceil(cx + R));
  const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(h - 1, Math.ceil(cy + R));
  if (x1 < x0 || y1 < y0 || x1 - x0 > 126 || y1 - y0 > 126) return;
  if (shape === 'square') {
    boxProfile(profX, x0, x1, cx - half, cx + half, sigma);
    boxProfile(profY, y0, y1, cy - half, cy + half, sigma);
    for (let y = y0; y <= y1; y++) {
      const py = profY[y - y0] * amp;
      const row = y * w;
      for (let x = x0; x <= x1; x++) buf[row + x] += py * profX[x - x0];
    }
    return;
  }
  // Circle / diamond: 4x supersampled mask, gaussian blurred (separable), area-averaged.
  const ss = 4;
  const mw = (x1 - x0 + 1) * ss, mh = (y1 - y0 + 1) * ss;
  const mask = new Float32Array(mw * mh);
  for (let j = 0; j < mh; j++) {
    const py = y0 + (j + 0.5) / ss - cy;
    for (let i = 0; i < mw; i++) {
      const px = x0 + (i + 0.5) / ss - cx;
      const inside = shape === 'circle' ? px * px + py * py <= half * half : Math.abs(px) + Math.abs(py) <= half * 1.2;
      if (inside) mask[j * mw + i] = 1;
    }
  }
  const ks = sigma * ss;
  const kr = Math.max(1, Math.ceil(3 * ks));
  const ker = new Float32Array(2 * kr + 1);
  let ksum = 0;
  for (let k = -kr; k <= kr; k++) ksum += (ker[k + kr] = Math.exp(-0.5 * (k / ks) ** 2));
  for (let k = 0; k < ker.length; k++) ker[k] /= ksum;
  const tmp = new Float32Array(mw * mh);
  for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
    let s = 0;
    for (let k = -kr; k <= kr; k++) { const ii = i + k; if (ii >= 0 && ii < mw) s += mask[j * mw + ii] * ker[k + kr]; }
    tmp[j * mw + i] = s;
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let s = 0;
    for (let b = 0; b < ss; b++) for (let a = 0; a < ss; a++) {
      const i = (x - x0) * ss + a, j = (y - y0) * ss + b;
      let v = 0;
      for (let k = -kr; k <= kr; k++) { const jj = j + k; if (jj >= 0 && jj < mh) v += tmp[jj * mw + i] * ker[k + kr]; }
      s += v;
    }
    buf[y * w + x] += (amp * s) / (ss * ss);
  }
}

export class SensorModel {
  constructor(cfg, rng) {
    this.cfg = cfg;
    this.rng = rng;
    this.w = cfg.camW;
    this.h = cfg.camH;
    this.frame = new Float32Array(this.w * this.h);
    this.ovFactor = 4;
    this.ow = Math.round(cfg.screenSize / this.ovFactor);
    this.overview = new Float32Array(this.ow * this.ow);
    this.atm = atmosphereParams(cfg);
  }

  /** screen px per camera px at the current FOV (1 at the default 4 deg). */
  get scale() { return camScale(this.cfg); }

  psfSigma(turbulence) {
    return Math.sqrt(0.5 * 0.5 + this.atm.blur ** 2 + (1.2 * turbulence) ** 2);
  }

  /**
   * Narrow camera frame. `view` = {cx,cy} line-of-sight centre in screen px (camera + platform + jitter);
   * `targets` = [{x,y,size,intensity,scint}] in screen px. Returns target centres in camera px.
   */
  renderNarrow(view, targets, turbulence) {
    const { w, h, frame, cfg } = this;
    if (cfg.cameraType !== 'colour') return this._renderChannel(frame, view, targets, turbulence, 1, 1, true);
    // Optional colour camera: three independently-noisy channels (reddish beacon on a bluish-grey background);
    // the tracker receives the luminance image, the GUI can show the colour frame.
    if (!this.rgb) { this.rgb = new Uint8ClampedArray(w * h * 4); this.tmp = new Float32Array(w * h); }
    const tint = [[1.0, 0.45, 0.25], [0.55, 0.85, 1.0]]; // [beacon, background] gain per channel
    const lw = [0.299, 0.587, 0.114];
    frame.fill(0);
    let truth;
    for (let ch = 0; ch < 3; ch++) {
      truth = this._renderChannel(this.tmp, view, targets, turbulence, tint[0][ch], tint[1][ch], true);
      for (let i = 0, j = ch; i < w * h; i++, j += 4) { frame[i] += lw[ch] * this.tmp[i]; this.rgb[j] = this.tmp[i]; }
    }
    for (let i = 3; i < this.rgb.length; i += 4) this.rgb[i] = 255;
    return truth;
  }

  _renderChannel(buf, view, targets, turbulence, beaconGain, bgGain, withRain) {
    const { w, h, cfg, atm } = this;
    const sc = this.scale;
    const bg = atm.contrast * cfg.background * bgGain + atm.brightness;
    buf.fill(bg);
    const sigma = this.psfSigma(turbulence);
    const truth = [];
    for (const t of targets) {
      const px = (t.x - view.cx) / sc + w / 2;
      const py = (t.y - view.cy) / sc + h / 2;
      const amp = atm.contrast * t.intensity * beaconGain * t.scint + atm.brightness - bg;
      truth.push({ x: px, y: py });
      addBeacon(buf, w, h, px, py, t.size / sc, cfg.targetShape, amp, sigma);
    }
    if (atm.streaks && withRain) this.addRain(buf, w, h, targets[0] ? atm.contrast * targets[0].intensity * 0.5 : 60);
    this.addNoise(buf, w * h);
    return truth;
  }

  addRain(buf, w, h, amp) {
    const rng = this.rng;
    const n = 28;
    for (let s = 0; s < n; s++) {
      let x = rng.uniform(0, w), y = rng.uniform(0, h);
      const len = rng.uniform(8, 26);
      const a = rng.uniform(0.2, 0.5) * amp;
      const dx = 0.27, dy = 0.96;
      for (let k = 0; k < len; k++) {
        const xi = Math.floor(x), yi = Math.floor(y);
        if (xi >= 0 && xi < w && yi >= 0 && yi < h) buf[yi * w + xi] += a;
        x += dx; y += dy;
      }
    }
  }

  /** Poisson -> Gaussian -> salt&pepper -> clip, in place. */
  addNoise(buf, n) {
    const { cfg, rng, atm } = this;
    const doP = cfg.poisson, doG = cfg.gaussian && cfg.gaussianSigma > 0, doS = cfg.saltPepper && cfg.saltPepperDensity > 0;
    if (doP) {
      const g = atm.shot;
      for (let i = 0; i < n; i++) {
        const v = buf[i];
        buf[i] = v > 0 ? g * rng.poisson(v / g) : 0;
      }
    }
    if (doG) {
      const s = cfg.gaussianSigma;
      for (let i = 0; i < n; i++) buf[i] += s * rng.gauss();
    }
    if (doS) {
      const p = cfg.saltPepperDensity;
      for (let i = 0; i < n; i++) {
        const u = rng.next();
        if (u < p) buf[i] = u < p * 0.5 ? 0 : 255;
      }
    }
    for (let i = 0; i < n; i++) buf[i] = buf[i] < 0 ? 0 : buf[i] > 255 ? 255 : buf[i];
  }

  /** Wide-area frame of the whole screen, 4x4 binned. Noise is drawn from the binned-pixel statistics. */
  renderOverview(targets, turbulence) {
    const { ow, overview: buf, cfg, rng, atm, ovFactor: f } = this;
    const bg = atm.contrast * cfg.background + atm.brightness;
    const n = ow * ow;
    buf.fill(bg);
    const sigma = Math.max(0.35, this.psfSigma(turbulence) / f);
    const truth = [];
    for (const t of targets) {
      const amp = atm.contrast * t.intensity * t.scint + atm.brightness - bg;
      truth.push({ x: t.x, y: t.y });
      addBeacon(buf, ow, ow, t.x / f, t.y / f, t.size / f, cfg.targetShape, amp, sigma);
    }
    // Binned-noise statistics (each overview pixel averages f*f sensor pixels).
    const n2 = f * f;
    let mean = 0;
    let varSum = 0;
    if (cfg.saltPepper && cfg.saltPepperDensity > 0) {
      const p = cfg.saltPepperDensity;
      const m = bg * (1 - p) + 127.5 * p;
      mean = m - bg;
      varSum += (1 - p) * (bg - m) ** 2 + p * (0.5 * (255 - m) ** 2 + 0.5 * m * m);
    }
    if (cfg.gaussian) varSum += cfg.gaussianSigma ** 2;
    const shotVar = cfg.poisson ? atm.shot : 0;
    const sd0 = Math.sqrt(varSum / n2);
    for (let i = 0; i < n; i++) {
      const v = buf[i] + mean;
      const sd = shotVar ? Math.sqrt(varSum / n2 + (Math.max(v, 0) * shotVar) / n2) : sd0;
      buf[i] = Math.min(255, Math.max(0, sd ? v + sd * rng.gauss() : v));
    }
    return truth;
  }
}

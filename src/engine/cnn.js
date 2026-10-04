// Tiny convolutional beacon verifier / refiner (inference only; trained by ml/train.py on simulator data).
// Input: PATCH x PATCH normalised window around a detector candidate. Output: beacon probability and the sub-pixel offset
// (dx, dy) from the window centre to the beacon centre. ~37 k parameters, ~1 M MACs per window.
import { PATCH, extractPatch } from './patch.js';

export class PatchNet {
  constructor(weights) {
    this.layers = weights.layers;
    this.scale = weights.offsetScale;
    // activation buffers sized for the widest layer (first conv keeps the 32x32 resolution)
    const widest = Math.max(...this.layers.filter((l) => l.type === 'conv').map((l) => l.out));
    this.bufA = new Float32Array(widest * PATCH * PATCH);
    this.bufB = new Float32Array(widest * PATCH * PATCH);
    this.patch = new Float32Array(PATCH * PATCH);
    this.report = weights.report;
  }

  _conv(L, src, inC, h, w, dst) {
    const { out: outC, stride } = L;
    const oh = Math.floor((h + 2 - 3) / stride) + 1, ow = Math.floor((w + 2 - 3) / stride) + 1;
    const W = L.w, B = L.b;
    for (let oc = 0; oc < outC; oc++) {
      for (let oy = 0; oy < oh; oy++) {
        for (let ox = 0; ox < ow; ox++) {
          let s = B[oc];
          const iy0 = oy * stride - 1, ix0 = ox * stride - 1;
          for (let ic = 0; ic < inC; ic++) {
            const wb = (oc * inC + ic) * 9, sb = ic * h * w;
            for (let ky = 0; ky < 3; ky++) {
              const iy = iy0 + ky;
              if (iy < 0 || iy >= h) continue;
              for (let kx = 0; kx < 3; kx++) {
                const ix = ix0 + kx;
                if (ix < 0 || ix >= w) continue;
                s += W[wb + ky * 3 + kx] * src[sb + iy * w + ix];
              }
            }
          }
          dst[oc * oh * ow + oy * ow + ox] = s > 0 ? s : 0;
        }
      }
    }
    return [oh, ow];
  }

  _fc(L, src, relu) {
    const out = new Float32Array(L.out);
    for (let o = 0; o < L.out; o++) {
      let s = L.b[o];
      const wb = o * L.in;
      for (let i = 0; i < L.in; i++) s += L.w[wb + i] * src[i];
      out[o] = relu && s < 0 ? 0 : s;
    }
    return out;
  }

  /** patch: Float32Array(PATCH*PATCH) already normalised. Returns {p, dx, dy}. */
  infer(patch) {
    let src = patch, inC = 1, h = PATCH, w = PATCH, a = this.bufA, b = this.bufB;
    for (let i = 0; i < 4; i++) {
      const [oh, ow] = this._conv(this.layers[i], src, inC, h, w, a);
      src = a; [a, b] = [b, a]; inC = this.layers[i].out; h = oh; w = ow;
    }
    const f1 = this._fc(this.layers[4], src, true);
    const o = this._fc(this.layers[5], f1, false);
    return { p: 1 / (1 + Math.exp(-o[0])), dx: o[1] * this.scale, dy: o[2] * this.scale };
  }

  /** Evaluate a candidate at (cx,cy) on the detector's preprocessed image (det.last). */
  evaluate(last, cx, cy) {
    extractPatch(last.src, last.w, last.h, cx - last.ox, cy - last.oy, last.bg, last.sigma, this.patch);
    return this.infer(this.patch);
  }
}

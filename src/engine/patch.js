// Patch extraction for the learned verifier / refiner (shared by dataset generation, training-time checks and runtime).
// A PATCH x PATCH window is sampled (bilinear) around a candidate position from the detector's preprocessed image and
// normalised with the frame's robust background / noise level, then compressed with asinh so that bright beacons and
// faint ones occupy a comparable range.
export const PATCH = 32;

/** img: Float32Array (w*h), (cx,cy) continuous coordinates (pixel i spans [i,i+1)). Writes PATCH*PATCH floats to out. */
export function extractPatch(img, w, h, cx, cy, bg, sigma, out) {
  const inv = 1 / Math.max(sigma, 1);
  const half = (PATCH - 1) / 2;
  for (let j = 0; j < PATCH; j++) {
    const y = cy + (j - half) - 0.5;
    const y0 = Math.floor(y), fy = y - y0;
    const ya = Math.min(h - 1, Math.max(0, y0)), yb = Math.min(h - 1, Math.max(0, y0 + 1));
    for (let i = 0; i < PATCH; i++) {
      const x = cx + (i - half) - 0.5;
      const x0 = Math.floor(x), fx = x - x0;
      const xa = Math.min(w - 1, Math.max(0, x0)), xb = Math.min(w - 1, Math.max(0, x0 + 1));
      const v = (img[ya * w + xa] * (1 - fx) + img[ya * w + xb] * fx) * (1 - fy) + (img[yb * w + xa] * (1 - fx) + img[yb * w + xb] * fx) * fy;
      out[j * PATCH + i] = Math.asinh(((v - bg) * inv) / 3);
    }
  }
}

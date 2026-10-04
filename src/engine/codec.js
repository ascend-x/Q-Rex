// JPEG-like 8x8 block-DCT quantisation: a cheap, deterministic stand-in for the blocking / ringing / smearing that H.264 and
// MPEG-4 compression add to a video frame. Used to make the learned verifier robust to compressed Benchmark-2 videos.
// quality in (0, 100]: lower = coarser quantisation = stronger artefacts.
const COS = new Float64Array(64);
for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) COS[u * 8 + x] = (u === 0 ? Math.SQRT1_2 : 1) * 0.5 * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
const BASE = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];

export function codecDegrade(frame, w, h, quality, out = frame) {
  const q = Math.min(100, Math.max(1, quality));
  const scale = q < 50 ? 5000 / q : 200 - 2 * q;
  const Q = BASE.map((b) => Math.max(1, Math.floor((b * scale + 50) / 100)));
  const blk = new Float64Array(64), tmp = new Float64Array(64), coef = new Float64Array(64);
  for (let by = 0; by + 8 <= h; by += 8) {
    for (let bx = 0; bx + 8 <= w; bx += 8) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) blk[y * 8 + x] = frame[(by + y) * w + bx + x] - 128;
      // forward DCT (separable)
      for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += COS[u * 8 + x] * blk[y * 8 + x]; tmp[y * 8 + u] = s; }
      for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) { let s = 0; for (let y = 0; y < 8; y++) s += COS[v * 8 + y] * tmp[y * 8 + u]; coef[v * 8 + u] = Math.round(s / Q[v * 8 + u]) * Q[v * 8 + u]; }
      // inverse DCT
      for (let v = 0; v < 8; v++) for (let x = 0; x < 8; x++) { let s = 0; for (let u = 0; u < 8; u++) s += COS[u * 8 + x] * coef[v * 8 + u]; tmp[v * 8 + x] = s; }
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { let s = 0; for (let v = 0; v < 8; v++) s += COS[v * 8 + y] * tmp[v * 8 + x]; out[(by + y) * w + bx + x] = Math.min(255, Math.max(0, s + 128)); }
    }
  }
  return out;
}

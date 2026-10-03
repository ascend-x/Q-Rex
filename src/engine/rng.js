// Deterministic random streams. Each subsystem (motion, noise, jitter, ...) gets its own
// stream derived from the master seed so that changing one never perturbs another.

function splitmix32(a) {
  a = (a + 0x9e3779b9) | 0;
  let t = a ^ (a >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t ^= t >>> 15;
  t = Math.imul(t, 0x735a2d97);
  t ^= t >>> 15;
  return t >>> 0;
}

export class RNG {
  constructor(seed = 1, stream = 0) {
    this.s = splitmix32(splitmix32((seed | 0) ^ Math.imul(stream + 1, 0x85ebca6b)));
    this.spare = null;
  }

  /** Uniform in [0,1) (mulberry32). */
  next() {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  uniform(a, b) {
    return a + (b - a) * this.next();
  }

  /** Standard normal (Box-Muller with cached spare). */
  gauss() {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    let u = 0;
    while (u < 1e-12) u = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    const th = 2 * Math.PI * this.next();
    this.spare = r * Math.sin(th);
    return r * Math.cos(th);
  }

  /** Poisson sample: Knuth for small lambda, normal approximation above 12. */
  poisson(lambda) {
    if (lambda <= 0) return 0;
    if (lambda > 12) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * this.gauss()));
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > L);
    return k - 1;
  }
}

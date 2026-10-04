// Two-model IMM (constant-velocity + constant-acceleration) Kalman filter. Axes are decoupled
// (identical dynamics) but share model probabilities. State per axis: [pos, vel, acc].
// Measurement noise is supplied per update (from detector SNR) and adapted from innovation statistics.

const mm = (A, B) => {
  const C = new Float64Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += A[i * 3 + k] * B[k * 3 + j]; C[i * 3 + j] = s; }
  return C;
};
const mt = (A) => { const C = new Float64Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[j * 3 + i] = A[i * 3 + j]; return C; };
const madd = (A, B) => { const C = new Float64Array(9); for (let i = 0; i < 9; i++) C[i] = A[i] + B[i]; return C; };

function modelMatrices(kind, dt, q) {
  const F = new Float64Array(9);
  const Q = new Float64Array(9);
  if (kind === 'cv') {
    F.set([1, dt, 0, 0, 1, 0, 0, 0, 0]);
    // white acceleration noise q on the velocity channel
    Q.set([q * dt ** 4 / 4, q * dt ** 3 / 2, 0, q * dt ** 3 / 2, q * dt * dt, 0, 0, 0, 0]);
  } else {
    F.set([1, dt, dt * dt / 2, 0, 1, dt, 0, 0, 1]);
    // white jerk noise q
    const d = dt;
    Q.set([
      q * d ** 5 / 20, q * d ** 4 / 8, q * d ** 3 / 6,
      q * d ** 4 / 8, q * d ** 3 / 3, q * d ** 2 / 2,
      q * d ** 3 / 6, q * d ** 2 / 2, q * d,
    ]);
  }
  return { F, Q };
}

export class IMM {
  /** qCV: accel noise PSD (px^2/s^3) for CV model; qCA: jerk noise PSD for CA model. */
  constructor({ qCV = 2e4, qCA = 5e7, switchProb = 0.04, adapt = true, qScale0 = 0.1, qFloor = 0.02, qMax = 1, noisePrior = 4 } = {}) {
    this.noisePrior = noisePrior;
    this.adapt = adapt;
    this.qScale0 = qScale0;
    this.qFloor = qFloor;
    this.qMax = qMax;
    this.qCV = qCV;
    this.qCA = qCA;
    this.pi = [[1 - switchProb, switchProb], [switchProb, 1 - switchProb]];
    this.initialised = false;
    this.nisAvg = 1;
    this.rScale = 1;
    this.rHat = 0;
    this.qScale = this.qScale0;
    this.hist = [];
    this.sd = [];
    this.frame = 0;
  }

  init(x, y, sigma = 5) {
    this.mu = [0.6, 0.4];
    this.x = [0, 1].map(() => [new Float64Array([x, 0, 0]), new Float64Array([y, 0, 0])]);
    const P0 = () => new Float64Array([sigma * sigma, 0, 0, 0, 200 ** 2, 0, 0, 0, 1000 ** 2]);
    this.P = [0, 1].map(() => [P0(), P0()]);
    this.initialised = true;
    this.nisAvg = 1;
    this.rScale = 1;
    this.rHat = 0;
    this.qScale = this.qScale0;
    this.hist = [];
    this.sd = [];
    this.frame = 0;
    this.missed = 0;
  }

  /** Combined estimate: {px,py,vx,vy,ax,ay, sp (pos std px)}. */
  get state() {
    const o = { px: 0, py: 0, vx: 0, vy: 0, ax: 0, ay: 0, sp: 0 };
    let varx = 0;
    for (let m = 0; m < 2; m++) {
      const w = this.mu[m];
      o.px += w * this.x[m][0][0]; o.py += w * this.x[m][1][0];
      o.vx += w * this.x[m][0][1]; o.vy += w * this.x[m][1][1];
      o.ax += w * this.x[m][0][2]; o.ay += w * this.x[m][1][2];
    }
    for (let m = 0; m < 2; m++) varx += this.mu[m] * (this.P[m][0][0] + (this.x[m][0][0] - o.px) ** 2);
    o.sp = Math.sqrt(varx);
    return o;
  }

  /** Extrapolate the combined estimate by tau seconds (no state change). */
  predictAhead(tau) {
    const s = this.state;
    const a = this.mu[1]; // trust acceleration only as far as the CA model is credible
    return {
      x: s.px + s.vx * tau + 0.5 * a * s.ax * tau * tau,
      y: s.py + s.vy * tau + 0.5 * a * s.ay * tau * tau,
      vx: s.vx + a * s.ax * tau,
      vy: s.vy + a * s.ay * tau,
    };
  }

  /**
   * Measurement-noise estimate from second differences of consecutive-frame measurements:
   * var(z[k]-2z[k-1]+z[k-2]) = 6R for smooth motion, so R is observable without a motion model
   * (robust: median absolute deviation, so outliers and brief manoeuvres do not inflate it).
   */
  _noteMeasurement(zx, zy) {
    const h = this.hist;
    if (h.length && h[h.length - 1].f !== this.frame - 1) h.length = 0; // gap: restart
    h.push({ f: this.frame, x: zx, y: zy });
    if (h.length > 3) h.shift();
    if (h.length === 3) {
      this.sd.push(Math.abs(h[2].x - 2 * h[1].x + h[0].x), Math.abs(h[2].y - 2 * h[1].y + h[0].y));
      if (this.sd.length > 60) this.sd.splice(0, this.sd.length - 60);
      if (this.sd.length >= 12) {
        const a = [...this.sd].sort((p, q) => p - q);
        const med = a[a.length >> 1];

        const sd = med / 0.6745 / Math.sqrt(6);
        this.rHat = sd * sd;
      }
    }
  }

  /** IMM mix + time update over dt (call once per frame, before update()). */
  predict(dt) {
    this.frame++;
    const pi = this.pi;
    const cbar = [pi[0][0] * this.mu[0] + pi[1][0] * this.mu[1], pi[0][1] * this.mu[0] + pi[1][1] * this.mu[1]];
    const mix = [[0, 0], [0, 0]]; // mix[i][j] = mu_{i|j}
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) mix[i][j] = (pi[i][j] * this.mu[i]) / (cbar[j] || 1);
    const xNew = [[], []];
    const PNew = [[], []];
    for (let j = 0; j < 2; j++) {
      for (let a = 0; a < 2; a++) {
        const x0 = new Float64Array(3);
        for (let i = 0; i < 2; i++) for (let k = 0; k < 3; k++) x0[k] += mix[i][j] * this.x[i][a][k];
        const P0 = new Float64Array(9);
        for (let i = 0; i < 2; i++) {
          const d = [0, 1, 2].map((k) => this.x[i][a][k] - x0[k]);
          for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) P0[r * 3 + c] += mix[i][j] * (this.P[i][a][r * 3 + c] + d[r] * d[c]);
        }
        xNew[j][a] = x0;
        PNew[j][a] = P0;
      }
    }
    this.mu = cbar;
    const kinds = ['cv', 'ca'];
    for (let j = 0; j < 2; j++) {
      const { F, Q } = modelMatrices(kinds[j], dt, (j === 0 ? this.qCV : this.qCA) * this.qScale);
      for (let a = 0; a < 2; a++) {
        const x = xNew[j][a];
        this.x[j][a] = new Float64Array([F[0] * x[0] + F[1] * x[1] + F[2] * x[2], F[3] * x[0] + F[4] * x[1] + F[5] * x[2], F[6] * x[0] + F[7] * x[1] + F[8] * x[2]]);
        this.P[j][a] = madd(mm(mm(F, PNew[j][a]), mt(F)), Q);
      }
    }
  }

  /**
   * Measurement update with position measurement (zx,zy) and noise std `sigma` (px).
   * Returns {accepted, nis}. Applies chi-square gating and Huber-style robust inflation.
   */
  update(zx, zy, sigma, { gate = 16 } = {}) {
    // measurement noise: detector-derived floor, raised by innovation-based estimate (jitter, turbulence)
    // until the noise level has been observed (12 second-difference samples) assume a moderate prior so that a filter
    // started directly on the narrow camera (scan / zoom acquisition) is not over-confident under jitter
    const prior = this.sd.length < 12 ? this.noisePrior ** 2 : 0;
    const r0 = Math.max((sigma * this.rScale) ** 2, this.rHat, prior);
    const s = this.state;
    // gating on the combined predicted state
    let d2 = 0;
    const comb = [s.px, s.py];
    const zz = [zx, zy];
    const Sc = s.sp * s.sp + r0;
    for (let a = 0; a < 2; a++) d2 += (zz[a] - comb[a]) ** 2 / Sc;
    // two rejections in a row mean the model, not the measurement, is wrong: accept (with a Huber-inflated R) instead of coasting forever
    if (d2 > gate && this.missed < 2) { this.missed++; return { accepted: false, nis: d2 / 2 }; }
    this._noteMeasurement(zx, zy);
    // Huber-style inflation of R for mildly large innovations
    const dz = Math.sqrt(d2 / 2);
    const R = dz > 2 ? r0 * (dz / 2) : r0;
    const lik = [0, 0];
    for (let m = 0; m < 2; m++) {
      let logL = 0;
      for (let a = 0; a < 2; a++) {
        const P = this.P[m][a];
        const x = this.x[m][a];
        const S = P[0] + R;
        const nu = zz[a] - x[0];
        const K = [P[0] / S, P[3] / S, P[6] / S];
        logL += -0.5 * (nu * nu) / S - 0.5 * Math.log(S);
        x[0] += K[0] * nu; x[1] += K[1] * nu; x[2] += K[2] * nu;
        // Joseph-free (P - K S K^T): P_new = P - K * H P  (H=[1,0,0]) -> row 0 of P scaled
        const row = [P[0], P[1], P[2]];
        const Pn = new Float64Array(9);
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) Pn[r * 3 + c] = P[r * 3 + c] - K[r] * row[c];
        // symmetrise
        for (let r = 0; r < 3; r++) for (let c = r + 1; c < 3; c++) { const v = 0.5 * (Pn[r * 3 + c] + Pn[c * 3 + r]); Pn[r * 3 + c] = v; Pn[c * 3 + r] = v; }
        this.P[m][a] = Pn;
      }
      lik[m] = logL;
    }
    // model probability update (log-sum-exp for stability)
    const mx = Math.max(lik[0], lik[1]);
    const w0 = Math.exp(lik[0] - mx) * this.mu[0];
    const w1 = Math.exp(lik[1] - mx) * this.mu[1];
    const tot = w0 + w1 || 1;
    this.mu = [Math.max(0.02, w0 / tot), Math.max(0.02, w1 / tot)];
    const t2 = this.mu[0] + this.mu[1];
    this.mu = [this.mu[0] / t2, this.mu[1] / t2];
    // Process-noise adaptation: measurement noise is observable (second differences), so persistently
    // large normalised innovations mean the motion model is too stiff (manoeuvre) -> raise Q;
    // consistently small ones mean it is too loose (noise leaking into the estimate) -> lower Q.
    const nis = d2 / 2;
    this.nisAvg = 0.8 * this.nisAvg + 0.2 * Math.min(nis, 9);
    this.bigRun = nis > 4.5 ? (this.bigRun || 0) + 1 : 0; // two consecutive 1 % events are not noise
    if (!this.adapt) { /* fixed process noise */ }
    else if (this.bigRun >= 2) this.qScale = Math.min(this.qMax, this.qScale * 1.8); // sudden manoeuvre
    else if (this.nisAvg > 1.4) this.qScale = Math.min(this.qMax, this.qScale * 1.2);
    else if (this.nisAvg < 0.8) this.qScale = Math.max(this.qFloor, this.qScale * 0.97);
    this.missed = 0;
    return { accepted: true, nis };
  }
}

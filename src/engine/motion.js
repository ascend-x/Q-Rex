// Target and platform motion generators. Curves are re-parameterised by arc length so the
// configured speed (px/s for targets, px/frame for platform) is exact, not just nominal.

const TWO_PI = Math.PI * 2;


/**
 * Desired heading change this step to steer away from the box walls on constant-radius arcs.
 * Callers low-pass the result (limited angular jerk) so acceleration ramps instead of jumping.
 */
function wallTurn(x, y, th, step, rad, lo, hi) {
  const zone = rad * 1.1;
  const c = Math.cos(th), s = Math.sin(th);
  const out = (x < lo + zone && c < 0) || (x > hi - zone && c > 0) || (y < lo + zone && s < 0) || (y > hi - zone && s > 0);
  if (!out) return 0;
  const target = Math.atan2((lo + hi) / 2 - y, (lo + hi) / 2 - x);
  let d = target - th;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  const m = step / rad;
  return Math.abs(d) < m ? d : Math.sign(d) * m;
}

/** Constant-speed walker along a sampled curve fn(u), u in [0,1]. closed -> wraps, open -> ping-pong. */
class ArcPath {
  constructor(fn, closed, n = 2400) {
    this.closed = closed;
    this.xs = new Float64Array(n + 1);
    this.ys = new Float64Array(n + 1);
    this.cum = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) {
      const p = fn(i / n);
      this.xs[i] = p.x;
      this.ys[i] = p.y;
      if (i) this.cum[i] = this.cum[i - 1] + Math.hypot(p.x - this.xs[i - 1], p.y - this.ys[i - 1]);
    }
    this.length = this.cum[n];
    this.n = n;
  }

  at(s) {
    const L = this.length;
    if (this.closed) s = ((s % L) + L) % L;
    else {
      s = ((s % (2 * L)) + 2 * L) % (2 * L);
      if (s > L) s = 2 * L - s;
    }
    let lo = 0;
    let hi = this.n;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.cum[m] <= s) lo = m;
      else hi = m;
    }
    const seg = this.cum[hi] - this.cum[lo] || 1;
    const f = (s - this.cum[lo]) / seg;
    return { x: this.xs[lo] + f * (this.xs[hi] - this.xs[lo]), y: this.ys[lo] + f * (this.ys[hi] - this.ys[lo]) };
  }
}

export function parseWaypoints(text) {
  const pts = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (m) pts.push({ x: Number(m[1]), y: Number(m[2]) });
  }
  return pts;
}

/** Closed Catmull-Rom spline through the user waypoints: rounds the corners so the path is physically trackable. */
function polylineFn(pts) {
  const n = pts.length;
  const P = (i) => pts[((i % n) + n) % n];
  return (u) => {
    const t = u * n;
    const i = Math.min(n - 1, Math.floor(t));
    const f = t - i;
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f);
    return { x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y) };
  };
}

// Half-extent (x, y) of each parametric curve around its centre, used to keep paths on screen.
const EXTENT = {
  circular: [450, 450],
  figure8: [500, 250],
  spiral: [650, 650],
  sinusoidal: [0, 200],
};

function makeCurve(type, cx, cy, scale, size, wpText, opt = {}) {
  switch (type) {
    case 'circular': {
      const R = 450 * scale;
      return new ArcPath((u) => ({ x: cx + R * Math.cos(TWO_PI * u), y: cy + R * Math.sin(TWO_PI * u) }), true);
    }
    case 'figure8': {
      const A = 500 * scale;
      return new ArcPath((u) => ({ x: cx + A * Math.sin(TWO_PI * u), y: cy + 0.5 * A * Math.sin(2 * TWO_PI * u) }), true);
    }
    case 'spiral': {
      const r0 = opt.r0 ?? 60 * scale;
      const r1 = opt.r1 ?? 650 * scale;
      return new ArcPath((u) => {
        const th = u * 5 * TWO_PI;
        const r = r0 + (r1 - r0) * u;
        return { x: cx + r * Math.cos(th), y: cy + r * Math.sin(th) };
      }, false);
    }
    case 'sinusoidal': {
      const m = 80;
      return new ArcPath((u) => {
        const x = m + u * (size - 2 * m);
        return { x, y: cy + 200 * scale * Math.sin((TWO_PI * x) / (800 * scale)) };
      }, false);
    }
    case 'waypoints': {
      const pts = parseWaypoints(wpText);
      return pts.length >= 2 ? new ArcPath(polylineFn(pts), true) : null;
    }
    default:
      return null;
  }
}

/** Target trajectory. step(dt) advances time and returns {x,y} in screen pixels. */
export function makeTargetMotion(cfg, rng, index = 0) {
  const size = cfg.screenSize;
  const margin = 70;
  const v = cfg.targetSpeed * (index === 0 ? 1 : rng.uniform(0.6, 1.3));
  let type = cfg.motion;
  if (index > 0 && type === 'waypoints') type = 'random';
  const user = cfg.startMode === 'user' && index === 0;

  if (type === 'linear' || type === 'random') {
    let x = user ? cfg.startX : rng.uniform(margin * 3, size - margin * 3);
    let y = user ? cfg.startY : rng.uniform(margin * 3, size - margin * 3);
    let th = rng.uniform(0, TWO_PI);
    let om = 0; // random walk: heading rate follows an Ornstein-Uhlenbeck process (smooth, bounded acceleration)
    let turn = 0; // wall-avoidance turn rate (rad/step), ramped
    return {
      type,
      step(dt) {
        if (type === 'random') {
          const a = Math.exp(-dt / 0.7);
          om = a * om + Math.sqrt(1 - a * a) * 0.9 * rng.gauss();
          th += om * dt;
        }
        const want = wallTurn(x, y, th, v * dt, 300, margin, size - margin);
        turn += Math.max(-0.02, Math.min(0.02, want - turn)) * 1;
        th += turn;
        x = Math.min(size - margin, Math.max(margin, x + Math.cos(th) * v * dt));
        y = Math.min(size - margin, Math.max(margin, y + Math.sin(th) * v * dt));
        return { x, y };
      },
      pos: () => ({ x, y }),
    };
  }

  // Parametric paths: the initial location is the path centre ("user") or random.
  const [ex, ey] = EXTENT[type] ?? [0, 0];
  const place = (c, e) => Math.min(Math.max(c, e + margin * 0.5), size - e - margin * 0.5);
  let cx = place(user ? cfg.startX : rng.uniform(ex + margin, size - ex - margin), ex);
  let cy = place(user ? cfg.startY : rng.uniform(ey + margin, size - ey - margin), ey);
  if (type === 'sinusoidal') cx = size / 2;
  const path = makeCurve(type, cx, cy, 1, size, cfg.waypoints) ?? makeCurve('circular', cx, cy, 1, size);
  let s = user ? 0 : rng.uniform(0, path.length);
  return {
    type,
    step(dt) { s += v * dt; return path.at(s); },
    pos: () => path.at(s),
  };
}

/** Platform line-of-sight disturbance: step() advances one frame, |displacement| <= platformSpeed px/frame. */
export function makePlatformMotion(getCfg, rng) {
  // getCfg() is read every frame so the speed / on-off switch can be changed live.
  const model = getCfg().platformModel;
  const speed = () => { const c = getCfg(); return c.platform ? c.platformSpeed : 0; };
  const R = 400;
  if (model === 'linear' || model === 'random') {
    let x = 0;
    let y = 0;
    let th = rng.uniform(0, TWO_PI);
    let turn = 0;
    return {
      step() {
        const P = speed();
        if (model === 'random') th += 0.25 * rng.gauss();
        const want = wallTurn(x, y, th, P, 220, -R, R);
        turn += Math.max(-0.012, Math.min(0.012, want - turn));
        th += turn;
        x = Math.min(R, Math.max(-R, x + Math.cos(th) * P));
        y = Math.min(R, Math.max(-R, y + Math.sin(th) * P));
        return { x, y };
      },
      pos: () => ({ x, y }),
    };
  }
  // platform spiral keeps a minimum radius so the required centripetal acceleration stays within reach of the mount
  const path = makeCurve(model, 0, 0, 0.6, 0, '', { r0: 150, r1: 390 }) ?? makeCurve('circular', 0, 0, 0.6, 0);
  let s = rng.uniform(0, path.length);
  return { step() { s += speed(); return path.at(s); }, pos: () => path.at(s) };
}

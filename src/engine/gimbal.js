// Virtual pan-tilt mount: velocity-commanded, rate- and acceleration-limited, with optional extra
// command latency. Positions in screen pixels, velocities in px/s.
import { PPD } from './config.js';

export class Gimbal {
  constructor(cfg) {
    this.vmax = [cfg.maxPanSpeed * PPD, cfg.maxTiltSpeed * PPD];
    this.amax = cfg.maxAccel * PPD;
    this.size = cfg.screenSize;
    // pointing range extends past the screen edge so platform offsets (<= 400 px) never saturate the mount
    this.lo = -450;
    this.hi = cfg.screenSize + 450;
    this.pos = { x: cfg.screenSize / 2, y: cfg.screenSize / 2 };
    this.vel = { x: 0, y: 0 };
    this.queue = [];
    this.latency = Math.max(0, Math.round(cfg.extraLatency || 0));
    this.saturated = false;
  }

  /** Apply a velocity command for one frame. */
  step(cmd, dt) {
    this.queue.push(cmd);
    const c = this.queue.length > this.latency ? this.queue.shift() : { vx: 0, vy: 0 };
    const want = [c.vx, c.vy];
    const keys = ['x', 'y'];
    this.saturated = false;
    for (let a = 0; a < 2; a++) {
      let w = want[a];
      if (Math.abs(w) > this.vmax[a]) { w = Math.sign(w) * this.vmax[a]; this.saturated = true; }
      const dv = w - this.vel[keys[a]];
      const lim = this.amax * dt;
      this.vel[keys[a]] += Math.abs(dv) > lim ? Math.sign(dv) * lim : dv;
      this.pos[keys[a]] += this.vel[keys[a]] * dt;
      if (this.pos[keys[a]] < this.lo || this.pos[keys[a]] > this.hi) {
        this.pos[keys[a]] = Math.min(this.hi, Math.max(this.lo, this.pos[keys[a]]));
        this.vel[keys[a]] = 0;
      }
    }
  }
}

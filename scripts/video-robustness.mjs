// Robustness of Benchmark-2 handling against "judge-style" videos we cannot see: synthesises H.264 / MPEG-4 videos in many
// resolutions, qualities, frame rates, noise types, beacon sizes / shapes / brightness (with exact ground truth), decodes them
// with ffmpeg and runs the VideoTracker. usage: node scripts/video-robustness.mjs [filter]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VideoTracker, videoMetrics } from '../src/engine/videoTracker.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qrex-vr-'));
const AI = process.argv.includes('--ai'); // enable the CNN verifier in the video tracker
const filter = process.argv.slice(2).find((a) => !a.startsWith('--'));
const N = 60;

const CASES = [
  { name: 'screen 2000² x264 crf18 σ12',      w: 2000, h: 2000, v: ['-c:v', 'libx264', '-crf', '18'], noise: { g: 12 }, size: 10 },
  { name: 'screen 2000² x264 crf36 σ12',      w: 2000, h: 2000, v: ['-c:v', 'libx264', '-crf', '36'], noise: { g: 12 }, size: 10 },
  { name: 'screen 2000² σ20 + 10% S&P',       w: 2000, h: 2000, v: ['-c:v', 'libx264', '-crf', '22'], noise: { g: 20, sp: 0.1 }, size: 10 },
  { name: 'screen 2000² 5 px beacon σ12',     w: 2000, h: 2000, v: ['-c:v', 'libx264', '-crf', '22'], noise: { g: 12 }, size: 5 },
  { name: 'screen 2000² 20 px circle σ12',    w: 2000, h: 2000, v: ['-c:v', 'libx264', '-crf', '22'], noise: { g: 12 }, size: 20, shape: 'circle' },
  { name: 'screen 2000² dim beacon (I=110)',  w: 2000, h: 2000, v: ['-c:v', 'libx264', '-crf', '22'], noise: { g: 10 }, size: 10, inten: 110 },
  { name: 'screen 2000² bright background',   w: 2000, h: 2000, v: ['-c:v', 'libx264', '-crf', '22'], noise: { g: 10 }, size: 10, bg: 70, inten: 220 },
  { name: 'screen 2000² 25 fps',              w: 2000, h: 2000, v: ['-c:v', 'libx264', '-crf', '22'], noise: { g: 12 }, size: 10, fps: 25 },
  { name: 'screen 2000² 29.97 fps',           w: 2000, h: 2000, v: ['-c:v', 'libx264', '-crf', '22'], noise: { g: 12 }, size: 10, fps: '30000/1001' },
  { name: 'screen 2000² MPEG-4 part 2',       w: 2000, h: 2000, v: ['-c:v', 'mpeg4', '-q:v', '6'], noise: { g: 12 }, size: 10 },
  { name: 'screen 2000² beacon blinks 8 fr',  w: 2000, h: 2000, v: ['-c:v', 'libx264', '-crf', '22'], noise: { g: 12 }, size: 10, blink: [20, 28], minLock: 75 }, // 8 of 60 frames contain no beacon at all, so ≤ 86 % lock is the ceiling
  { name: 'fast beacon 40 px/frame',          w: 2000, h: 2000, v: ['-c:v', 'libx264', '-crf', '22'], noise: { g: 12 }, size: 10, speed: 40 },
  { name: '1920×1080 x264 crf23 σ12',         w: 1920, h: 1080, v: ['-c:v', 'libx264', '-crf', '23'], noise: { g: 12 }, size: 10 },
  { name: '1280×720 x264 crf28 σ12',          w: 1280, h: 720,  v: ['-c:v', 'libx264', '-crf', '28'], noise: { g: 12 }, size: 10 },
  { name: 'camera 640×480 x264 σ15',          w: 640,  h: 480,  v: ['-c:v', 'libx264', '-crf', '22'], noise: { g: 15 }, size: 10 },
  { name: 'camera 640×480 σ20 + 10% S&P',     w: 640,  h: 480,  v: ['-c:v', 'libx264', '-crf', '20'], noise: { g: 20, sp: 0.1 }, size: 10 },
  // harder, informational cases (not counted as failures): where the classical detector is expected to struggle
  { name: 'HARD 2000² crf45 σ20',              w: 2000, h: 2000, v: ['-c:v', 'libx264', '-crf', '45'], noise: { g: 20 }, size: 10, hard: true },
  { name: 'HARD 2000² dim I=80 σ20 crf32',     w: 2000, h: 2000, v: ['-c:v', 'libx264', '-crf', '32'], noise: { g: 20 }, size: 10, inten: 80, hard: true },
  { name: 'HARD 2000² low contrast + 5% S&P',  w: 2000, h: 2000, v: ['-c:v', 'libx264', '-crf', '30'], noise: { g: 15, sp: 0.05 }, size: 10, bg: 90, inten: 140, hard: true },
  { name: 'HARD 640×480 crf45 σ20 + 10% S&P',  w: 640,  h: 480,  v: ['-c:v', 'libx264', '-crf', '45'], noise: { g: 20, sp: 0.1 }, size: 10, hard: true },
  { name: 'HARD 1280×720 dim I=80 + 10% S&P',  w: 1280, h: 720,  v: ['-c:v', 'libx264', '-crf', '36'], noise: { g: 18, sp: 0.1 }, size: 10, inten: 80, hard: true },
];

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

async function makeVideo(c, idx) {
  const file = path.join(tmp, `v${idx}.mp4`);
  const fps = c.fps ?? 30;
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${c.w}x${c.h}`, '-r', String(fps), '-i', '-', ...c.v, '-pix_fmt', 'yuv420p', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const rnd = rng(11 + idx), gt = new Map();
  const bg = c.bg ?? 22, inten = c.inten ?? 230, size = c.size, r = size / 2, speed = c.speed ?? 12;
  for (let k = 0; k < N; k++) {
    const f = Buffer.alloc(c.w * c.h);
    const sg = c.noise.g ?? 0;
    for (let i = 0; i < f.length; i++) f[i] = Math.max(0, Math.min(255, bg + (rnd() + rnd() + rnd() - 1.5) * 2 * sg));
    if (c.noise.sp) for (let i = 0; i < f.length; i++) { const u = rnd(); if (u < c.noise.sp) f[i] = u < c.noise.sp / 2 ? 0 : 255; }
    const span = c.w - 4 * size - 80;
    const cx = Math.round(40 + 2 * size + ((k * speed) % (2 * span) > span ? 2 * span - ((k * speed) % (2 * span)) : (k * speed) % (2 * span)));
    const cy = Math.round(c.h / 2 + (c.h * 0.3) * Math.sin(k / 15));
    const visible = !(c.blink && k >= c.blink[0] && k < c.blink[1]);
    const ci = cx - 0.5, cj = cy - 0.5; // pixel-index centre
    if (visible) for (let y = cy - size; y <= cy + size; y++) for (let x = cx - size; x <= cx + size; x++) {
      const inside = c.shape === 'circle' ? Math.hypot(x - ci, y - cj) <= r : x >= cx - size / 2 && x < cx + size / 2 && y >= cy - size / 2 && y < cy + size / 2;
      if (inside && x >= 0 && y >= 0 && x < c.w && y < c.h) f[y * c.w + x] = inten;
    }
    if (visible) gt.set(k, { x: ci, y: cj });
    if (!ff.stdin.write(f)) await new Promise((res) => ff.stdin.once('drain', res));
  }
  ff.stdin.end(); await new Promise((res) => ff.on('close', res));
  return { file, gt, fps: typeof fps === 'string' ? 29.97 : fps };
}

function decodeAndTrack(file, c, fps, gt) {
  return new Promise((resolve) => {
    const ff = spawn('ffmpeg', ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const frameBytes = c.w * c.h, vt = new VideoTracker({ fps, ai: AI }), rows = [], gray = new Float32Array(frameBytes);
    let buf = Buffer.alloc(0), k = 0;
    ff.stdout.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= frameBytes) {
        for (let i = 0; i < frameBytes; i++) gray[i] = buf[i];
        buf = buf.subarray(frameBytes);
        const t0 = performance.now();
        const r = vt.process(gray, c.w, c.h);
        rows.push({ k, t: k / fps, ...r, procMs: performance.now() - t0 });
        k++;
      }
    });
    ff.on('close', () => resolve(videoMetrics(rows, { fps, w: c.w, h: c.h, gt })));
  });
}

let fails = 0;
console.log('case'.padEnd(38), 'acq s   lock %  RMSE px  P95 px  max px  ms/fr  frames');
for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i];
  if (filter && !c.name.includes(filter)) continue;
  const { file, gt, fps } = await makeVideo(c, i);
  const m = await decodeAndTrack(file, c, fps, gt);
  const ok = m.acquisitionTimeSec !== null && m.acquisitionTimeSec <= 0.5 && m.lockRetentionRatePct >= (c.minLock ?? 90) && m.centroidingErrorRmsePx !== null && m.centroidingErrorRmsePx <= 1.5;
  if (!ok && !c.hard) fails++;
  console.log(c.name.padEnd(38), String(m.acquisitionTimeSec).padEnd(7), String(m.lockRetentionRatePct).padEnd(7), String(m.centroidingErrorRmsePx).padEnd(8), String(m.centroidingErrorP95Px).padEnd(7), String(m.centroidingErrorMaxPx).padEnd(7), String(m.processingTimeMeanMs).padEnd(6), m.frames, ok ? 'PASS' : c.hard ? 'miss (informational)' : 'FAIL');
  fs.unlinkSync(file);
}
console.log(fails === 0 ? 'ALL PASS' : `${fails} FAILED`);
process.exit(fails ? 1 : 0);

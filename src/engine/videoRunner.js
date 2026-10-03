// Browser-only: frame-exact decoding of a user-supplied video (seek per frame) and tracking.
import { VideoTracker, videoMetrics } from './videoTracker.js';

const seekTo = (video, t) => new Promise((res) => {
  const done = () => { video.removeEventListener('seeked', done); res(); };
  video.addEventListener('seeked', done);
  video.currentTime = t;
});

export async function loadVideo(file) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = URL.createObjectURL(file);
  await new Promise((res, rej) => { video.onloadeddata = res; video.onerror = () => rej(new Error('Cannot decode this video file')); });
  return video;
}

/**
 * Runs the tracker over every frame. onFrame(rowObj, canvas) lets the UI draw progress.
 * Returns {rows, metrics}. The `cancel` object lets the caller abort ({stop:true}).
 */
export async function runVideo(video, { fps = 30, threshold = 6, gt = null, onFrame, cancel = {} } = {}) {
  const w = video.videoWidth, h = video.videoHeight;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const tracker = new VideoTracker({ threshold, fps });
  const gray = new Float32Array(w * h);
  const total = Math.floor(video.duration * fps);
  const rows = [];
  for (let k = 0; k < total && !cancel.stop; k++) {
    await seekTo(video, (k + 0.5) / fps);
    ctx.drawImage(video, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];
    const t0 = performance.now();
    const r = tracker.process(gray, w, h);
    const procMs = performance.now() - t0;
    const row = { k, t: k / fps, ...r, procMs };
    rows.push(row);
    if (onFrame && (k % 3 === 0 || k === total - 1)) { onFrame(row, cv, k / total); await new Promise((r2) => setTimeout(r2, 0)); }
  }
  return { rows, metrics: videoMetrics(rows, { fps, w, h, gt }), width: w, height: h };
}

export function videoRowsToCSV(rows) {
  return ['frame,t,found,x,y,state,procMs', ...rows.map((r) => `${r.k},${r.t.toFixed(4)},${r.found ? 1 : 0},${r.found ? r.x.toFixed(3) : ''},${r.found ? r.y.toFixed(3) : ''},${r.state},${r.procMs.toFixed(3)}`)].join('\n');
}

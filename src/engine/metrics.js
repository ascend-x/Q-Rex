// Performance metrics (exact definitions in DOCS/03_DECISIONS.md D-09) and report exports.
import { PPD } from './config.js';

const pct = (arr, p) => {
  if (!arr.length) return NaN;
  const s = Float64Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.floor((p / 100) * (s.length - 1) + 0.5))];
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const rms = (a) => (a.length ? Math.sqrt(a.reduce((x, y) => x + y * y, 0) / a.length) : NaN);
const f = (v, d = 2) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

const LOCKED = new Set(['TRACK', 'COAST']);

export function computeMetrics(records, cfg, wallSeconds) {
  const n = records.length;
  const dt = 1 / cfg.fps;
  const duration = n * dt;
  const firstTrack = records.findIndex((r) => r.state === 'TRACK');
  const tLock = firstTrack >= 0 ? records[firstTrack].t : NaN;
  const firstCentred = records.findIndex((r) => r.errTrack <= 10 && firstTrack >= 0 && r.k >= firstTrack);
  const tCentre = firstCentred >= 0 ? records[firstCentred].t : NaN;
  // zoom acquisition: first time the lens is back at the configured (narrow) FOV with the beacon centred within 10 px
  const firstNarrow = records.findIndex((r) => r.state === 'TRACK' && r.fov <= cfg.fovX + 0.05 && r.errTrack <= 10);
  const tNarrow = firstNarrow >= 0 ? records[firstNarrow].t : NaN;

  const after = firstTrack >= 0 ? records.slice(firstTrack) : [];
  const steadyStart = firstCentred >= 0 ? firstCentred : n;
  const steady = records.slice(steadyStart);
  const steadyIn = steady.filter((r) => r.inFov);
  const eTrack = steadyIn.map((r) => r.errTrack);
  const eTrackJ = steadyIn.map((r) => r.errTrackJit);
  const eCent = records.filter((r) => Number.isFinite(r.errCent)).map((r) => r.errCent);

  // target loss & lock retention (since first lock)
  const outFov = after.filter((r) => !r.inFov).length;
  const targetLoss = after.length ? (100 * outFov) / after.length : NaN;
  const retained = after.filter((r) => LOCKED.has(r.state) && r.inFov && Number.isFinite(r.errEst) && r.errEst < 60).length;
  const lockRetention = after.length ? (100 * retained) / after.length : NaN;

  // re-acquisition events: TRACK -> not TRACK ... -> TRACK
  const events = [];
  let lostAt = null, declared = false;
  for (let i = firstTrack + 1; firstTrack >= 0 && i < n; i++) {
    const r = records[i];
    if (lostAt === null && r.state !== 'TRACK' && records[i - 1].state === 'TRACK') { lostAt = r.t; declared = false; }
    if (lostAt !== null && (r.state === 'REACQUIRE' || r.state === 'SEARCH')) declared = true;
    if (lostAt !== null && r.state === 'TRACK') { events.push({ t: lostAt, dur: r.t - lostAt, declared }); lostAt = null; }
  }
  const ongoing = lostAt !== null ? n * dt - lostAt : 0;
  const reDur = events.map((e) => e.dur);
  const declaredEv = events.filter((e) => e.declared).map((e) => e.dur);

  const proc = records.map((r) => r.procMs);
  const procMean = mean(proc);
  const satFrac = (100 * records.filter((r) => r.saturated).length) / (n || 1);

  const maxRe = Math.max(0, ...reDur, ongoing);
  const m = {
    simulationDurationSec: f(duration, 2),
    framesProcessed: n,
    averageFPS: f(1000 / procMean, 1),
    endToEndFPS: wallSeconds ? f(n / wallSeconds, 1) : null,
    processingTimeMeanMs: f(procMean, 2),
    processingTimeP95Ms: f(pct(proc, 95), 2),
    processingTimeMaxMs: f(Math.max(...proc), 2),
    acquisitionTimeSec: f(tLock, 3),
    timeToCentreSec: f(tCentre, 3),
    timeToNarrowFovCentredSec: f(tNarrow, 3),
    trackingErrorMeanPx: f(mean(eTrack), 2),
    trackingErrorRmsePx: f(rms(eTrack), 2),
    trackingErrorP95Px: f(pct(eTrack, 95), 2),
    trackingErrorP99Px: f(pct(eTrack, 99), 2),
    trackingErrorMaxPx: f(Math.max(...eTrack, 0), 2),
    trackingErrorInclJitterMeanPx: f(mean(eTrackJ), 2),
    centroidingErrorMeanPx: f(mean(eCent), 3),
    centroidingErrorRmsePx: f(rms(eCent), 3),
    centroidingErrorP95Px: f(pct(eCent, 95), 3),
    centroidingErrorMaxPx: f(Math.max(...eCent, 0), 3),
    lockRetentionRatePct: f(lockRetention, 2),
    targetLossPct: f(targetLoss, 2),
    reacquisitionEvents: events.length,
    reacquisitionDeclaredLosses: declaredEv.length,
    reacquisitionTimeMeanSec: f(mean(reDur), 3),
    reacquisitionTimeMaxSec: f(maxRe, 3),
    gimbalSaturationPct: f(satFrac, 1),
  };
  const maxSlewPxS = Math.min(cfg.maxPanSpeed, cfg.maxTiltSpeed) * PPD;
  m.checks = {
    K01_acquisition_le_2s: Number.isFinite(tLock) && tLock <= 2,
    K02_tracking_error_le_10px: Number.isFinite(m.trackingErrorMeanPx) && m.trackingErrorMeanPx <= 10,
    K03_target_loss_lt_5pct: Number.isFinite(targetLoss) && targetLoss < 5,
    K04_reacquisition_le_1s: maxRe <= 1,
    K05_fps_ge_20: m.averageFPS >= 20,
  };
  m.passAll = Object.values(m.checks).every(Boolean);
  m.config = { ...cfg, maxSlewPxPerSec: maxSlewPxS };
  return m;
}

export function recordsToCSV(records) {
  const cols = ['k', 't', 'state', 'worldX', 'worldY', 'camX', 'camY', 'trueX', 'trueY', 'detX', 'detY', 'estX', 'estY', 'errTrack', 'errTrackJit', 'errCent', 'errEst', 'inFov', 'procMs', 'overview', 'saturated', 'jitX', 'jitY', 'platX', 'platY'];
  const fmt = (v) => (typeof v === 'number' ? (Number.isFinite(v) ? Number(v.toFixed(4)) : '') : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  return [cols.join(','), ...records.map((r) => cols.map((c) => fmt(r[c])).join(','))].join('\n');
}

export function metricsToHTML(m, title = 'FSOC Coarse-Alignment Performance Report') {
  const rows = (o) => Object.entries(o).filter(([k]) => k !== 'config' && k !== 'checks' && k !== 'passAll').map(([k, v]) => `<tr><td>${k}</td><td>${v ?? 'n/a'}</td></tr>`).join('');
  const checks = Object.entries(m.checks).map(([k, v]) => `<tr><td>${k}</td><td style="color:${v ? '#067d3d' : '#c0262d'};font-weight:700">${v ? 'PASS' : 'FAIL'}</td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{font:14px system-ui;margin:2rem auto;max-width:760px}table{border-collapse:collapse;width:100%;margin:1rem 0}td{border:1px solid #bbb;padding:4px 8px}h1{font-size:1.4rem}</style><h1>${title}</h1><p>Generated ${new Date().toISOString()}</p><h2>Spec checks</h2><table>${checks}</table><h2>Metrics</h2><table>${rows(m)}</table><h2>Configuration</h2><pre>${JSON.stringify(m.config, null, 2)}</pre>`;
}

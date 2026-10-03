// Headless benchmark: node scripts/bench.mjs [seeds=3] [duration=30] [scenarioIdFilter]
import { Simulation } from '../src/engine/simulation.js';
import { computeMetrics } from '../src/engine/metrics.js';
import { SCENARIOS } from '../src/engine/config.js';

const seeds = Number(process.argv[2] ?? 3);
const duration = Number(process.argv[3] ?? 30);
const filter = process.argv[4];
const rows = [];
for (const sc of SCENARIOS) {
  if (filter && !sc.id.includes(filter)) continue;
  const res = [];
  for (let s = 1; s <= seeds; s++) {
    const sim = new Simulation({ ...sc.cfg, seed: s, duration });
    const w0 = performance.now();
    sim.run(duration);
    const m = computeMetrics(sim.records, sim.cfg, (performance.now() - w0) / 1000);
    res.push(m);
  }
  const avg = (k) => res.reduce((a, m) => a + (m[k] ?? 0), 0) / res.length;
  const mx = (k) => Math.max(...res.map((m) => m[k] ?? 0));
  const passes = res.filter((m) => m.passAll).length;
  const chk = Object.keys(res[0].checks).map((k) => `${res.filter((m) => m.checks[k]).length}`).join('/');
  rows.push([sc.label.padEnd(30), `acq ${avg('acquisitionTimeSec').toFixed(2)}(${mx('acquisitionTimeSec').toFixed(2)})`, `err ${avg('trackingErrorMeanPx').toFixed(1)}`, `rmse ${avg('trackingErrorRmsePx').toFixed(1)}`, `cent ${avg('centroidingErrorRmsePx').toFixed(2)}`, `loss ${avg('targetLossPct').toFixed(1)}%`, `lock ${avg('lockRetentionRatePct').toFixed(1)}%`, `reacq ${mx('reacquisitionTimeMaxSec').toFixed(2)}`, `ms ${avg('processingTimeMeanMs').toFixed(1)}`, `sat ${avg('gimbalSaturationPct').toFixed(0)}%`, `pass ${passes}/${seeds} [${chk}]`].join(' | '));
  console.log(rows[rows.length - 1]);
}

# Requirement traceability (ISRO PS-26169)

Every row maps to the module that implements it and the automated test that proves it (`npm test`; spec tests are in `tests/spec.test.mjs`).

| # | Requirement | Implementation | Test / evidence |
|---|---|---|---|
| 1 | Screen ≥ 2000×2000, optional user-defined | `config.js` `screenSize` (clamped ≥ 2000), GUI | spec #1 (3000 px screen tracked) |
| 2 | Monochrome focal-plane array; colour optional | `render.js`: mono single-channel frame (default); `cameraType: colour` renders 3 independently-noisy RGB channels, tracker uses luminance | spec #2 (both modes) |
| 3 | Resolution 640×480, optional user-defined | `camW`, `camH` | spec #3 (800×600) |
| 4 | FOV default 4°×3°, user-defined | `fovX`, `camScale()` | spec #4 (FOV 2° and 8°) |
| 5 | Camera update ≥ 30 Hz | fixed step dt = 1/fps, fps ≥ 30 | spec #5 |
| 6 | Initial camera at screen centre | `gimbal.js` | spec #6 |
| 7 | Target type: beacon spot | `render.js` `addBeacon` | spec #7-8 |
| 8 | 1 target mandatory, multiple optional | `numTargets` (decoys) | spec #7-8, decoy test |
| 9 | Shape user-defined, default square | square / circle / diamond | spec #9 |
| 10 | Size 5–20 px, default 10 | `targetSize` | spec #10 |
| 11 | Initial location user-defined, default random | `startMode`, `startX/Y` | spec #11 |
| 12 | ≥ 4 motions; optional spiral, sinusoidal, user-defined | `motion.js` (7 motions) | spec #12 (all 7 tracked, constant speed verified in engine tests) |
| 13-14 | Max pan/tilt 5–10 °/s, default 5 | `gimbal.js` | spec #13-14 (per-frame move never exceeds limit at 5 and 10 °/s) |
| 15 | Update interval ≥ 20 Hz | control computed every frame | spec #15 |
| 16 | Acquisition ≤ 2 s | overview acquisition, `tracker.js` | spec #16-20, bench A/B (0.6–1.9 s) |
| 17 | Tracking error ≤ 10 px | IMM + controller | spec #16-20, bench (0.1–6.7 px; C1 fails: 19 px) |
| 18 | Target loss < 5 % | state machine | spec #16-20, bench |
| 19 | Re-acquisition ≤ 1 s | COAST + overview assist | spec #19 (camera knocked off; 0.5 s dropouts) |
| 20 | Processing ≥ 20 FPS | ROI detection, 2–8 ms/frame | spec #16-20 |
| 21.1 | Salt & pepper ~10 %, Gaussian, Poisson, selectable | `render.js` `addNoise` | spec #21.1 |
| 21.2 | Noise σ up to 20 | `gaussianSigma` | spec #21.2 (measured σ) |
| 21.3 | Jitter ±20 px/frame | `simulation.js` `_jitter` | spec #21.3 (bound verified) |
| 21.4 | Clear, haze, fog, rain, low light, user-defined reduction | `ATMOSPHERES`, severity | spec #21.4 (contrast drops, still tracked) |
| 21.5 | Platform ±20 px/frame; linear default; circular, random, spiral, figure-8 | `makePlatformMotion` | spec #21.5 (step bound + tracked for all 5) |
| — | Turbulence / vibration | `render.js`, `simulation.js` | spec turbulence test |
| — | Real-time statistics display | `App.jsx` tiles, plot, minimap | browser run (screenshot) |
| — | Performance log (duration, FPS, acquisition, avg/max error, lock retention, processing time) | `metrics.js` JSON/CSV/HTML, auto-save at end of run | spec "performance log" test |
| — | Benchmark 1: scenarios + centroiding-error log + auto logs | scenario suite, `scripts/bench.mjs` | `RESULTS.md` |
| — | Benchmark 2: .mp4 @30 fps, PTZ bypassed, centroid error, RMSE, acq/re-acq, lock, FPS | `videoTracker.js`, `videoRunner.js` | `npm run e2e` (H.264 video, ground truth, RMSE 0.07 px) |
| — | Standalone executable | Electron shell (`npm run build:exe`) and single offline HTML (`npm run build:single`) | launched on Linux |
| — | Source code modular and documented | `src/engine/*` | README, this report |
| — | Technical report, user manual | `docs/TECHNICAL_REPORT.md`, `docs/USER_MANUAL.md` | — |

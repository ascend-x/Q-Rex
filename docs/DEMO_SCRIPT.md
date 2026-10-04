# Demo script (10–15 min live evaluation; also the script of the recorded 3–5 min video)

The video `demo/q-rex-demo.mp4` is produced automatically from this script by `npm run demo` (headless Chromium + captions burned into the page + ffmpeg). Re-record it after any UI change.

1. **(0:00) Launch** the executable. Point out: left parameter panel, status tiles, camera view, screen map, live error. State: SEARCH → SLEW → TRACK within ~1 s; acquisition tile ≈ 0.6 s (spec ≤ 2 s), tracking error < 1 px.
2. **(1:00) Four mandatory motions.** Scenario list → A1 circular, A2 straight, A3 figure-8, A4 random; then Target → motion = spiral, sinusoidal, waypoints (type 4 points).
3. **(3:00) Target controls.** Size 5 / 20, shape circle/diamond, 4 targets (decoys): tracker stays on the strongest designated beacon.
4. **(4:00) Disturbances live.** Enable salt & pepper 10 %, Gaussian σ 20, Poisson (one by one, then together); fog / rain / low light; jitter ±20; platform 20 px/frame with each model; turbulence. Show the tiles staying green.
5. **(7:00) Re-acquisition.** Enable beacon dropouts 0.5 s: COAST → TRACK, re-acquisition tile ≤ 1 s.
6. **(8:00) Camera limits.** Change pan/tilt speed 5 → 10 °/s, FOV, resolution; show the saturation warning when target + platform exceed the limit. Mention the honest limit: all disturbances at maximum (C1) misses 10 px.
7. **(9:00) Benchmark 1.** Run all scenarios (2 seeds × 20 s), show the pass/fail table.
8. **(11:00) Benchmark 2.** Load an `.mp4`; show per-frame detection, metrics table, export the centroid CSV.
9. **(13:00) Performance log.** Set a 20 s duration, let it finish: JSON, HTML and CSV are saved automatically; open the HTML report.
10. **(14:00) Architecture one-slide:** sensor → detector → IMM → state machine → gimbal; ground truth never reaches the tracker; seed-reproducible.
11. **AI verifier (optional):** *Tracker → AI verifier (CNN)* — explain that it is a 74 k-parameter network trained on simulator data that removes false alarms on low-light, rain, zoomed-out and compressed-video frames (10–14 % → 0–2 %), that it does not improve centroid accuracy, and that the classical detector stays the fallback.
12. **Acquisition modes:** *Tracker → Acquisition* — *Zoom lens (single camera)*: the camera starts at the full-screen FOV (about 16.7°), detects within a frame and zooms in to 4°×3° while centring (≈ 1 s); this needs no extra wide sensor. Mention that heavy salt & pepper noise slows this mode, and that the wide-view mode stays the default.

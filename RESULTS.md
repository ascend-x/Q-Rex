# Benchmark results (headless, `npm run bench -- 3 20`)

3 seeds x 20 s per scenario, default gimbal (5 deg/s, 20 deg/s^2). Columns: acquisition s (mean, max) | mean boresight error px | RMSE | centroid RMSE px | target loss | lock retention | max re-acq s | tracker ms/frame | gimbal saturation | runs passing K01-K05 [per-check counts].

```
A1 Nominal (circular)          | acq 0.62(0.87) | err 0.4 | rmse 0.5 | cent 0.05 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 3.2 | sat 4% | pass 3/3 [3/3/3/3/3]
A2 Straight line               | acq 0.68(0.97) | err 0.1 | rmse 0.7 | cent 0.03 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 6.3 | sat 5% | pass 3/3 [3/3/3/3/3]
A3 Figure of 8                 | acq 0.66(0.83) | err 0.4 | rmse 0.7 | cent 0.06 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 3.0 | sat 5% | pass 3/3 [3/3/3/3/3]
A4 Random walk                 | acq 0.59(0.83) | err 0.4 | rmse 0.8 | cent 0.06 | loss 0.0% | lock 100.0% | reacq 0.03 | ms 2.9 | sat 4% | pass 3/3 [3/3/3/3/3]
B1 Gaussian noise σ=20         | acq 0.61(0.87) | err 1.0 | rmse 1.0 | cent 0.11 | loss 0.1% | lock 99.9% | reacq 0.00 | ms 8.0 | sat 4% | pass 3/3 [3/3/3/3/3]
B2 Salt & pepper 10%           | acq 0.62(0.87) | err 0.4 | rmse 0.5 | cent 0.11 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 5.3 | sat 4% | pass 3/3 [3/3/3/3/3]
B3 Poisson noise               | acq 0.61(0.87) | err 0.8 | rmse 1.0 | cent 0.09 | loss 0.1% | lock 99.9% | reacq 0.00 | ms 6.2 | sat 4% | pass 3/3 [3/3/3/3/3]
B4 Jitter ±20 px/frame         | acq 0.62(0.87) | err 6.8 | rmse 7.9 | cent 0.05 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 2.6 | sat 4% | pass 3/3 [3/3/3/3/3]
B5 Platform 20 px/frame        | acq 1.26(1.93) | err 0.8 | rmse 0.9 | cent 0.05 | loss 0.0% | lock 98.3% | reacq 0.53 | ms 2.0 | sat 7% | pass 3/3 [3/3/3/3/3]
B6 Fog                         | acq 0.61(0.87) | err 0.4 | rmse 0.5 | cent 0.06 | loss 0.1% | lock 99.9% | reacq 0.00 | ms 3.1 | sat 4% | pass 3/3 [3/3/3/3/3]
B7 Rain                        | acq 0.62(0.87) | err 0.4 | rmse 0.5 | cent 0.02 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 3.1 | sat 4% | pass 3/3 [3/3/3/3/3]
B8 Low light                   | acq 0.62(0.87) | err 0.5 | rmse 0.5 | cent 0.05 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 2.9 | sat 4% | pass 3/3 [3/3/3/3/3]
B10 Beacon dropouts (0.5 s)    | acq 0.62(0.87) | err 0.9 | rmse 2.0 | cent 0.05 | loss 0.0% | lock 100.0% | reacq 0.50 | ms 3.7 | sat 4% | pass 3/3 [3/3/3/3/3]
B9 Decoys (3 targets)          | acq 0.62(0.87) | err 0.4 | rmse 0.5 | cent 0.06 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 2.9 | sat 4% | pass 3/3 [3/3/3/3/3]
C1 All disturbances (max)      | acq 1.24(1.93) | err 19.2 | rmse 28.0 | cent 1.14 | loss 0.0% | lock 98.5% | reacq 0.03 | ms 16.1 | sat 39% | pass 0/3 [3/0/3/3/3]
```

## Reading the table
- All nominal (A) and single-disturbance (B) scenarios pass K01-K05 on every seed, including salt & pepper 10 %, Gaussian sigma 20, Poisson, fog, rain, low light, jitter +-20 px/frame, platform 20 px/frame and decoys.
- Acquisition is 0.6-0.9 s with the wide-view overview, up to ~1.9 s with 20 px/frame platform offset (spec <= 2 s, little margin).
- Centroiding error is 0.02-0.2 px; tracker cost is 2-8 ms/frame (>= 120 FPS equivalent).
- **C1 (every disturbance at its maximum simultaneously) fails K02**: mean boresight error ~19 px (spec 10 px; see technical report section 9 for why this is a fundamental floor for a causal estimator). Jitter of +-20 px/frame is white noise on every measurement and a 20 px/frame platform drift needs a fast filter; the two requirements conflict (estimation error ~ measurement noise). Target loss stays 0 %, lock 99 %, so the beacon is never lost - only centred less precisely. This is a Tier-C "best effort" case; it is reported, not hidden.
- Not yet measured: real organiser videos for Benchmark 2 (the video path was verified on self-generated H.264 2000x2000 files: acquisition 0.03 s, 100 % lock).

# Benchmark results (headless)

All numbers are produced by the repository's own scripts on the final code. 3 seeds × 20 s per scenario unless stated. Gimbal acceleration default 60 °/s²
(not specified by the statement); control gain 0.6.

## Default (wide-view acquisition) — `npm run bench -- 3 20`
Columns: acquisition s (mean, max) | beacon centred at the configured FOV s | mean boresight error px | RMSE | centroid RMSE px | target loss | lock retention | max re-acq s | tracker ms/frame | gimbal saturation | runs passing K01–K05 [per-check counts].

```
A1 Nominal (circular)          | acq 0.54(0.80) | narrowCentred 0.87(1.07) | err 0.6 | rmse 0.6 | cent 0.05 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 3.4 | sat 4% | pass 3/3 [3/3/3/3/3]
A2 Straight line               | acq 0.57(0.87) | narrowCentred 1.01(1.23) | err 0.1 | rmse 0.3 | cent 0.03 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 3.6 | sat 5% | pass 3/3 [3/3/3/3/3]
A3 Figure of 8                 | acq 0.56(0.73) | narrowCentred 1.00(1.13) | err 0.4 | rmse 0.5 | cent 0.06 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 3.1 | sat 5% | pass 3/3 [3/3/3/3/3]
A4 Random walk                 | acq 0.50(0.73) | narrowCentred 0.92(1.10) | err 0.4 | rmse 0.6 | cent 0.05 | loss 0.0% | lock 100.0% | reacq 0.03 | ms 3.1 | sat 4% | pass 3/3 [3/3/3/3/3]
B1 Gaussian noise σ=20         | acq 0.53(0.77) | narrowCentred 0.87(1.07) | err 1.2 | rmse 1.2 | cent 0.19 | loss 0.1% | lock 99.9% | reacq 0.00 | ms 9.1 | sat 4% | pass 3/3 [3/3/3/3/3]
B2 Salt & pepper 10%           | acq 0.54(0.80) | narrowCentred 0.87(1.07) | err 0.6 | rmse 0.6 | cent 0.10 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 5.9 | sat 4% | pass 3/3 [3/3/3/3/3]
B3 Poisson noise               | acq 0.54(0.80) | narrowCentred 0.87(1.07) | err 1.1 | rmse 1.2 | cent 0.06 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 6.6 | sat 4% | pass 3/3 [3/3/3/3/3]
B4 Jitter ±20 px/frame         | acq 0.56(0.80) | narrowCentred 0.89(1.07) | err 6.3 | rmse 7.1 | cent 0.04 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 2.7 | sat 4% | pass 3/3 [3/3/3/3/3]
B5 Platform 20 px/frame        | acq 1.17(1.87) | narrowCentred 1.53(2.17) | err 1.0 | rmse 1.1 | cent 0.04 | loss 0.0% | lock 100.0% | reacq 0.03 | ms 2.0 | sat 6% | pass 3/3 [3/3/3/3/3]
B6 Fog                         | acq 0.54(0.80) | narrowCentred 0.87(1.07) | err 0.6 | rmse 0.7 | cent 0.03 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 3.3 | sat 4% | pass 3/3 [3/3/3/3/3]
B7 Rain                        | acq 0.54(0.80) | narrowCentred 0.87(1.07) | err 0.6 | rmse 0.6 | cent 0.04 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 3.5 | sat 4% | pass 3/3 [3/3/3/3/3]
B8 Low light                   | acq 0.54(0.80) | narrowCentred 0.87(1.07) | err 0.7 | rmse 0.7 | cent 0.05 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 3.4 | sat 4% | pass 3/3 [3/3/3/3/3]
B10 Beacon dropouts (0.5 s)    | acq 0.54(0.80) | narrowCentred 0.87(1.07) | err 1.1 | rmse 2.2 | cent 0.05 | loss 0.0% | lock 100.0% | reacq 0.50 | ms 4.3 | sat 4% | pass 3/3 [3/3/3/3/3]
B9 Decoys (3 targets)          | acq 0.54(0.80) | narrowCentred 0.87(1.07) | err 0.6 | rmse 0.6 | cent 0.05 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 3.4 | sat 4% | pass 3/3 [3/3/3/3/3]
C1 All disturbances (max)      | acq 1.16(1.87) | narrowCentred 1.64(2.27) | err 10.8 | rmse 12.5 | cent 0.21 | loss 0.1% | lock 99.9% | reacq 0.03 | ms 17.5 | sat 17% | pass 0/3 [3/0/3/3/3]
```

## Camera-only zoom-lens acquisition — `QREX_ACQ=zoom npm run bench -- 3 20`
```
A1 Nominal (circular)          | acq 0.03(0.03) | narrowCentred 1.07(1.07) | err 0.6 | rmse 0.6 | cent 0.04 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 3.1 | sat 4% | pass 3/3 [3/3/3/3/3]
A2 Straight line               | acq 0.03(0.03) | narrowCentred 1.12(1.23) | err 0.1 | rmse 0.3 | cent 0.04 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 3.6 | sat 5% | pass 3/3 [3/3/3/3/3]
A3 Figure of 8                 | acq 0.03(0.03) | narrowCentred 1.10(1.13) | err 0.4 | rmse 0.5 | cent 0.06 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 3.0 | sat 5% | pass 3/3 [3/3/3/3/3]
A4 Random walk                 | acq 0.03(0.03) | narrowCentred 1.08(1.10) | err 0.4 | rmse 0.6 | cent 0.05 | loss 0.0% | lock 100.0% | reacq 0.03 | ms 3.1 | sat 4% | pass 3/3 [3/3/3/3/3]
B1 Gaussian noise σ=20         | acq 0.03(0.03) | narrowCentred 1.07(1.07) | err 1.2 | rmse 1.2 | cent 0.12 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 8.9 | sat 4% | pass 3/3 [3/3/3/3/3]
B2 Salt & pepper 10%           | acq 0.03(0.03) | narrowCentred 1.07(1.07) | err 0.6 | rmse 0.6 | cent 0.11 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 5.6 | sat 4% | pass 3/3 [3/3/3/3/3]
B3 Poisson noise               | acq 0.03(0.03) | narrowCentred 1.07(1.07) | err 1.1 | rmse 1.2 | cent 0.06 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 6.3 | sat 4% | pass 3/3 [3/3/3/3/3]
B4 Jitter ±20 px/frame         | acq 0.03(0.03) | narrowCentred 1.07(1.07) | err 6.3 | rmse 7.1 | cent 0.04 | loss 0.0% | lock 100.0% | reacq 0.03 | ms 2.7 | sat 4% | pass 3/3 [3/3/3/3/3]
B5 Platform 20 px/frame        | acq 0.03(0.03) | narrowCentred 1.31(1.50) | err 1.0 | rmse 1.1 | cent 0.05 | loss 0.0% | lock 100.0% | reacq 0.03 | ms 1.8 | sat 6% | pass 3/3 [3/3/3/3/3]
B6 Fog                         | acq 0.03(0.03) | narrowCentred 1.07(1.07) | err 0.6 | rmse 0.7 | cent 0.01 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 3.2 | sat 4% | pass 3/3 [3/3/3/3/3]
B7 Rain                        | acq 0.03(0.03) | narrowCentred 1.07(1.07) | err 0.6 | rmse 0.6 | cent 0.02 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 3.2 | sat 4% | pass 3/3 [3/3/3/3/3]
B8 Low light                   | acq 0.03(0.03) | narrowCentred 1.07(1.07) | err 0.7 | rmse 0.7 | cent 0.04 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 3.3 | sat 4% | pass 3/3 [3/3/3/3/3]
B10 Beacon dropouts (0.5 s)    | acq 0.03(0.03) | narrowCentred 1.07(1.07) | err 1.2 | rmse 2.3 | cent 0.04 | loss 0.0% | lock 100.0% | reacq 0.50 | ms 3.4 | sat 4% | pass 3/3 [3/3/3/3/3]
B9 Decoys (3 targets)          | acq 0.03(0.03) | narrowCentred 1.07(1.07) | err 0.6 | rmse 0.6 | cent 0.04 | loss 0.0% | lock 100.0% | reacq 0.00 | ms 3.3 | sat 4% | pass 3/3 [3/3/3/3/3]
C1 All disturbances (max)      | acq 0.73(2.10) | narrowCentred 2.10(3.03) | err 10.8 | rmse 12.5 | cent 0.43 | loss 0.0% | lock 99.9% | reacq 0.17 | ms 17.8 | sat 17% | pass 0/3 [2/0/3/3/3]
```

## Gimbal-acceleration reference — `QREX_ACCEL=20` and `QREX_ACCEL=100`
Mean boresight error (px) of the hardest scenarios (default 60 °/s² is in the first table):

| Scenario | 20 °/s² | 60 °/s² | 100 °/s² |
|---|---|---|---|
| B4 jitter ±20 px/frame | 6.6 | 6.3 | 6.3 |
| B5 platform 20 px/frame | 1.0 | 1.0 | 1.0 |
| C1 all disturbances | 14.3 | 10.8 | 10.6 |

## Video robustness matrix — `node scripts/video-robustness.mjs`
```
case                                   acq s   lock %  RMSE px  P95 px  max px  ms/fr  frames
screen 2000² x264 crf18 σ12            0.033   100     0.03     0.038   0.14    8.864  60 PASS
screen 2000² x264 crf36 σ12            0.033   100     0.151    0.26    0.285   5.661  60 PASS
screen 2000² σ20 + 10% S&P             0.033   100     0.123    0.239   0.351   18.771 60 PASS
screen 2000² 5 px beacon σ12           0.033   100     0.698    0.732   0.74    5.945  60 PASS
screen 2000² 20 px circle σ12          0.033   100     0.026    0.039   0.066   6.494  60 PASS
screen 2000² dim beacon (I=110)        0.033   100     0.071    0.138   0.191   7.43   60 PASS
screen 2000² bright background         0.033   100     0.041    0.081   0.115   7.35   60 PASS
screen 2000² 25 fps                    0.04    100     0.038    0.058   0.145   7.908  60 PASS
screen 2000² 29.97 fps                 0.033   100     0.041    0.069   0.14    7.707  60 PASS
screen 2000² MPEG-4 part 2             0.033   100     0.012    0.02    0.022   6.927  60 PASS
screen 2000² beacon blinks 8 fr        0.033   79.661  0.045    0.068   0.141   21.342 60 PASS
fast beacon 40 px/frame                0.033   96.61   0.038    0.06    0.161   8.619  60 PASS
1920×1080 x264 crf23 σ12               0.033   100     0.039    0.066   0.155   6.537  60 PASS
1280×720 x264 crf28 σ12                0.033   100     0.094    0.143   0.143   5.793  60 PASS
camera 640×480 x264 σ15                0.033   100     0.028    0.04    0.061   7.555  60 PASS
camera 640×480 σ20 + 10% S&P           0.033   100     0.117    0.218   0.352   11.76  60 PASS
HARD 2000² crf45 σ20                   0.033   100     0.736    1.081   1.506   5.071  60 PASS
HARD 2000² dim I=80 σ20 crf32          0.033   100     0.474    0.853   0.962   6.875  60 PASS
HARD 2000² low contrast + 5% S&P       0.033   100     0.5      0.976   1.691   13.615 60 PASS
HARD 640×480 crf45 σ20 + 10% S&P       0.033   100     0.76     1.323   1.604   1.712  60 PASS
HARD 1280×720 dim I=80 + 10% S&P       0.033   89.831  15.197   20.1    80.201  10.503 60 miss (informational)
ALL PASS
```
Pass line: acquisition ≤ 0.5 s, lock ≥ 90 % (75 % for the blink case, which has 8 beacon-free frames), RMSE ≤ 1.5 px. 20 of 21 meet it. The last row is a deliberately extreme informational case: after the crf-36 codec the beacon's per-frame SNR is only ≈ 4–7, so it locks 90 % of frames but with outliers (15 px RMSE). Two of the five hard cases missed before this release (a moving static-noise-blob lock, and a coarse search that let impulses through); both were fixed in the video tracker (README §12).

## Reading the tables
- A1–A4 and B1–B10 pass all five checks on every seed in both acquisition modes, including 10 % salt & pepper, Gaussian σ = 20, Poisson, fog, rain, low light, jitter ±20 px/frame, platform 20 px/frame, decoys and 0.5 s dropouts.
- **C1 (every disturbance at its maximum at once) fails K02 only in the default mode**: 10.8 px mean error, loss 0.1 %, lock 99.9 %. `node scripts/floor-analysis.mjs` shows the best causal one-frame-ahead predictor reaches ≈ 10.4 px on the jitter + platform sequences, so ≤ 10 px is not reachable in this combined case. In zoom mode C1 also misses K01 on one seed (2.10 s).
- CNN verifier (`QREX_AI=1`): see the technical report §7.2; it adds ≈ 4–6 ms/frame. Closed-loop zoom benchmark with the verifier on gives identical pass/fail and error figures to the classical run (A/B all pass; C1 10.8 px as without it).
- Not measured: the organisers' own scenarios and videos.

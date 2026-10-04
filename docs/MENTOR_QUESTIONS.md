# Clarifications to confirm with the ISRO mentors

Mentors listed in the problem statement: Pranav Kumar Pandey (pranavpandey@sac.isro.gov.in), Koushik Basak (koushik@sac.isro.gov.in), Abhishek Khanna (akn@sac.isro.gov.in).

Each question lists what Q-Rex currently assumes and which setting changes if the answer differs.

| # | Question | Q-Rex assumption | If the answer differs |
|---|---|---|---|
| 1 | Is a wide-area (whole-screen) view allowed while **searching / re-acquiring**, or must acquisition use only the 640×480 camera at its configured FOV? A fixed-FOV scan needs ≈ 12.5 s, so "acquisition ≤ 2 s" needs either a wide view or a **zoom lens** (the statement lists the FOV as user-defined). | default `acquisition = overview` (an extra 4×-binned wide sensor, only while searching) | choose **Zoom lens** (camera-only: the same camera starts at the full-screen FOV, detects in ≈ 0.03 s and zooms in; beacon centred at the default 4°×3° FOV in ≤ 1.3 s) or *Raster scan* (fixed FOV, ≈ 5–13 s, K01 fails) |
| 2 | "Max standard deviation of noise: 20 **pixels**" — is this 20 grey levels (0–255 intensity noise) or something else (e.g. positional noise of the beacon)? | 20 grey levels | `gaussianSigma` (single parameter) |
| 3 | In Benchmark 2, is the `.mp4` the **whole 2000×2000 screen** or the 640×480 camera image? Which pixel convention does the ground-truth use (centre of first pixel = 0.0 or 0.5)? | any size accepted; ≥ 1000 px = whole screen; OpenCV pixel-index convention (centre of first pixel = 0.0) | convention note in the user manual; a constant 0.5 px offset in the centroid error indicates a convention mismatch |
| 4 | Is "tracking error" the distance of the **beacon from the image centre (boresight)**, or the **centroid error against ground truth**? Is camera jitter included in the former? | both reported; boresight error excludes the random per-frame jitter (also reported including it) | both numbers are already in every report |
| 5 | Does "acquisition time" start at program start, or when the target first enters the camera FOV? | from program start | `acquisitionTimeSec` vs `timeToCentreSec` are both logged |
| 6 | What beacon intensity / background level should be assumed (contrast against the background)? | beacon 230, background 20 (grey levels) | `targetIntensity`, `background` |
| 7 | Is a **trained neural network** expected for "AI-based", or is adaptive estimation acceptable? | both implemented: classical detector + IMM Kalman filter, plus an optional 74 k-parameter CNN verifier/refiner (trained on simulator data) | toggle *AI verifier (CNN)* in the Tracker section |
| 8 | Are the **combined worst cases** (jitter ±20 px/frame **and** platform ±20 px/frame **and** all noises simultaneously) part of the benchmark, or is each disturbance evaluated at its maximum separately? | evaluated separately (all pass); combined case reported honestly (10.8 px mean error at the default 60 °/s² gimbal acceleration (14.3 px at 20 °/s²); an ideal causal filter gives ≈ 10.4 px) | — |
| 9 | Gimbal **acceleration limit** — only pan/tilt speed (5–10 °/s) is specified. | 60 °/s² (`maxAccel`); results are also reported at 20 and 100 °/s² (the combined-disturbance error is 14.3 / 10.8 / 10.6 px) | `maxAccel` |
| 10 | Will the Benchmark-1 scenarios be supplied as configuration files, and in what format? Q-Rex can load a scenario from its JSON config. | scenario JSON / GUI | contact for the format |

## Draft e-mail

> Subject: SIH 26169 — clarifications for the coarse-alignment virtual camera tracker
>
> Dear Sir,
>
> We are working on problem statement 26169 (AI-based virtual camera tracking for FSOC coarse alignment). We would be grateful for clarification on the following points, because they change how we measure and report:
> 1. Is a wide-area (full-screen) view allowed during search and re-acquisition? With the camera at a fixed 4°×3° FOV and a 5°/s slew limit, a full-screen scan takes about 12 s, so "acquisition ≤ 2 s" cannot be met by scanning. We implemented both an extra wide-view sensor and a camera-only zoom-lens mode (the FOV is user-defined in the table) — which interpretation do you intend?
> 2. Is the "maximum noise standard deviation of 20 pixels" meant as 20 grey levels of intensity noise?
> 3. In Benchmark 2, is the supplied .mp4 the whole 2000×2000 screen, and which pixel-coordinate convention does the ground truth use?
> 4. Is "tracking error" measured against the image centre (boresight) or against the ground-truth centroid, and should camera jitter be included?
> 5. Does acquisition time start at program start or when the target enters the FOV?
>
> Thank you,
> Team Q-Rex
